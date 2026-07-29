param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinelPattern = '^WORLD_ART_RUNTIME_OVERLAY_V1_1_CAPTURE_SMOKE_OK profiles=4 modes=5 captures=8 movie_writer=2 same_count_key_tamper=1$'

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
            --script 'res://tests/world_art_runtime_overlay_v1_1_capture_smoke.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version WorldArtRuntimeOverlay 1.1 capture smoke failed."
    }
    $sentinel = $output |
        Where-Object { $_ -match $sentinelPattern } |
        Select-Object -Last 1
    if ($null -eq $sentinel) {
        throw "Godot $version WorldArtRuntimeOverlay 1.1 capture sentinel is missing."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        evidence_modes = 5
        png_captures = 8
        avi_captures = 2
        same_count_key_tamper = 1
        status = 'runtime-overlay-v1-1-capture-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-art-runtime-overlay-v1-1-capture-qa/1.0'
    status = 'runtime-overlay-v1-1-capture-pass'
    runs = $runs
    proves = @(
        'five runtime evidence modes render through the combined 1.1 loader'
        'terrain, landmark, hazard and projected player art are applied'
        'background, prop, structure, effect, actor and depth placements are applied'
        'expected binding keys use the TypeScript inventory algorithm'
        'applied binding keys are reconstructed from scene nodes and receipts'
        'canonical binding digests match and same-count key substitution fails closed'
        'PNG and AVI evidence are written by real Godot rendering'
    )
    unchanged = @(
        'capture_world_art_runtime_overlay.gd'
        'world_art_runtime_overlay_capture_smoke.gd'
        'mapsoo_world_art_runtime_overlay.gd'
        'TypeScript sources'
    )
} | ConvertTo-Json -Depth 5
