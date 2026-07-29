param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$evidenceRoot = Join-Path $repoRoot 'docs\visual-qa\production-art'
$layersManifest = (Resolve-Path -LiteralPath (Join-Path $evidenceRoot 'layered-depth-2d-production-layers-v1.json')).Path
$propsManifest = (Resolve-Path -LiteralPath (Join-Path $evidenceRoot 'layered-depth-2d-prop-atlas-v1.json')).Path
$playerManifest = (Resolve-Path -LiteralPath (Join-Path $evidenceRoot 'layered-depth-2d-player-atlas-v1.json')).Path
$npcManifest = (Resolve-Path -LiteralPath (Join-Path $evidenceRoot 'layered-depth-2d-npc-atlas-v1.json')).Path
$evidencePath = Join-Path $evidenceRoot 'layered-depth-2d-production-candidate-godot-render-v1.json'
$expectedLayersHash = (Get-FileHash -LiteralPath $layersManifest -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedPropsHash = (Get-FileHash -LiteralPath $propsManifest -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedPlayerHash = (Get-FileHash -LiteralPath $playerManifest -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedNpcHash = (Get-FileHash -LiteralPath $npcManifest -Algorithm SHA256).Hash.ToLowerInvariant()

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
    $output = Join-Path $evidenceRoot "layered-depth-2d-production-godot-$version-v1.png"
    $stdout = Join-Path $evidenceRoot "layered-depth-2d-production-godot-$version-v1.stdout.log"
    $stderr = Join-Path $evidenceRoot "layered-depth-2d-production-godot-$version-v1.stderr.log"
    $arguments = @(
        '--path', $godotRoot,
        '--display-driver', 'windows',
        '--audio-driver', 'Dummy',
        '--resolution', '640x360',
        '--script', 'res://tests/capture_production_layered_depth_2d_candidate.gd',
        '--',
        ('"--layers-manifest={0}"' -f $layersManifest),
        ('"--props-manifest={0}"' -f $propsManifest),
        ('"--player-manifest={0}"' -f $playerManifest),
        ('"--npc-manifest={0}"' -f $npcManifest),
        ('"--repo-root={0}"' -f $repoRoot),
        ('"--output={0}"' -f $output)
    )
    $runtimeUserData = Join-Path $godotRoot "tests\.generated\user-data-layered-depth-$version"
    New-Item -ItemType Directory -Force -Path $runtimeUserData | Out-Null
    $previousAppData = $env:APPDATA
    $previousLocalAppData = $env:LOCALAPPDATA
    $env:APPDATA = $runtimeUserData
    $env:LOCALAPPDATA = $runtimeUserData
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $console @arguments 1> $stdout 2> $stderr
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    $env:APPDATA = $previousAppData
    $env:LOCALAPPDATA = $previousLocalAppData
    $log = @(
        Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue
        Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue
    )
    $log | ForEach-Object { Write-Host $_ }
    $fatalLog = $log | Where-Object {
        ($_ -match '^(?:SCRIPT )?ERROR:') -and
        ($_ -notmatch '^ERROR: Failed to read the root certificate store\.$')
    }
    if ($exitCode -ne 0 -or $fatalLog) {
        throw "Godot $version layered-depth production candidate failed."
    }
    $sentinel = $log |
        Where-Object { $_ -match '^MAPSOO_LAYERED_DEPTH_PRODUCTION_GODOT_OK ' } |
        Select-Object -Last 1
    if (-not $sentinel) {
        throw "Godot $version did not emit the layered-depth production sentinel."
    }
    $dimensions = Get-PngDimensions -Path $output
    $renderHash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    $valid = `
        ($dimensions.Width -eq 640) -and `
        ($dimensions.Height -eq 360) -and `
        ($sentinel -match "layers_sha256=$expectedLayersHash") -and `
        ($sentinel -match "props_sha256=$expectedPropsHash") -and `
        ($sentinel -match "player_sha256=$expectedPlayerHash") -and `
        ($sentinel -match "npc_sha256=$expectedNpcHash") -and `
        ($sentinel -match "render_sha256=$renderHash") -and `
        ($sentinel -match 'layers=8 front_layers=2 prop_roles=22 player_clips=16 npc_clips=8 collisions=1 collectibles=1 npc_interactions=1 navigation=7/6 spawn=112,286 exit=exit-node route=npc-collectible-blocker-stairs-bridge-exit route_gate=pass animation=walk_right')
    if (-not $valid) {
        throw "Godot $version layered-depth production evidence is incomplete or mismatched."
    }
    $pixelHash = [regex]::Match($sentinel, 'pixel_sha256=([0-9a-f]{64})').Groups[1].Value
    $colorCount = [int]([regex]::Match($sentinel, 'colors=([0-9]+)').Groups[1].Value)
    $results += [pscustomobject][ordered]@{
        godot = $version
        production_layers_manifest_sha256 = $expectedLayersHash
        prop_atlas_manifest_sha256 = $expectedPropsHash
        player_atlas_manifest_sha256 = $expectedPlayerHash
        npc_atlas_manifest_sha256 = $expectedNpcHash
        render_path = $output.Substring($repoRoot.Length + 1).Replace('\', '/')
        render_sha256 = $renderHash
        pixel_sha256 = $pixelHash
        render_bytes = (Get-Item -LiteralPath $output).Length
        width = $dimensions.Width
        height = $dimensions.Height
        runtime_layers = 8
        front_layers = 2
        prop_roles = 22
        player_clips = 16
        npc_clips = 8
        collision_shapes = 1
        collectibles = 1
        npc_interactions = 1
        navigation_nodes = 7
        navigation_edges = 6
        spawn = '112,286'
        exit = 'exit-node'
        route = 'npc-collectible-blocker-stairs-bridge-exit'
        route_occlusion_gate = 'pass'
        animation = 'walk_right'
        quantized_colors = $colorCount
    }
}

if (($results | Select-Object -ExpandProperty render_sha256 -Unique).Count -ne 1) {
    throw 'Godot 4.3 and 4.7 layered-depth production renders are not identical.'
}
if (($results | Select-Object -ExpandProperty pixel_sha256 -Unique).Count -ne 1) {
    throw 'Godot 4.3 and 4.7 layered-depth production pixel buffers are not identical.'
}

$evidence = [ordered]@{
    schema_version = 'mapsoo-production-godot-evidence/1.0'
    id = 'layered-depth-2d-production-candidate-godot-render-v1'
    profile = 'layered-depth-2d'
    status = 'runtime-candidate'
    distribution = 'internal-review'
    output_license = 'UNRELEASED'
    production_layers_manifest = 'docs/visual-qa/production-art/layered-depth-2d-production-layers-v1.json'
    production_layers_manifest_sha256 = $expectedLayersHash
    prop_atlas_manifest = 'docs/visual-qa/production-art/layered-depth-2d-prop-atlas-v1.json'
    prop_atlas_manifest_sha256 = $expectedPropsHash
    player_atlas_manifest = 'docs/visual-qa/production-art/layered-depth-2d-player-atlas-v1.json'
    player_atlas_manifest_sha256 = $expectedPlayerHash
    npc_atlas_manifest = 'docs/visual-qa/production-art/layered-depth-2d-npc-atlas-v1.json'
    npc_atlas_manifest_sha256 = $expectedNpcHash
    checks = [ordered]@{
        exact_eight_layer_bindings = 'pass'
        mother_prop_atlas_all_roles = 'pass'
        mother_character_atlas_clips = 'pass'
        front_layer_visibility = 'pass'
        central_route_occlusion_gate = 'pass'
        blocker_physics = 'pass'
        npc_interaction = 'pass'
        collectible_trigger = 'pass'
        stairs_and_bridge_traversal = 'pass'
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
Write-Host "MAPSOO_LAYERED_DEPTH_PRODUCTION_EVIDENCE_OK layers_sha256=$expectedLayersHash props_sha256=$expectedPropsHash player_sha256=$expectedPlayerHash npc_sha256=$expectedNpcHash render_sha256=$($results[0].render_sha256) versions=$($results.Count) evidence=$evidencePath"
