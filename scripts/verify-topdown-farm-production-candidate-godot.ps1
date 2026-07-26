param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$manifest = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'docs\visual-qa\production-art\topdown-farm-production-preview-v1.json')).Path
$evidenceRoot = Join-Path $repoRoot 'docs\visual-qa\production-art'
$evidencePath = Join-Path $evidenceRoot 'topdown-farm-production-candidate-godot-render-v1.json'
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
    $output = Join-Path $evidenceRoot "topdown-farm-production-godot-$version-v1.png"
    $stdout = Join-Path $evidenceRoot "topdown-farm-production-godot-$version-v1.stdout.log"
    $stderr = Join-Path $evidenceRoot "topdown-farm-production-godot-$version-v1.stderr.log"
    $arguments = @(
        '--path', $godotRoot,
        '--display-driver', 'windows',
        '--audio-driver', 'Dummy',
        '--resolution', '640x480',
        '--script', 'res://tests/capture_production_topdown_farm_candidate.gd',
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
        throw "Godot $version top-down production candidate failed."
    }
    $sentinel = $log |
        Where-Object { $_ -match '^MAPSOO_TOPDOWN_FARM_PRODUCTION_GODOT_OK ' } |
        Select-Object -Last 1
    if (-not $sentinel) {
        throw "Godot $version did not emit the top-down production sentinel."
    }
    $dimensions = Get-PngDimensions -Path $output
    $renderHash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    $valid = `
        ($dimensions.Width -eq 640) -and `
        ($dimensions.Height -eq 480) -and `
        ($sentinel -match "manifest_sha256=$expectedManifestHash") -and `
        ($sentinel -match "render_sha256=$renderHash") -and `
        ($sentinel -match 'terrain=374 props=23 collisions=4 navigation=7/6 spawn=80,416 exit=exit-node route=walk-bridge-walk character_clips=12 character_frames=32 animation=walk_east')
    if (-not $valid) {
        throw "Godot $version top-down production evidence is incomplete or mismatched."
    }
    $pixelHash = [regex]::Match($sentinel, 'pixel_sha256=([0-9a-f]{64})').Groups[1].Value
    $colorCount = [int]([regex]::Match($sentinel, 'colors=([0-9]+)').Groups[1].Value)
    $results += [pscustomobject][ordered]@{
        godot = $version
        manifest_sha256 = $expectedManifestHash
        render_path = $output.Substring($repoRoot.Length + 1).Replace('\', '/')
        render_sha256 = $renderHash
        pixel_sha256 = $pixelHash
        render_bytes = (Get-Item -LiteralPath $output).Length
        width = $dimensions.Width
        height = $dimensions.Height
        terrain_cells = 374
        prop_placements = 23
        collision_shapes = 4
        navigation_nodes = 7
        navigation_edges = 6
        spawn = '80,416'
        exit = 'exit-node'
        route = 'walk-bridge-walk'
        character_clips = 12
        character_frames = 32
        animation = 'walk_east'
        quantized_colors = $colorCount
    }
}

if (($results | Select-Object -ExpandProperty render_sha256 -Unique).Count -ne 1) {
    throw 'Godot 4.3 and 4.7 top-down production renders are not identical.'
}
if (($results | Select-Object -ExpandProperty pixel_sha256 -Unique).Count -ne 1) {
    throw 'Godot 4.3 and 4.7 top-down production pixel buffers are not identical.'
}

$evidence = [ordered]@{
    schema_version = 'mapsoo-production-godot-evidence/1.0'
    id = 'topdown-farm-production-candidate-godot-render-v1'
    profile = 'topdown-farm'
    status = 'runtime-candidate'
    distribution = 'internal-review'
    output_license = 'UNRELEASED'
    preview_manifest = 'docs/visual-qa/production-art/topdown-farm-production-preview-v1.json'
    preview_manifest_sha256 = $expectedManifestHash
    checks = [ordered]@{
        exact_source_bindings = 'pass'
        collision_instantiation = 'pass'
        physical_bridge_traversal = 'pass'
        spawn_to_exit_route = 'pass'
        multi_frame_character_binding = 'pass'
        cross_version_render_identity = 'pass'
    }
    results = $results
    not_accepted_for = @(
        'public asset-pack release',
        'Raspberry Pi 4B performance claim'
    )
}
$json = $evidence | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($evidencePath, "$json`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "MAPSOO_TOPDOWN_FARM_PRODUCTION_EVIDENCE_OK manifest_sha256=$expectedManifestHash render_sha256=$($results[0].render_sha256) versions=$($results.Count) evidence=$evidencePath"
