param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinel = '^WORLD_ART_RUNTIME_OVERLAY_CAPTURE_SMOKE_OK profiles=4 captures=8 movie_writer=2$'

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
                --script 'res://tests/world_art_runtime_overlay_capture_smoke.gd' 2>&1 |
                ForEach-Object { $_.ToString() }
        )
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version runtime overlay evidence capture smoke failed."
    }
    if (-not ($output -match $sentinel)) {
        throw "Godot $version runtime overlay evidence capture sentinel is missing."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        captures = 8
        movie_writer = 2
        status = 'runtime-overlay-capture-v1-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-art-runtime-overlay-capture-qa/1.0'
    status = 'runtime-overlay-capture-v1-pass'
    runs = $runs
    proves = @(
        'all four profiles render through the shared runtime overlay capture path'
        'terrain, landmark, hazard, and player bindings reach the evidence scene'
        'role and collision overlays are capturable'
        'spawn-to-exit and navigation routes produce Godot-native AVI evidence'
    )
    not_proven = @(
        'holistic human composition approval'
        'physical Raspberry Pi 4B performance'
        'catalog-only assets that do not have runtime projection bindings'
    )
} | ConvertTo-Json -Depth 5
