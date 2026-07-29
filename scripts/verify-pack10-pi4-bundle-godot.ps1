param(
    [string]$Archive = '',
    [string]$WorldSet = '',
    [string]$GodotConsole = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$generatedParent = Join-Path $repoRoot 'godot\tests\.generated'
$extractionRoot = Join-Path $generatedParent 'pack10-pi4-bundle-godot'
$evidenceRoot = Join-Path $repoRoot 'docs\visual-qa\production-art'
$packageRoot = 'mapsoo-pi4-arm64-alpha12'

if ([string]::IsNullOrWhiteSpace($Archive)) {
    $Archive = Join-Path $repoRoot 'release\pi4-runtime\mapsoo-pi4-arm64-pack10-production-review.zip'
}
if ([string]::IsNullOrWhiteSpace($WorldSet)) {
    $WorldSet = Join-Path $repoRoot 'release\pi4-runtime\pack10-production-review-world-set.json'
}
if ([string]::IsNullOrWhiteSpace($GodotConsole)) {
    $GodotConsole = Join-Path $repoRoot 'release\godot-runtimes\4.3\Godot_v4.3-stable_win64_console.exe'
}

$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$worldSetPath = (Resolve-Path -LiteralPath $WorldSet).Path
$console = (Resolve-Path -LiteralPath $GodotConsole).Path
$versionLine = @(& $console --version 2>&1 | ForEach-Object { $_.ToString() })[0]
if ($versionLine -notmatch '^4\.3(?:\.|$)') {
    throw "Pack 1.0 Pi bundle smoke requires pinned Godot 4.3, got: $versionLine"
}
$world = Get-Content -LiteralPath $worldSetPath -Raw | ConvertFrom-Json
if ($world.runtime_kind -ne 'importer-managed-scene' `
        -or $world.source_pack.godot_serialization -ne '4.3' `
        -or $world.output_license -ne 'LicenseRef-UNRELEASED') {
    throw 'Pack 1.0 Pi bundle world-set boundary is invalid.'
}
$packId = [string]$world.id

New-Item -ItemType Directory -Path $generatedParent -Force | Out-Null
$resolvedParent = (Resolve-Path -LiteralPath $generatedParent).Path
$resolvedExtraction = [System.IO.Path]::GetFullPath($extractionRoot)
if (-not $resolvedExtraction.StartsWith(
        $resolvedParent + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'Pi bundle extraction target escaped its fixed generated parent.'
}
if (Test-Path -LiteralPath $resolvedExtraction) {
    Remove-Item -LiteralPath $resolvedExtraction -Recurse -Force
}

try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $resolvedExtraction
    $projectRoot = (Resolve-Path -LiteralPath (
        Join-Path $resolvedExtraction "$packageRoot\project"
    )).Path
    $sceneRecord = $world.files |
        Where-Object { $_.target -eq "$packId.world.tscn" } |
        Select-Object -First 1
    if (-not $sceneRecord) {
        throw 'Pack 1.0 Pi bundle world-set has no canonical scene record.'
    }
    $scenePath = Join-Path $projectRoot "mapsoo_imports\$packId\$packId.world.tscn"
    $sceneHash = (Get-FileHash -LiteralPath $scenePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sceneHash -ne $sceneRecord.sha256) {
        throw 'Extracted Pack 1.0 scene differs from the prepared world-set.'
    }
    $stdout = Join-Path $evidenceRoot 'pack10-pi4-bundle-godot-4.3.stdout.log'
    $stderr = Join-Path $evidenceRoot 'pack10-pi4-bundle-godot-4.3.stderr.log'
    $resourceScene = "res://mapsoo_imports/$packId/$packId.world.tscn"
    $arguments = @(
        '--headless',
        '--path', $projectRoot,
        '--script', 'res://addons/mapsoo_importer/runtime/mapsoo_pi4_runtime_smoke.gd',
        '--',
        "--scene=$resourceScene"
    )
    $process = Start-Process `
        -FilePath $console `
        -ArgumentList $arguments `
        -WorkingDirectory $resolvedExtraction `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru `
        -Wait
    $log = @(
        Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue
        Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue
    )
    $log | ForEach-Object { Write-Host $_ }
    if ($process.ExitCode -ne 0 -or $log -match '^(?:SCRIPT )?ERROR:') {
        throw 'Extracted Pack 1.0 Pi bundle failed its Godot 4.3 scene smoke.'
    }
    $sentinel = $log |
        Where-Object { $_ -match '^MAPSOO_PI4_RUNTIME_SCENE_OK ' } |
        Select-Object -Last 1
    if (-not $sentinel `
            -or $sentinel -notmatch "scene=$resourceScene" `
            -or $sentinel -notmatch "scene_sha256=$sceneHash" `
            -or $sentinel -notmatch 'characters=2 props=3 player_clips=16 npc_clips=8' `
            -or $sentinel -notmatch 'physical_raspberry_pi=not-tested') {
        throw 'Extracted Pack 1.0 Pi bundle Godot evidence is incomplete.'
    }
    [pscustomobject]@{
        status = 'pack10-pi4-bundle-godot-pass'
        godot = '4.3'
        pack_id = $packId
        archive_sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        scene_sha256 = $sceneHash
        source_pack_in_bundle = $false
        source_workspace_required = $false
        physical_raspberry_pi = 'not-tested'
    } | ConvertTo-Json -Depth 4
} finally {
    if (Test-Path -LiteralPath $resolvedExtraction) {
        Remove-Item -LiteralPath $resolvedExtraction -Recurse -Force
    }
}
