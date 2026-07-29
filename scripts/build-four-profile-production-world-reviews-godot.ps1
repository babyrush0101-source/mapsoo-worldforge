param(
    [string]$GodotConsole = '',
    [string]$OutputRoot = '',
    [ValidateSet('4.3', '4.7')]
    [string]$GodotVersion = '4.3',
    [ValidateSet(
        'side-platformer',
        'topdown-farm',
        'isometric-action',
        'layered-depth-2d'
    )]
    [string[]]$Profiles = @(
        'side-platformer',
        'topdown-farm',
        'isometric-action',
        'layered-depth-2d'
    )
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$evidenceRoot = Join-Path $repoRoot 'docs\visual-qa\production-art'

if ([string]::IsNullOrWhiteSpace($GodotConsole)) {
    $GodotConsole = Join-Path `
        $repoRoot `
        "release\godot-runtimes\$GodotVersion\Godot_v$GodotVersion-stable_win64_console.exe"
}
$GodotConsole = (Resolve-Path -LiteralPath $GodotConsole).Path

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot '.codex_tmp\production-world-reviews'
} elseif (-not [System.IO.Path]::IsPathRooted($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot $OutputRoot
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$versionLine = @(& $GodotConsole --version 2>&1 | ForEach-Object { $_.ToString() })[0]
if (-not $versionLine.StartsWith("$GodotVersion.")) {
    throw "Expected Godot $GodotVersion, received: $versionLine"
}

$profileDefinitions = [ordered]@{
    'side-platformer' = [ordered]@{
        review_id = 'side-platformer-production-v1'
        resolution = '640x360'
        script = 'res://tests/capture_production_side_platformer_candidate.gd'
        preview = 'side-platformer-production-preview-v1.png'
        source_args = @(
            [ordered]@{
                flag = '--manifest'
                file = 'side-platformer-production-preview-v1.json'
            }
        )
    }
    'topdown-farm' = [ordered]@{
        review_id = 'topdown-farm-production-v1'
        resolution = '640x480'
        script = 'res://tests/capture_production_topdown_farm_candidate.gd'
        preview = 'topdown-farm-production-preview-v1.png'
        source_args = @(
            [ordered]@{
                flag = '--manifest'
                file = 'topdown-farm-production-preview-v1.json'
            }
        )
    }
    'isometric-action' = [ordered]@{
        review_id = 'isometric-action-production-v1'
        resolution = '640x360'
        script = 'res://tests/capture_production_isometric_action_candidate.gd'
        preview = 'isometric-action-production-preview-v1.png'
        source_args = @(
            [ordered]@{
                flag = '--manifest'
                file = 'isometric-action-production-preview-v1.json'
            }
        )
    }
    'layered-depth-2d' = [ordered]@{
        review_id = 'layered-depth-2d-production-v1'
        resolution = '640x360'
        script = 'res://tests/capture_production_layered_depth_2d_candidate.gd'
        preview = 'layered-depth-2d-production-preview-v1.png'
        source_args = @(
            [ordered]@{
                flag = '--layers-manifest'
                file = 'layered-depth-2d-production-layers-v1.json'
            },
            [ordered]@{
                flag = '--props-manifest'
                file = 'layered-depth-2d-prop-atlas-v1.json'
            },
            [ordered]@{
                flag = '--player-manifest'
                file = 'layered-depth-2d-player-atlas-v1.json'
            },
            [ordered]@{
                flag = '--npc-manifest'
                file = 'layered-depth-2d-npc-atlas-v1.json'
            }
        )
    }
}

function Assert-Png {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Godot did not write PNG evidence: $Path"
    }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $signature = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
    if ($bytes.Length -lt 33) {
        throw "PNG evidence is truncated: $Path"
    }
    for ($index = 0; $index -lt $signature.Length; $index += 1) {
        if ($bytes[$index] -ne $signature[$index]) {
            throw "Evidence is not a PNG: $Path"
        }
    }
}

function Assert-Avi {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Godot did not write AVI evidence: $Path"
    }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if (
        $bytes.Length -lt 12 `
        -or [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RIFF' `
        -or [System.Text.Encoding]::ASCII.GetString($bytes, 8, 4) -ne 'AVI '
    ) {
        throw "Traversal evidence is not a Godot-native RIFF AVI: $Path"
    }
    $declaredBytes = [BitConverter]::ToUInt32($bytes, 4) + 8
    if ($declaredBytes -gt $bytes.Length -or $declaredBytes -lt 12) {
        throw "Traversal AVI has an invalid RIFF boundary: $Path"
    }
}

