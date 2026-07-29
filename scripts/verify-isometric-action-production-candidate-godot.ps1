param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$manifest = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'docs\visual-qa\production-art\isometric-action-production-preview-v1.json')).Path
$packManifest = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'docs\visual-qa\production-art\isometric-action-pack-atlases-v1.json')).Path
$evidenceRoot = Join-Path $repoRoot 'docs\visual-qa\production-art'
$evidencePath = Join-Path $evidenceRoot 'isometric-action-production-candidate-godot-render-v1.json'
$expectedManifestHash = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedPackHash = (Get-FileHash -LiteralPath $packManifest -Algorithm SHA256).Hash.ToLowerInvariant()

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
    $output = Join-Path $evidenceRoot "isometric-action-production-godot-$version-v1.png"
    $stdout = Join-Path $evidenceRoot "isometric-action-production-godot-$version-v1.stdout.log"
    $stderr = Join-Path $evidenceRoot "isometric-action-production-godot-$version-v1.stderr.log"
    $arguments = @(
        '--path', $godotRoot,
        '--display-driver', 'windows',
        '--audio-driver', 'Dummy',
        '--resolution', '640x360',
        '--script', 'res://tests/capture_production_isometric_action_candidate.gd',
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
        throw "Godot $version isometric production candidate failed."
    }
    $sentinel = $log |
        Where-Object { $_ -match '^MAPSOO_ISOMETRIC_PRODUCTION_GODOT_OK ' } |
        Select-Object -Last 1
    if (-not $sentinel) {
        throw "Godot $version did not emit the isometric production sentinel."
    }
    $dimensions = Get-PngDimensions -Path $output
    $renderHash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    $valid = `
        ($dimensions.Width -eq 640) -and `
        ($dimensions.Height -eq 360) -and `
        ($sentinel -match "manifest_sha256=$expectedManifestHash") -and `
        ($sentinel -match "pack_sha256=$expectedPackHash") -and `
        ($sentinel -match "render_sha256=$renderHash") -and `
        ($sentinel -match 'atlases=10 static=81 enemies=2 collisions=2 hazards=1 navigation=7/6 spawn=160,272 exit=exit-node route=hazard-respawn-blocker-dash-walk character_clips=48 total_clips=128 animation=move_north')
    if (-not $valid) {
        throw "Godot $version isometric production evidence is incomplete or mismatched."
    }
    $pixelHash = [regex]::Match($sentinel, 'pixel_sha256=([0-9a-f]{64})').Groups[1].Value
    $colorCount = [int]([regex]::Match($sentinel, 'colors=([0-9]+)').Groups[1].Value)
    $results += [pscustomobject][ordered]@{
        godot = $version
        preview_manifest_sha256 = $expectedManifestHash
        pack_atlas_manifest_sha256 = $expectedPackHash
        render_path = $output.Substring($repoRoot.Length + 1).Replace('\', '/')
        render_sha256 = $renderHash
        pixel_sha256 = $pixelHash
        render_bytes = (Get-Item -LiteralPath $output).Length
        width = $dimensions.Width
        height = $dimensions.Height
        projected_atlases = 10
        static_visuals = 81
        enemies = 2
        collision_shapes = 2
        hazards = 1
        navigation_nodes = 7
        navigation_edges = 6
        spawn = '160,272'
        exit = 'exit-node'
        route = 'hazard-respawn-blocker-dash-walk'
        character_clips = 128
        animation = 'move_north'
        quantized_colors = $colorCount
    }
}

if (($results | Select-Object -ExpandProperty render_sha256 -Unique).Count -ne 1) {
    throw 'Godot 4.3 and 4.7 isometric production renders are not identical.'
}
if (($results | Select-Object -ExpandProperty pixel_sha256 -Unique).Count -ne 1) {
    throw 'Godot 4.3 and 4.7 isometric production pixel buffers are not identical.'
}

$evidence = [ordered]@{
    schema_version = 'mapsoo-production-godot-evidence/1.0'
    id = 'isometric-action-production-candidate-godot-render-v1'
    profile = 'isometric-action'
    status = 'runtime-candidate'
    distribution = 'internal-review'
    output_license = 'UNRELEASED'
    preview_manifest = 'docs/visual-qa/production-art/isometric-action-production-preview-v1.json'
    preview_manifest_sha256 = $expectedManifestHash
    pack_atlas_manifest = 'docs/visual-qa/production-art/isometric-action-pack-atlases-v1.json'
    pack_atlas_manifest_sha256 = $expectedPackHash
    checks = [ordered]@{
        exact_pack_atlas_bindings = 'pass'
        collision_instantiation = 'pass'
        hazard_respawn = 'pass'
        blocker_physics = 'pass'
        attack_action = 'pass'
        dash_action = 'pass'
        spawn_to_exit_route = 'pass'
        cross_version_render_identity = 'pass'
    }
    results = $results
    not_accepted_for = @(
        'public asset-pack release',
        'Raspberry Pi 4B performance claim',
        'human art approval'
    )
}
$json = $evidence | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($evidencePath, "$json`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "MAPSOO_ISOMETRIC_PRODUCTION_EVIDENCE_OK manifest_sha256=$expectedManifestHash pack_sha256=$expectedPackHash render_sha256=$($results[0].render_sha256) versions=$($results.Count) evidence=$evidencePath"
