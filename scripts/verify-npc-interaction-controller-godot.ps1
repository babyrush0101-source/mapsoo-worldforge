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
            Where-Object {
                -not [string]::IsNullOrWhiteSpace($_) `
                    -and (Test-Path -LiteralPath $_ -PathType Leaf)
            } |
            Select-Object -Unique
    )
}
if ($GodotConsoles.Count -eq 0) {
    throw 'No Godot console found. Pass -GodotConsoles, set GODOT_BIN, or add godot4/godot to PATH.'
}

foreach ($consolePath in $GodotConsoles) {
    $console = (Resolve-Path -LiteralPath $consolePath).Path
    $versionOutput = @(
        & $console --version 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    if ($LASTEXITCODE -ne 0 -or $versionOutput.Count -lt 1) {
        throw "Cannot read Godot version: $console"
    }
    $version = $versionOutput[0].Split('.')[0..1] -join '.'
    $output = @(
        & $console `
            --headless `
            --path $godotRoot `
            --script 'res://tests/npc_interaction_controller_smoke.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if (
        $exitCode -ne 0 `
        -or $output -match '^(?:SCRIPT )?ERROR:' `
        -or -not (
            $output -contains (
                'MAPSOO_NPC_INTERACTION_OK profiles=4 direct=4 ' `
                + 'nearest=true stable-tie=true input-edge=2 negative=2'
            )
        )
    ) {
        throw "Godot $version shared NPC interaction smoke failed."
    }
}
