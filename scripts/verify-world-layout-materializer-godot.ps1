param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinel = 'MAPSOO_WORLD_LAYOUT_MATERIALIZER_OK profiles=4 deterministic=4 persisted=4 absent=1 tamper=2'

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
            --script 'res://tests/world_layout_materializer_smoke.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version WorldLayoutPlan materializer smoke failed."
    }
    if (-not ($output -contains $sentinel)) {
        throw "Godot $version WorldLayoutPlan materializer sentinel is missing."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        deterministic_replays = 4
        persisted_scenes = 4
        absent_compatibility = 1
        tamper_cases = 2
        status = 'profile-layout-v1-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-layout-materializer-qa/1.0'
    status = 'profile-layout-v1-pass'
    runs = $runs
    proves = @(
        'authoritative logical TileMapLayer cells'
        'profile-specific projected map polygons'
        'StaticBody2D collision geometry and one-way semantics'
        'NavigationRegion2D polygons and NavigationLink2D traversal'
        'profile-specific logical-to-world coordinate projection'
        'runtime PlayerSpawn and Player binding'
        'deterministic persisted scene structure'
        'no-layout backward compatibility'
        'post-validation tamper rejection before scene mutation'
    )
    not_proven = @(
        'art-directed TileSet selection'
        'physical Raspberry Pi performance'
    )
} | ConvertTo-Json -Depth 5
