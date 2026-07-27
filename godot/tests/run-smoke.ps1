param(
    [string]$GodotConsole = $env:GODOT_BIN,
    [switch]$KeepGenerated
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$godotRoot = Join-Path $repoRoot "godot"
$generatedRoot = Join-Path $godotRoot "tests\.generated"
$importsRoot = Join-Path $godotRoot "mapsoo_imports"

if ([string]::IsNullOrWhiteSpace($GodotConsole)) {
    foreach ($commandName in @("godot4", "godot")) {
        $command = Get-Command $commandName -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            $GodotConsole = $command.Source
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($GodotConsole) -or -not (Test-Path -LiteralPath $GodotConsole -PathType Leaf)) {
    throw "Godot console executable not found. Pass -GodotConsole, set GODOT_BIN, or add godot4/godot to PATH."
}

$GodotConsole = (Resolve-Path -LiteralPath $GodotConsole).Path

if (-not (Test-Path -LiteralPath (Join-Path $godotRoot "addons\mapsoo_importer\mapsoo_pack_importer.gd") -PathType Leaf)) {
    throw "Mapsoo importer addon is missing. Expected godot/addons/mapsoo_importer/mapsoo_pack_importer.gd"
}

function Remove-TestDirectory([string]$Target) {
    if (-not (Test-Path -LiteralPath $Target)) { return }
    $resolvedTarget = (Resolve-Path -LiteralPath $Target).Path
    $resolvedGodot = (Resolve-Path -LiteralPath $godotRoot).Path
    if (-not $resolvedTarget.StartsWith($resolvedGodot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete test data outside godot/: $resolvedTarget"
    }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}

function Invoke-Godot([string]$Label, [string[]]$Arguments) {
    $output = & $GodotConsole @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_.ToString() }
    if ($exitCode -ne 0) {
        throw "$Label failed with exit code $exitCode"
    }
    if (($output | ForEach-Object { $_.ToString() }) -match "(?m)^(?:SCRIPT )?ERROR:") {
        throw "$Label emitted a Godot engine error"
    }
}

try {
    Remove-TestDirectory $generatedRoot
    Remove-TestDirectory $importsRoot
    Invoke-Godot "Fixture generation" @("--headless", "--path", $godotRoot, "--script", "res://tests/generate_fixture.gd")
    Invoke-Godot "Alpha.4 fixture generation" @("--headless", "--path", $godotRoot, "--script", "res://tests/generate_alpha4_fixture.gd")
    Invoke-Godot "Alpha.5 fixture generation" @("--headless", "--path", $godotRoot, "--script", "res://tests/generate_alpha5_fixture.gd")
    Invoke-Godot "Alpha.6 fixture generation" @("--headless", "--path", $godotRoot, "--script", "res://tests/generate_alpha6_fixture.gd")
    Invoke-Godot "Alpha.7 fixture generation" @("--headless", "--path", $godotRoot, "--script", "res://tests/generate_alpha7_fixture.gd")

    # A separate editor pass imports the freshly generated PNGs before the importer loads them.
    Invoke-Godot "Godot resource import" @("--headless", "--editor", "--path", $godotRoot, "--import")

    Invoke-Godot "Importer smoke test" @("--headless", "--path", $godotRoot, "--script", "res://tests/import_smoke.gd")
    Invoke-Godot "Alpha.4 importer smoke test" @("--headless", "--path", $godotRoot, "--script", "res://tests/import_alpha4_smoke.gd")
    Invoke-Godot "Alpha.5 importer smoke test" @("--headless", "--path", $godotRoot, "--script", "res://tests/import_alpha5_smoke.gd")
    Invoke-Godot "Alpha.6 importer smoke test" @("--headless", "--path", $godotRoot, "--script", "res://tests/import_alpha6_smoke.gd")
    Invoke-Godot "Alpha.7 exact-pack smoke test" @(
        "--headless", "--path", $godotRoot, "--script", "res://tests/import_pack_cli.gd", "--",
        "--manifest=res://tests/.generated/pack-alpha7/mapsoo.manifest.json",
        "--expected-pack-id=alpha7-smoke-pack", "--expected-schema=0.5.0",
        "--expected-cells=64", "--expected-props=6", "--expected-places=4", "--expected-structures=4",
        "--check-conflict=true"
    )
    Invoke-Godot "WorldLayoutPlan attachment smoke test" @(
        "--headless", "--path", $godotRoot,
        "--script", "res://tests/world_layout_attachment_smoke.gd"
    )
    Invoke-Godot "WorldLayoutPlan materializer smoke test" @(
        "--headless", "--path", $godotRoot,
        "--script", "res://tests/world_layout_materializer_smoke.gd"
    )
}
finally {
    if (-not $KeepGenerated) {
        Remove-TestDirectory $generatedRoot
        Remove-TestDirectory $importsRoot
    }
}
