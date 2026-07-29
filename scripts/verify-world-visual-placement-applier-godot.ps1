param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinelPattern = '^MAPSOO_WORLD_VISUAL_PLACEMENT_APPLIER_OK profiles=4 placements=28 repeated=4 persisted=4 fail_closed=(?<failClosed>\d+) tamper=2$'

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
            --script 'res://tests/world_visual_placement_applier_smoke.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version WorldVisualPlacementPlan applier smoke failed."
    }
    $sentinel = $output |
        Where-Object { $_ -match $sentinelPattern } |
        Select-Object -Last 1
    if ($null -eq $sentinel) {
        throw "Godot $version WorldVisualPlacementPlan applier sentinel is missing."
    }
    $sentinel -match $sentinelPattern | Out-Null
    $failClosed = [int]$Matches.failClosed
    if ($failClosed -lt 10) {
        throw "Godot $version proved fewer than 10 fail-closed cases."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        placements = 28
        repeated_asset_cases = 4
        persisted_scenes = 4
        fail_closed_cases = $failClosed
        tamper_cases = 2
        status = 'world-visual-placements-v1-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-visual-placement-applier-qa/1.0'
    status = 'world-visual-placements-v1-pass'
    runs = $runs
    proves = @(
        'prepare performs no scene mutation'
        'fixed semantic canvas layers and render order'
        'sprite, depth-plane, effect and actor materialization'
        'layout-materializer anchor projection, including isometric'
        'one reviewed asset reused by multiple placements'
        'PackedScene persistence and reload validation'
        'exact placement, binding, asset and texture inventories'
        'metadata, texture-cell digest and unexpected-node tamper rejection'
    )
    not_proven = @(
        'artistic quality of generated assets'
        'physical Raspberry Pi performance'
    )
} | ConvertTo-Json -Depth 5
