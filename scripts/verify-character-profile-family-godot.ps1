param(
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$generatedRoot = (Join-Path $godotRoot 'tests\.generated')
$fixtureRoot = Join-Path $generatedRoot 'character-family'

New-Item -ItemType Directory -Path $generatedRoot -Force | Out-Null
$resolvedGeneratedRoot = (Resolve-Path -LiteralPath $generatedRoot).Path
$resolvedFixtureParent = (Resolve-Path -LiteralPath (Split-Path -Parent $fixtureRoot)).Path
if ($resolvedFixtureParent -ne $resolvedGeneratedRoot) {
    throw 'Character family fixture target escaped godot/tests/.generated.'
}
if (Test-Path -LiteralPath $fixtureRoot) {
    $resolvedFixture = (Resolve-Path -LiteralPath $fixtureRoot).Path
    $expectedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
    if ($resolvedFixture -ne $expectedFixture -or -not $resolvedFixture.StartsWith(
        $resolvedGeneratedRoot + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw 'Character family fixture delete target is unsafe.'
    }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if ($null -eq $pnpm) {
    $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
}
if ($null -eq $pnpm) {
    throw 'pnpm is required to build the character family Godot fixture.'
}
& $pnpm.Source exec vite-node scripts/build-character-profile-family-godot-fixture.ts `
    --out $fixtureRoot
if ($LASTEXITCODE -ne 0) {
    throw 'Character family Godot fixture generation failed.'
}

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
            --script 'res://tests/character_profile_family_runtime_smoke.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version character family runtime smoke failed."
    }
    $sentinel = $output |
        Where-Object {
            $_ -eq 'MAPSOO_CHARACTER_FAMILY_GODOT_OK profiles=4 clips=84 source_images=false'
        } |
        Select-Object -Last 1
    if (-not $sentinel) {
        throw "Godot $version character family runtime sentinel is missing."
    }
    $results += [ordered]@{
        godot = $version
        profiles = 4
        clips = 84
        source_images_included = $false
        status = 'technical-runtime-pass'
    }
}

[ordered]@{
    schema_version = 'mapsoo-character-profile-family-runtime-qa/1.0'
    status = 'technical-runtime-pass'
    fixture_distribution = 'internal-review'
    runs = $results
    not_proven = @(
        'model-generated production art quality'
        'human identity and art approval'
        'physical Raspberry Pi performance'
    )
} | ConvertTo-Json -Depth 5
