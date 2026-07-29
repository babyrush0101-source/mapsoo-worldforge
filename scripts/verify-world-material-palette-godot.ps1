param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinel = 'MAPSOO_WORLD_MATERIAL_PALETTE_OK profiles=4 visible=4 projected=4 persisted=4 tamper=4'

if ($GodotConsoles.Count -eq 0) {
    $candidates = @(
        (Join-Path $repoRoot 'release\godot-runtimes\4.3\Godot_v4.3-stable_win64_console.exe'),
        (Join-Path $repoRoot 'release\godot-runtimes\4.7\Godot_v4.7-stable_win64_console.exe')
    )
    if (-not [string]::IsNullOrWhiteSpace($env:GODOT_BIN)) {
        $candidates += $env:GODOT_BIN
    }
    foreach ($commandName in @('godot4', 'godot')) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            $candidates += $command.Source
        }
    }
    $GodotConsoles = @(
        $candidates |
            Where-Object {
                -not [string]::IsNullOrWhiteSpace($_) -and
                (Test-Path -LiteralPath $_ -PathType Leaf)
            } |
            Select-Object -Unique
    )
    if ($GodotConsoles.Count -eq 0) {
        throw 'No Godot console found. Pass -GodotConsoles, set GODOT_BIN, or add godot4/godot to PATH.'
    }
}

$runs = @()
foreach ($consolePath in $GodotConsoles) {
    $consoleResolved = (Resolve-Path -LiteralPath $consolePath).Path
    $versionOutput = @(
        & $consoleResolved --version 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    if ($LASTEXITCODE -ne 0 -or $versionOutput.Count -lt 1) {
        throw "Cannot read Godot version: $consoleResolved"
    }
    $version = $versionOutput[0].Split('.')[0..1] -join '.'
    $output = @(
        & $consoleResolved `
            --headless `
            --path $godotRoot `
            --script 'res://tests/world_material_palette_smoke.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version WorldMaterialPalette smoke failed."
    }
    if (-not ($output -contains $sentinel)) {
        throw "Godot $version WorldMaterialPalette sentinel is missing."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        visible_tilemaps = 4
        projected_tilemaps = 4
        persisted_scenes = 4
        tamper_cases = 4
        status = 'production-tiles-v1-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-material-palette-qa/1.0'
    status = 'production-tiles-v1-pass'
    runs = $runs
    proves = @(
        'exact WorldLayoutPlan hash binding'
        'complete logical-material coverage'
        'canonical terrain-role catalog validation'
        'visible Godot TileMapLayer and TileSet persistence'
        'profile-specific coordinate projection'
        'fail-closed tamper handling before scene mutation'
    )
    not_proven = @(
        'automatic terrain transitions or visual variants'
        'human art-direction approval'
        'physical Raspberry Pi performance'
    )
} | ConvertTo-Json -Depth 5
