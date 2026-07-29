param(
    [Parameter(Mandatory = $true)]
    [string]$FamilyDirectory,
    [Parameter(Mandatory = $true)]
    [string]$OutputReceipt,
    [string[]]$GodotConsoles = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
$generatedRoot = Join-Path $godotRoot 'tests\.generated'
$stageRoot = Join-Path $generatedRoot 'reviewed-character-family'
$runPath = Join-Path $generatedRoot 'reviewed-character-family-runs.json'
$familyResolved = (Resolve-Path -LiteralPath $FamilyDirectory).Path
$receiptFullPath = [System.IO.Path]::GetFullPath($OutputReceipt)

New-Item -ItemType Directory -Path $generatedRoot -Force | Out-Null
$generatedResolved = (Resolve-Path -LiteralPath $generatedRoot).Path
foreach ($target in @($stageRoot, $runPath)) {
    if (Test-Path -LiteralPath $target) {
        $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
        if (-not $resolvedTarget.StartsWith(
            $generatedResolved + [System.IO.Path]::DirectorySeparatorChar,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            throw "Generated acceptance target escaped godot/tests/.generated: $resolvedTarget"
        }
        Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    }
}
if (Test-Path -LiteralPath $receiptFullPath) {
    throw "Output receipt already exists: $receiptFullPath"
}

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if ($null -eq $pnpm) {
    $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
}
if ($null -eq $pnpm) {
    throw 'pnpm is required for reviewed character family acceptance.'
}
& $pnpm.Source exec vite-node scripts/reviewed-character-family-runtime-acceptance.ts `
    --mode prepare `
    --family-dir $familyResolved `
    --stage-dir $stageRoot
if ($LASTEXITCODE -ne 0) {
    throw 'Reviewed character family preflight or staging failed.'
}

if ($GodotConsoles.Count -eq 0) {
    $GodotConsoles = @(
        (Join-Path $repoRoot 'release\godot-runtimes\4.3\Godot_v4.3-stable_win64_console.exe'),
        (Join-Path $repoRoot 'release\godot-runtimes\4.7\Godot_v4.7-stable_win64_console.exe')
    )
}
$resolvedConsoles = @(
    $GodotConsoles |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        ForEach-Object { (Resolve-Path -LiteralPath $_).Path } |
        Select-Object -Unique
)
if ($resolvedConsoles.Count -lt 2) {
    throw 'Exact Godot 4.3 and 4.7 console executables are required.'
}

$hostPlatform = if ($IsLinux) {
    'linux'
} elseif ($IsMacOS) {
    'macos'
} else {
    'windows'
}
$hostArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
$architectureValue = $hostArchitecture.ToString().ToLowerInvariant()
$runsByVersion = @{}
foreach ($consolePath in $resolvedConsoles) {
    $versionOutput = @(
        & $consolePath --version 2>&1 | ForEach-Object { $_.ToString() }
    )
    if ($LASTEXITCODE -ne 0 -or $versionOutput.Count -lt 1) {
        throw "Cannot read Godot version: $consolePath"
    }
    $engineVersion = $versionOutput[0].Trim()
    if ($engineVersion -notmatch '^(4\.(3|7))\.') {
        continue
    }
    $compatibilityVersion = $Matches[1]
    if ($runsByVersion.ContainsKey($compatibilityVersion)) {
        throw "Multiple Godot $compatibilityVersion executables were supplied."
    }
    $output = @(
        & $consolePath `
            --headless `
            --path $godotRoot `
            --script 'res://tests/reviewed_character_profile_family_runtime_acceptance.gd' 2>&1 |
            ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $compatibilityVersion reviewed family acceptance failed."
    }
    $sentinel = $output |
        Where-Object {
            $_ -eq 'MAPSOO_REVIEWED_CHARACTER_FAMILY_GODOT_OK profiles=4 clips=84 exact_artifacts=true'
        } |
        Select-Object -Last 1
    if (-not $sentinel) {
        throw "Godot $compatibilityVersion acceptance sentinel is missing."
    }
    $runsByVersion[$compatibilityVersion] = [ordered]@{
        compatibility_version = $compatibilityVersion
        engine_version = $engineVersion
        executable_sha256 = (
            Get-FileHash -LiteralPath $consolePath -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        host_platform = $hostPlatform
        host_architecture = $architectureValue
        mode = 'headless-character-family-bind'
        profiles_loaded = 4
        clips_loaded = 84
        result = 'pass'
    }
}
if (
    -not $runsByVersion.ContainsKey('4.3') -or
    -not $runsByVersion.ContainsKey('4.7')
) {
    throw 'Both exact Godot 4.3 and 4.7 acceptance runs must pass.'
}
$runJson = @($runsByVersion['4.3'], $runsByVersion['4.7']) |
    ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText(
    $runPath,
    $runJson,
    [System.Text.UTF8Encoding]::new($false)
)

& $pnpm.Source exec vite-node scripts/reviewed-character-family-runtime-acceptance.ts `
    --mode receipt `
    --family-dir $familyResolved `
    --run-json $runPath `
    --out $receiptFullPath
if ($LASTEXITCODE -ne 0) {
    throw 'Reviewed character family acceptance receipt generation failed.'
}
& $pnpm.Source exec vite-node scripts/reviewed-character-family-runtime-acceptance.ts `
    --mode verify `
    --family-dir $familyResolved `
    --out $receiptFullPath
if ($LASTEXITCODE -ne 0) {
    throw 'Reviewed character family acceptance receipt verification failed.'
}

[ordered]@{
    status = 'technical-runtime-pass'
    profiles = 4
    clips = 84
    godot_versions = @('4.3', '4.7')
    exact_family_artifacts_tested = $true
    visual_quality_reassessed = $false
    human_art_review_reassessed = $false
    physical_raspberry_pi_tested = $false
    receipt = $receiptFullPath
} | ConvertTo-Json -Depth 4