function Invoke-GodotCapture {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Definition,
        [Parameter(Mandatory = $true)][string]$Mode,
        [Parameter(Mandatory = $true)][string]$PngPath,
        [string]$MoviePath = ''
    )

    $stdout = "$PngPath.stdout.log"
    $stderr = "$PngPath.stderr.log"
    $arguments = @(
        '--path', $godotRoot,
        '--display-driver', 'windows',
        '--audio-driver', 'Dummy',
        '--resolution', $Definition.resolution
    )
    if (-not [string]::IsNullOrEmpty($MoviePath)) {
        $arguments += @(
            '--fixed-fps', '30',
            '--write-movie', ('"{0}"' -f $MoviePath)
        )
    }
    $arguments += @(
        '--script', $Definition.script,
        '--'
    )
    foreach ($sourceArg in $Definition.source_args) {
        $sourcePath = (Resolve-Path -LiteralPath (Join-Path $evidenceRoot $sourceArg.file)).Path
        $arguments += ('"{0}={1}"' -f $sourceArg.flag, $sourcePath)
    }
    $arguments += @(
        ('"--repo-root={0}"' -f $repoRoot),
        ('"--output={0}"' -f $PngPath),
        ('"--evidence-mode={0}"' -f $Mode)
    )

    $process = Start-Process `
        -FilePath $GodotConsole `
        -ArgumentList $arguments `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru `
        -Wait
    $log = @(
        Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue
        Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue
    )
    $fatalLog = $log | Where-Object {
        ($_ -match '^(?:SCRIPT )?ERROR:') `
        -and ($_ -notmatch '^ERROR: Failed to read the root certificate store\.$')
    }
    if (
        $process.ExitCode -ne 0 `
        -or $fatalLog `
        -or -not ($log | Where-Object { $_ -match '^MAPSOO_.*_OK ' })
    ) {
        $log | ForEach-Object { Write-Host $_ }
        throw "Godot production review capture failed in mode '$Mode'."
    }
    Assert-Png -Path $PngPath
    if (-not [string]::IsNullOrEmpty($MoviePath)) {
        Assert-Avi -Path $MoviePath
    }
    Remove-Item -LiteralPath $stdout, $stderr -Force
}

function Resolve-Pnpm {
    $command = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        $command = Get-Command 'pnpm' -ErrorAction SilentlyContinue
    }
    if ($null -eq $command) {
        throw 'pnpm is required to assemble the technical review workspace.'
    }
    return $command.Source
}

function Enable-PnpmNodeRuntime {
    param([Parameter(Mandatory = $true)][string]$PnpmPath)

    if ($null -ne (Get-Command 'node.exe' -ErrorAction SilentlyContinue)) {
        return
    }
    $fallbackDirectory = Split-Path -Parent $PnpmPath
    $binDirectory = Split-Path -Parent $fallbackDirectory
    $dependenciesDirectory = Split-Path -Parent $binDirectory
    $bundledNodeDirectory = Join-Path $dependenciesDirectory 'node\bin'
    $bundledNode = Join-Path $bundledNodeDirectory 'node.exe'
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
        $env:Path = "$bundledNodeDirectory;$env:Path"
        return
    }
    throw 'pnpm was found, but node.exe is unavailable on PATH or beside the bundled runtime.'
}

$pnpm = Resolve-Pnpm
Enable-PnpmNodeRuntime -PnpmPath $pnpm
$results = @()
foreach ($profile in $Profiles) {
    $definition = $profileDefinitions[$profile]
    $previewPath = (Resolve-Path -LiteralPath (Join-Path $evidenceRoot $definition.preview)).Path
    Assert-Png -Path $previewPath

    $captureRoot = Join-Path $OutputRoot "_capture\$profile"
    New-Item -ItemType Directory -Force -Path $captureRoot | Out-Null
    $capturePath = Join-Path $captureRoot 'rendered-world-capture.png'
    $rolePath = Join-Path $captureRoot 'role-placement-overlay.png'
    $collisionPath = Join-Path $captureRoot 'art-collision-overlay.png'
    $spawnScreenshotPath = Join-Path $captureRoot 'spawn-exit-frame.png'
    $navigationScreenshotPath = Join-Path $captureRoot 'navigation-frame.png'
    $spawnMoviePath = Join-Path $captureRoot 'spawn-exit-traversal.avi'
    $navigationMoviePath = Join-Path $captureRoot 'navigation-traversal.avi'

    Write-Host "Capturing $profile production review evidence with Godot $GodotVersion..."
    Invoke-GodotCapture `
        -Definition $definition `
        -Mode 'normal' `
        -PngPath $capturePath
    Invoke-GodotCapture `
        -Definition $definition `
        -Mode 'role-overlay' `
        -PngPath $rolePath
    Invoke-GodotCapture `
        -Definition $definition `
        -Mode 'collision-overlay' `
        -PngPath $collisionPath
    Invoke-GodotCapture `
        -Definition $definition `
        -Mode 'spawn-exit' `
        -PngPath $spawnScreenshotPath `
        -MoviePath $spawnMoviePath
    Invoke-GodotCapture `
        -Definition $definition `
        -Mode 'navigation' `
        -PngPath $navigationScreenshotPath `
        -MoviePath $navigationMoviePath

    $workspacePath = Join-Path $OutputRoot $profile
    $reviewArguments = @(
        'production-art:technical-review',
        '--',
        '--review-id', $definition.review_id,
        '--profile', $profile,
        '--godot-versions', $GodotVersion,
        '--preview', $previewPath,
        '--capture', $capturePath,
        '--role-overlay', $rolePath,
        '--collision-overlay', $collisionPath,
        '--spawn-exit-video', $spawnMoviePath,
        '--navigation-video', $navigationMoviePath,
        '--out', $workspacePath
    )
    & $pnpm @reviewArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Technical review workspace assembly failed for $profile."
    }
    $reviewPath = Join-Path $workspacePath 'review\production-world-review.json'
    if (-not (Test-Path -LiteralPath $reviewPath -PathType Leaf)) {
        throw "Technical review contract is missing for $profile."
    }
    $review = Get-Content -LiteralPath $reviewPath -Raw | ConvertFrom-Json
    if (
        $review.profile -ne $profile `
        -or $review.release_decision -ne 'blocked' `
        -or ($review.gates | Where-Object { $_.gate -eq 'human-review' }).status -ne 'pending'
    ) {
        throw "Technical review contract has an invalid safety state for $profile."
    }
    $results += [pscustomobject][ordered]@{
        profile = $profile
        review_id = $definition.review_id
        godot = $GodotVersion
        technical_gates = 5
        human_gate = 'pending'
        release_decision = 'blocked'
        workspace = $workspacePath
        remote_requests = 0
        published = $false
    }
}

$results | ConvertTo-Json -Depth 4
