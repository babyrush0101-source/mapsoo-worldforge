param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinelPattern = '^MAPSOO_WORLD_ART_RUNTIME_OVERLAY_V1_1_COMBINED_OK profiles=4 terrain=(?<terrain>\d+) landmarks=(?<landmarks>\d+) hazards=8 characters=4 placements=32 persisted=4 status_conflicts=2 binding_tamper=2$'

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
            --script 'res://tests/world_art_runtime_overlay_v1_1_combined_smoke.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version combined WorldArtRuntimeOverlay 1.1 smoke failed."
    }
    $sentinel = $output |
        Where-Object { $_ -match $sentinelPattern } |
        Select-Object -Last 1
    if ($null -eq $sentinel) {
        throw "Godot $version combined WorldArtRuntimeOverlay 1.1 sentinel is missing."
    }
    $sentinel -match $sentinelPattern | Out-Null
    if ([int]$Matches.terrain -lt 4 -or [int]$Matches.landmarks -lt 4) {
        throw "Godot $version did not prove terrain and landmark coexistence."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        terrain_materials = [int]$Matches.terrain
        landmarks = [int]$Matches.landmarks
        hazards = 8
        characters = 4
        placements = 32
        persisted_scenes = 4
        status_conflicts = 2
        binding_tamper_cases = 2
        status = 'combined-runtime-v1-v1-1-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-art-runtime-overlay-v1-1-combined-qa/1.0'
    status = 'combined-runtime-v1-v1-1-pass'
    runs = $runs
    proves = @(
        'frozen 1.0 catalog status remains reviewed-runtime-overlay-v1'
        'independent 1.1 placement identity metadata'
        'terrain, landmark, hazard and projected-player consumers coexist'
        'background, prop, structure, effect, actor and depth placements coexist'
        'textures indexed compatibly by both task id and portable path'
        'combined PackedScene persistence and reload validation'
        'old/new status conflicts and shortened bindings fail closed'
    )
    unchanged = @(
        'mapsoo_world_art_runtime_overlay.gd'
        'mapsoo_world_art_runtime_overlay_applier.gd'
        'mapsoo_world_art_runtime_hazard_applier.gd'
        'mapsoo_world_art_runtime_character_applier.gd'
    )
} | ConvertTo-Json -Depth 5
