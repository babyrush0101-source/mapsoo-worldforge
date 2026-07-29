param(
    [string]$CandidateZip = '',
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$generatedParent = Join-Path $godotRoot 'tests\.generated'
$extractionRoot = Join-Path $generatedParent 'pack10-production-candidate-smoke'
$evidenceRoot = Join-Path $repoRoot 'docs\visual-qa\production-art'

if ([string]::IsNullOrWhiteSpace($CandidateZip)) {
    $CandidateZip = Join-Path $repoRoot 'release\mapsoo-pack10-production-synthetic-review-v1.zip'
}
$candidate = (Resolve-Path -LiteralPath $CandidateZip).Path
if ([System.IO.Path]::GetExtension($candidate).ToLowerInvariant() -ne '.zip') {
    throw 'Pack 1.0 production candidate must be a ZIP.'
}

New-Item -ItemType Directory -Path $generatedParent -Force | Out-Null
$resolvedParent = (Resolve-Path -LiteralPath $generatedParent).Path
$resolvedTarget = [System.IO.Path]::GetFullPath($extractionRoot)
if (-not $resolvedTarget.StartsWith($resolvedParent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Pack 1.0 generated extraction target escaped its fixed parent.'
}
if (Test-Path -LiteralPath $resolvedTarget) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}
Expand-Archive -LiteralPath $candidate -DestinationPath $resolvedTarget
$manifest = (Resolve-Path -LiteralPath (Join-Path $resolvedTarget 'mapsoo.manifest.json')).Path
$manifestValue = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
if ($manifestValue.schema_version -ne '1.0.0-draft.1' `
        -or $manifestValue.profile -ne 'layered-depth-2d' `
        -or $manifestValue.distribution -ne 'internal-review' `
        -or $manifestValue.license.output.id -ne 'LicenseRef-UNRELEASED') {
    throw 'Pack 1.0 candidate review boundary is invalid.'
}
$manifestHash = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant()

if ($GodotConsoles.Count -eq 0) {
    $GodotConsoles = @(
        (Join-Path $repoRoot 'release\godot-runtimes\4.3\Godot_v4.3-stable_win64_console.exe'),
        (Join-Path $repoRoot 'release\godot-runtimes\4.7\Godot_v4.7-stable_win64_console.exe')
    )
}

$results = @()
try {
    foreach ($consolePath in $GodotConsoles) {
        $console = (Resolve-Path -LiteralPath $consolePath).Path
        $versionLine = @(& $console --version 2>&1 | ForEach-Object { $_.ToString() })[0]
        $version = $versionLine.Split('.')[0..1] -join '.'
        $stdout = Join-Path $evidenceRoot "pack10-production-candidate-godot-$version.stdout.log"
        $stderr = Join-Path $evidenceRoot "pack10-production-candidate-godot-$version.stderr.log"
        $arguments = @(
            '--headless',
            '--path', $godotRoot,
            '--script', 'res://tests/import_pack10_production_candidate_smoke.gd',
            '--',
            ('"--manifest={0}"' -f $manifest)
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
            throw "Godot $version Pack 1.0 production candidate smoke failed."
        }
        $sentinel = $log |
            Where-Object { $_ -match '^MAPSOO_PACK10_PRODUCTION_CANDIDATE_OK ' } |
            Select-Object -Last 1
        if (-not $sentinel `
                -or $sentinel -notmatch 'planes=8 atlases=7 roles=36 characters=2' `
                -or $sentinel -notmatch 'pivot_baked_structures=3' `
                -or $sentinel -notmatch 'player_clips=16 npc_clips=8' `
                -or $sentinel -notmatch 'first=created second=unchanged' `
                -or $sentinel -notmatch "manifest_sha256=$manifestHash") {
            throw "Godot $version Pack 1.0 production candidate evidence is incomplete."
        }
        $results += [pscustomobject]@{
            godot = $version
            candidate_sha256 = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
            manifest_sha256 = $manifestHash
            distribution = 'internal-review'
            license = 'LicenseRef-UNRELEASED'
            planes = 8
            atlases = 7
            roles = 36
            characters = 2
            pivot_baked_structures = 3
            first_import = 'created'
            second_import = 'unchanged'
            physical_raspberry_pi = 'not-tested'
        }
    }
} finally {
    if (Test-Path -LiteralPath $resolvedTarget) {
        Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    }
}

$results | ConvertTo-Json -Depth 4
