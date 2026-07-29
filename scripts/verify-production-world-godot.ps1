param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$terrain = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'docs\visual-qa\production-art\side-platformer-terrain-atlas-v2.png')).Path
$props = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'docs\visual-qa\production-art\side-platformer-prop-atlas-v1.png')).Path
$character = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'docs\visual-qa\production-art\side-platformer-character-atlas-v1.png')).Path
$background = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'docs\visual-qa\production-art\side-platformer-background-runtime-v1.json')).Path

if ($GodotConsoles.Count -eq 0) {
    $GodotConsoles = @(
        (Join-Path $repoRoot 'release\godot-runtimes\4.3\Godot_v4.3-stable_win64_console.exe'),
        (Join-Path $repoRoot 'release\godot-runtimes\4.7\Godot_v4.7-stable_win64_console.exe')
    )
}
$expected = @{
    terrain = (Get-FileHash -LiteralPath $terrain -Algorithm SHA256).Hash.ToLowerInvariant()
    props = (Get-FileHash -LiteralPath $props -Algorithm SHA256).Hash.ToLowerInvariant()
    character = (Get-FileHash -LiteralPath $character -Algorithm SHA256).Hash.ToLowerInvariant()
}
$results = @()
foreach ($consolePath in $GodotConsoles) {
    $console = (Resolve-Path -LiteralPath $consolePath).Path
    $versionLine = @(& $console --version 2>&1 | ForEach-Object { $_.ToString() })[0]
    $version = $versionLine.Split('.')[0..1] -join '.'
    $arguments = @(
        '--headless', '--path', $godotRoot,
        '--script', 'res://tests/smoke_production_side_platformer_world.gd', '--',
        "--terrain=$terrain", "--props=$props", "--character=$character",
        "--background-manifest=$background", "--repo-root=$repoRoot"
    )
    $output = @(& $console @arguments 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version production world smoke failed."
    }
    $sentinel = $output | Where-Object { $_ -match '^MAPSOO_PRODUCTION_WORLD_GODOT_OK ' } | Select-Object -Last 1
    $sentinelValid = $sentinel -and ($sentinel -match "terrain_sha256=$($expected.terrain)") -and ($sentinel -match "props_sha256=$($expected.props)") -and ($sentinel -match "character_sha256=$($expected.character)") -and ($sentinel -match 'backgrounds=5') -and ($sentinel -match 'cells=20') -and ($sentinel -match 'floor=true run=run_right jump=jump_right exit=exit-node')
    if (-not $sentinelValid) {
        throw "Godot $version production world sentinel is incomplete or mismatched."
    }
    $results += [pscustomobject]@{
        godot = $version
        terrain_sha256 = $expected.terrain
        props_sha256 = $expected.props
        character_sha256 = $expected.character
        backgrounds = 5
        atlas_cells = 20
        floor = $true
        run = 'run_right'
        jump = 'jump_right'
        exit = 'exit-node'
    }
}
$results | ConvertTo-Json -Depth 4
