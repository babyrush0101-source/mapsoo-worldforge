param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinel = '^MAPSOO_WORLD_ART_RUNTIME_OVERLAY_APPLIER_OK profiles=4 terrain=[1-9][0-9]* landmarks=[1-9][0-9]* hazards=8 persisted=4 tamper=6$'

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
                --script 'res://tests/world_art_runtime_overlay_applier_smoke.gd' 2>&1 |
                ForEach-Object { $_.ToString() }
        )
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version runtime overlay visual application smoke failed."
    }
    if (-not ($output -match $sentinel)) {
        throw "Godot $version runtime overlay visual application sentinel is missing."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        persisted_scenes = 4
        status = 'reviewed-runtime-overlay-gameplay-v1-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-art-runtime-overlay-applier-qa/1.0'
    status = 'reviewed-runtime-overlay-gameplay-v1-pass'
    runs = $runs
    proves = @(
        'one shared applier reuses the authoritative logical TileMapLayer'
        'reviewed terrain textures preserve exact logical material source IDs'
        'reviewed landmark sprites attach to existing layout Marker2D nodes'
        'reviewed hazard art and collision derive from projection logical rectangles'
        'all four trusted controllers respawn from materialized layout hazards'
        'terrain, landmark, and hazard bindings survive PackedScene persistence'
        'incomplete or conflicting catalogs fail before scene mutation'
    )
    not_proven = @(
        'projected character visual application'
        'human approval of real provider-generated art'
        'physical Raspberry Pi 4B performance'
    )
} | ConvertTo-Json -Depth 5
