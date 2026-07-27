param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinel = 'MAPSOO_WORLD_TERRAIN_AUTOTILE_OK'

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
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(
            & $consoleResolved `
                --headless `
                --path $godotRoot `
                --script 'res://tests/world_terrain_autotile_smoke.gd' 2>&1 |
                ForEach-Object { $_.ToString() }
        )
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version WorldTerrainAutotile smoke failed."
    }
    if (-not ($output -match "^$sentinel ")) {
        throw "Godot $version WorldTerrainAutotile sentinel is missing."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        persisted_scenes = 4
        tamper_cases = 4
        status = 'terrain-autotiles-v1-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-terrain-autotile-qa/1.0'
    status = 'terrain-autotiles-v1-pass'
    runs = $runs
    proves = @(
        'provider-neutral 4x4 atlas contract'
        'explicit N/E/S/W edge-mask selection'
        'all four world profiles'
        'single-cell palette fallback before optional enhancement'
        'persisted TileSet and TileMap semantics'
        'fail-closed tamper handling before scene mutation'
        'shared runtime semantics used by the Pack importer attachment'
    )
    not_proven = @(
        'real third-party authoring adapter'
        'human art-direction approval'
        'physical Raspberry Pi performance'
    )
} | ConvertTo-Json -Depth 5
