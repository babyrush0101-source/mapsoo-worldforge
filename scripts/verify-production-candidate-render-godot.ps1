param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$manifest = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'docs\visual-qa\production-art\side-platformer-production-preview-v1.json')).Path
$evidenceRoot = Join-Path $repoRoot 'docs\visual-qa\production-art'
$expectedManifestHash = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant()

if ($GodotConsoles.Count -eq 0) {
    $GodotConsoles = @(
        (Join-Path $repoRoot 'release\godot-runtimes\4.3\Godot_v4.3-stable_win64_console.exe'),
        (Join-Path $repoRoot 'release\godot-runtimes\4.7\Godot_v4.7-stable_win64_console.exe')
    )
}

function Get-PngDimensions {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 24) {
        throw "PNG is truncated: $Path"
    }
    $widthBytes = [byte[]]$bytes[16..19]
    $heightBytes = [byte[]]$bytes[20..23]
    if ([BitConverter]::IsLittleEndian) {
        [Array]::Reverse($widthBytes)
        [Array]::Reverse($heightBytes)
    }
    return [pscustomobject]@{
        Width = [BitConverter]::ToUInt32($widthBytes, 0)
        Height = [BitConverter]::ToUInt32($heightBytes, 0)
    }
}

$results = @()
foreach ($consolePath in $GodotConsoles) {
    $console = (Resolve-Path -LiteralPath $consolePath).Path
    $versionLine = @(& $console --version 2>&1 | ForEach-Object { $_.ToString() })[0]
    $version = $versionLine.Split('.')[0..1] -join '.'
    $output = Join-Path $evidenceRoot "side-platformer-production-godot-$version-v1.png"
    $stdout = Join-Path $evidenceRoot "side-platformer-production-godot-$version-v1.stdout.log"
    $stderr = Join-Path $evidenceRoot "side-platformer-production-godot-$version-v1.stderr.log"
    $arguments = @(
        '--path', $godotRoot,
        '--display-driver', 'windows',
        '--audio-driver', 'Dummy',
        '--resolution', '640x360',
        '--script', 'res://tests/capture_production_side_platformer_candidate.gd',
        '--',
        ('"--manifest={0}"' -f $manifest),
        ('"--repo-root={0}"' -f $repoRoot),
        ('"--output={0}"' -f $output)
    )
    $process = Start-Process `
        -FilePath $console `
        -ArgumentList $arguments `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru `
        -Wait
    $log = @(
        Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue
        Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue
    )
    $log | ForEach-Object { Write-Host $_ }
    if ($process.ExitCode -ne 0 -or $log -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version production candidate render failed."
    }
    $sentinel = $log | Where-Object { $_ -match '^MAPSOO_PRODUCTION_CANDIDATE_RENDER_OK ' } | Select-Object -Last 1
    if (-not $sentinel) {
        throw "Godot $version did not emit the production candidate sentinel."
    }
    $dimensions = Get-PngDimensions -Path $output
    $renderHash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    $valid = ($dimensions.Width -eq 640) -and ($dimensions.Height -eq 360) -and ($sentinel -match "manifest_sha256=$expectedManifestHash") -and ($sentinel -match "render_sha256=$renderHash") -and ($sentinel -match 'backgrounds=5 terrain=89 props=10 collisions=5 collision_roles=3 navigation=7/6 spawn=144,576 exit=exit-node route=walk-slope-jump slope_min_y=[0-9.]+ wall_airborne=true character_clips=12 character_frames=28 animation=run_right')
    if (-not $valid) {
        throw "Godot $version production candidate render evidence is incomplete or mismatched."
    }
    $results += [pscustomobject]@{
        godot = $version
        manifest_sha256 = $expectedManifestHash
        render_path = $output.Substring($repoRoot.Length + 1).Replace('\', '/')
        render_sha256 = $renderHash
        render_bytes = (Get-Item -LiteralPath $output).Length
        width = $dimensions.Width
        height = $dimensions.Height
        backgrounds = 5
        terrain_cells = 89
        prop_placements = 10
        collision_shapes = 5
        bound_collision_roles = 3
        navigation_nodes = 7
        navigation_edges = 6
        spawn = '144,576'
        exit = 'exit-node'
        route = 'walk-slope-jump'
        slope_traversal = $true
        wall_jump = $true
        character_clips = 12
        character_frames = 28
        animation = 'run_right'
    }
}
$results | ConvertTo-Json -Depth 4
