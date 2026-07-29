param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinelPattern = '^MAPSOO_WORLD_ART_RUNTIME_OVERLAY_V1_1_OK profiles=4 placements=28 repeated=4 persisted=4 disk_fail_closed=4 memory_fail_closed=(?<memory>\d+) apply_fail_closed=1 tamper=2$'

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
            --script 'res://tests/world_art_runtime_overlay_v1_1_smoke.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version WorldArtRuntimeOverlay 1.1 smoke failed."
    }
    $sentinel = $output |
        Where-Object { $_ -match $sentinelPattern } |
        Select-Object -Last 1
    if ($null -eq $sentinel) {
        throw "Godot $version WorldArtRuntimeOverlay 1.1 sentinel is missing."
    }
    $sentinel -match $sentinelPattern | Out-Null
    $memoryFailures = [int]$Matches.memory
    if ($memoryFailures -lt 10) {
        throw "Godot $version proved fewer than 10 in-memory fail-closed cases."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        placements = 28
        repeated_asset_cases = 4
        persisted_scenes = 4
        disk_fail_closed_cases = 4
        memory_fail_closed_cases = $memoryFailures
        wrong_root_cases = 1
        tamper_cases = 2
        status = 'reviewed-runtime-overlay-v1-1-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-art-runtime-overlay-v1-1-qa/1.0'
    status = 'reviewed-runtime-overlay-v1-1-pass'
    runs = $runs
    proves = @(
        'strict exact extracted-file inventory and canonical JSON bytes'
        'WorldArtRuntimeProjection 1.0 source, rights, ordering and PNG evidence'
        'WorldVisualPlacementPlan 1.0 canonical identity and ordering'
        'WorldArtPlacementMap 1.0 canonical identity and source binding'
        'per-placement task, slot, role, variant, atlas cell and pixel-region binding'
        'conversion to exact placement-applier dictionaries'
        'zero-mutation preparation and wrong-root rejection'
        'four-profile PackedScene persistence and reload validation'
    )
    not_proven = @(
        'artistic quality of generated assets'
        'physical Raspberry Pi performance'
    )
} | ConvertTo-Json -Depth 5
