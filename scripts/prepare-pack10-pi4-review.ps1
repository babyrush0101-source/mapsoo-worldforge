param(
    [string]$CandidateZip = '',
    [string]$GodotConsole = '',
    [string]$WorldSetOut = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$generatedParent = Join-Path $godotRoot 'tests\.generated'
$extractionRoot = Join-Path $generatedParent 'pack10-pi4-review-prepare'
$importParent = Join-Path $godotRoot 'mapsoo_imports'
$evidenceRoot = Join-Path $repoRoot 'docs\visual-qa\production-art'

if ([string]::IsNullOrWhiteSpace($CandidateZip)) {
    $CandidateZip = Join-Path $repoRoot 'release\mapsoo-pack10-production-synthetic-review-v1.zip'
}
if ([string]::IsNullOrWhiteSpace($GodotConsole)) {
    $GodotConsole = Join-Path $repoRoot 'release\godot-runtimes\4.3\Godot_v4.3-stable_win64_console.exe'
}
if ([string]::IsNullOrWhiteSpace($WorldSetOut)) {
    $WorldSetOut = Join-Path $repoRoot 'release\pi4-runtime\pack10-production-review-world-set.json'
}
$resolvedWorldSetOut = [System.IO.Path]::GetFullPath($WorldSetOut)
$resolvedRepoPrefix = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedWorldSetOut.StartsWith(
        $resolvedRepoPrefix,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'Generated Pack 1.0 world-set must stay inside the repository.'
}

$candidate = (Resolve-Path -LiteralPath $CandidateZip).Path
$console = (Resolve-Path -LiteralPath $GodotConsole).Path
if ([System.IO.Path]::GetExtension($candidate).ToLowerInvariant() -ne '.zip') {
    throw 'Pack 1.0 production candidate must be a ZIP.'
}
$versionLine = @(& $console --version 2>&1 | ForEach-Object { $_.ToString() })[0]
if ($versionLine -notmatch '^4\.3(?:\.|$)') {
    throw "Pack 1.0 Pi review preparation requires pinned Godot 4.3, got: $versionLine"
}

New-Item -ItemType Directory -Path $generatedParent -Force | Out-Null
New-Item -ItemType Directory -Path $importParent -Force | Out-Null
$resolvedGeneratedParent = (Resolve-Path -LiteralPath $generatedParent).Path
$resolvedImportParent = (Resolve-Path -LiteralPath $importParent).Path
$resolvedExtraction = [System.IO.Path]::GetFullPath($extractionRoot)
if (-not $resolvedExtraction.StartsWith(
        $resolvedGeneratedParent + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'Pack 1.0 extraction target escaped its fixed generated parent.'
}
if (Test-Path -LiteralPath $resolvedExtraction) {
    Remove-Item -LiteralPath $resolvedExtraction -Recurse -Force
}
Expand-Archive -LiteralPath $candidate -DestinationPath $resolvedExtraction
$manifestPath = (Resolve-Path -LiteralPath (Join-Path $resolvedExtraction 'mapsoo.manifest.json')).Path
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$packId = [string]$manifest.pack.id
if ($packId -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$' `
        -or $manifest.schema_version -ne '1.0.0-draft.1' `
        -or $manifest.profile -ne 'layered-depth-2d' `
        -or $manifest.distribution -ne 'internal-review' `
        -or $manifest.license.output.id -ne 'LicenseRef-UNRELEASED' `
        -or $manifest.review.human_art -ne 'pending' `
        -or $manifest.review.rights -ne 'pending' `
        -or $manifest.review.runtime -ne 'pending' `
        -or $manifest.review.raspberry_pi -ne 'pending') {
    throw 'Pack 1.0 candidate identity or review boundary is invalid.'
}
$importTarget = [System.IO.Path]::GetFullPath((Join-Path $resolvedImportParent $packId))
if (-not $importTarget.StartsWith(
        $resolvedImportParent + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'Pack 1.0 import target escaped its fixed parent.'
}

$stdout = Join-Path $evidenceRoot 'pack10-pi4-prepare-godot-4.3.stdout.log'
$stderr = Join-Path $evidenceRoot 'pack10-pi4-prepare-godot-4.3.stderr.log'
try {
    $arguments = @(
        '--headless',
        '--path', $godotRoot,
        '--script', 'res://tests/prepare_pack10_pi4_review.gd',
        '--',
        ('"--manifest={0}"' -f $manifestPath)
    )
    $process = Start-Process `
        -FilePath $console `
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
    $log | ForEach-Object { Write-Host $_ }
    if ($process.ExitCode -ne 0 -or $log -match '^(?:SCRIPT )?ERROR:') {
        throw 'Godot 4.3 Pack 1.0 Pi review preparation failed.'
    }
    $sentinel = $log |
        Where-Object { $_ -match '^MAPSOO_PACK10_PI4_PREPARE_OK ' } |
        Select-Object -Last 1
    if (-not $sentinel -or $sentinel -notmatch "pack_id=$packId status=(?:created|unchanged)") {
        throw 'Godot 4.3 Pack 1.0 Pi review preparation evidence is incomplete.'
    }

    $sceneName = "$packId.world.tscn"
    $tilesetName = "$packId.tileset.tres"
    $stateName = 'mapsoo.import-state.json'
    $scenePath = (Resolve-Path -LiteralPath (Join-Path $importTarget $sceneName)).Path
    $tilesetPath = (Resolve-Path -LiteralPath (Join-Path $importTarget $tilesetName)).Path
    $statePath = (Resolve-Path -LiteralPath (Join-Path $importTarget $stateName)).Path
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $candidateHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($state.pack_id -ne $packId `
            -or $state.manifest_sha256 -ne $manifestHash `
            -or $state.importer.id -ne 'mapsoo_importer' `
            -or $state.importer.version -ne '1.0.0') {
        throw 'Prepared import state is not bound to the Pack 1.0 candidate.'
    }
    $sourceRoot = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar
    $files = @(
        [pscustomobject][ordered]@{
            source = $scenePath.Substring($sourceRoot.Length).Replace('\', '/')
            target = $sceneName
            bytes = (Get-Item -LiteralPath $scenePath).Length
            sha256 = (Get-FileHash -LiteralPath $scenePath -Algorithm SHA256).Hash.ToLowerInvariant()
        },
        [pscustomobject][ordered]@{
            source = $tilesetPath.Substring($sourceRoot.Length).Replace('\', '/')
            target = $tilesetName
            bytes = (Get-Item -LiteralPath $tilesetPath).Length
            sha256 = (Get-FileHash -LiteralPath $tilesetPath -Algorithm SHA256).Hash.ToLowerInvariant()
        },
        [pscustomobject][ordered]@{
            source = $statePath.Substring($sourceRoot.Length).Replace('\', '/')
            target = $stateName
            bytes = (Get-Item -LiteralPath $statePath).Length
            sha256 = (Get-FileHash -LiteralPath $statePath -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    )
    $worldSet = [pscustomobject][ordered]@{
        schema_version = 'mapsoo-pi4-world-set/1.0'
        id = $packId
        profile = 'layered-depth-2d'
        scene_target = $sceneName
        distribution = 'internal-review'
        output_license = 'LicenseRef-UNRELEASED'
        standard_pack = $false
        runtime_kind = 'importer-managed-scene'
        source_pack = [pscustomobject][ordered]@{
            candidate_sha256 = $candidateHash
            manifest_sha256 = $manifestHash
            schema_version = '1.0.0-draft.1'
            importer_version = '1.0.0'
            godot_serialization = [string]$state.godot_serialization
        }
        not_accepted_for = @(
            'public redistribution',
            'commercial use',
            'human art approval',
            'physical Raspberry Pi 4B performance approval'
        )
        files = $files
    }
    $worldSetParent = Split-Path -Parent $resolvedWorldSetOut
    New-Item -ItemType Directory -Path $worldSetParent -Force | Out-Null
    $worldSetJson = $worldSet | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText(
        $resolvedWorldSetOut,
        $worldSetJson + "`n",
        [System.Text.UTF8Encoding]::new($false)
    )
    [pscustomobject]@{
        status = 'pack10-pi4-review-prepared'
        pack_id = $packId
        candidate_sha256 = $candidateHash
        manifest_sha256 = $manifestHash
        world_set = $resolvedWorldSetOut
        imported_files = 3
        physical_raspberry_pi = 'not-tested'
    } | ConvertTo-Json -Depth 4
} finally {
    if (Test-Path -LiteralPath $resolvedExtraction) {
        Remove-Item -LiteralPath $resolvedExtraction -Recurse -Force
    }
}
