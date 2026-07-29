param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$sentinel = 'MAPSOO_WORLD_ART_RUNTIME_OVERLAY_OK profiles=4 loaded=4 persisted=4 grants=1 tamper=6 executable_files=0'

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
                --script 'res://tests/world_art_runtime_overlay_smoke.gd' 2>&1 |
                ForEach-Object { $_.ToString() }
        )
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version WorldArtRuntimeOverlay smoke failed."
    }
    if (-not ($output -contains $sentinel)) {
        throw "Godot $version WorldArtRuntimeOverlay sentinel is missing."
    }
    $runs += [ordered]@{
        godot = $version
        profiles = 4
        persisted_scenes = 4
        local_grants = 1
        tamper_cases = 6
        status = 'reviewed-runtime-overlay-v1-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-world-art-runtime-overlay-qa/1.0'
    status = 'reviewed-runtime-overlay-v1-pass'
    runs = $runs
    proves = @(
        'one shared loader for all four world profiles'
        'exact manifest, projection, PNG byte and SHA-256 validation'
        'portable lossless texture persistence through PackedScene'
        'layout and profile binding before scene mutation'
        'no executable files accepted from the data overlay'
        'fail-closed layout, PNG, rights and scene-profile tamper handling'
    )
    not_proven = @(
        'terrain, landmark, hazard or character visual application'
        'human approval of real provider-generated art'
        'physical Raspberry Pi 4B performance'
    )
} | ConvertTo-Json -Depth 5
