param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'

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
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) } |
            Select-Object -Unique
    )
    if ($GodotConsoles.Count -eq 0) {
        throw 'No Godot console found. Pass -GodotConsoles, set GODOT_BIN, or add godot4/godot to PATH.'
    }
}

$results = @()
foreach ($consolePath in $GodotConsoles) {
    $consoleResolved = (Resolve-Path -LiteralPath $consolePath).Path
    $versionOutput = @(& $consoleResolved --version 2>&1 | ForEach-Object { $_.ToString() })
    if ($LASTEXITCODE -ne 0 -or $versionOutput.Count -lt 1) {
        throw "Cannot read Godot version: $consoleResolved"
    }
    $version = $versionOutput[0].Split('.')[0..1] -join '.'
    if ($version -notmatch '^\d+\.\d+$') {
        throw "Unexpected Godot version: $($versionOutput[0])"
    }
    $output = @(
        & $consoleResolved `
            --headless `
            --path $godotRoot `
            --script 'res://tests/character_profile_runtime_smoke.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version character-profile runtime smoke failed."
    }
    $sentinel = $output |
        Where-Object { $_ -eq 'MAPSOO_CHARACTER_PROFILE_RUNTIME_OK profiles=4 negative=7' } |
        Select-Object -Last 1
    if (-not $sentinel) {
        throw "Godot $version character-profile runtime sentinel is missing."
    }
    $results += [ordered]@{
        godot = $version
        profiles = 4
        negative_cases = 7
        status = 'technical-runtime-pass'
        physical_raspberry_pi = 'not-tested'
    }
}

[ordered]@{
    schema_version = 'mapsoo-character-profile-runtime-qa/1.0'
    status = 'technical-runtime-pass'
    runs = $results
    not_proven = @(
        'semantic identity fidelity'
        'human art approval'
        'physical Raspberry Pi performance'
    )
} | ConvertTo-Json -Depth 5
