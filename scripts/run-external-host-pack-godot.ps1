param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,

    [string]$GodotConsole = $env:GODOT_BIN,

    [string]$GodotProject = ''
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceGodotProject = Join-Path $scriptRoot '..\godot'

function Resolve-RequiredFile([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Test-SafePackRelativePath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Contains('\') -or $Path.StartsWith('/') -or [IO.Path]::IsPathRooted($Path)) {
        return $false
    }
    foreach ($segment in $Path.Split('/')) {
        if ([string]::IsNullOrWhiteSpace($segment) -or $segment -eq '.' -or $segment -eq '..') { return $false }
    }
    return $true
}

$artifactRootResolved = (Resolve-Path -LiteralPath $ArtifactRoot).Path
$godotConsoleResolved = Resolve-RequiredFile $GodotConsole 'Godot console executable'
$receipts = @(Get-ChildItem -LiteralPath $artifactRootResolved -Filter 'mapsoo-*-external-host-export-receipt.json' -File)
if ($receipts.Count -ne 1) { throw 'External Host artifact root must contain exactly one export receipt.' }
$receipt = Get-Content -LiteralPath $receipts[0].FullName -Raw | ConvertFrom-Json
if ($receipt.schema_version -ne 'org.mapsoo.externalhost.mapsoo-export-receipt/1.0.0') { throw 'Unsupported External Host export receipt.' }
$packFile = [string]$receipt.pack.filename
if ($packFile -notmatch '^mapsoo-[a-z0-9]+(?:-[a-z0-9]+)*-v0\.1\.0-alpha\.7\.zip$' -or [IO.Path]::GetFileName($packFile) -ne $packFile) {
    throw 'Unsafe External Host pack filename.'
}
$packPath = Resolve-RequiredFile (Join-Path $artifactRootResolved $packFile) 'External Host pack'
$actualHash = (Get-FileHash -LiteralPath $packPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne [string]$receipt.pack.sha256) { throw "External Host pack SHA-256 mismatch: $actualHash" }
if ((Get-Item -LiteralPath $packPath).Length -ne [long]$receipt.pack.bytes) { throw 'External Host pack byte count mismatch.' }

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$extractRoot = Join-Path $tempBase ("mapsoo-external-host-godot-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $extractRoot | Out-Null
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archiveRoot = [IO.Path]::GetFileNameWithoutExtension($packFile)
    $archive = [IO.Compression.ZipFile]::OpenRead($packPath)
    try {
        $files = @($archive.Entries | Where-Object { -not [string]::IsNullOrEmpty($_.Name) })
        if ($files.Count -ne 18) { throw 'External Host pack must contain exactly 18 files.' }
        foreach ($entry in $archive.Entries) {
            $entryPath = $entry.FullName.Replace('\', '/').TrimEnd('/')
            if (-not (Test-SafePackRelativePath $entryPath) -or ($entryPath -ne $archiveRoot -and -not $entryPath.StartsWith($archiveRoot + '/', [StringComparison]::Ordinal))) {
                throw "Unsafe External Host archive path: $entryPath"
            }
        }
    }
    finally {
        $archive.Dispose()
    }
    Expand-Archive -LiteralPath $packPath -DestinationPath $extractRoot
    if ([string]::IsNullOrWhiteSpace($GodotProject)) {
        $temporaryProject = Join-Path $extractRoot 'godot-project'
        New-Item -ItemType Directory -Path $temporaryProject | Out-Null
        Copy-Item -LiteralPath (Join-Path $sourceGodotProject 'project.godot') -Destination $temporaryProject
        Copy-Item -LiteralPath (Join-Path $sourceGodotProject 'addons') -Destination $temporaryProject -Recurse
        Copy-Item -LiteralPath (Join-Path $sourceGodotProject 'tests') -Destination $temporaryProject -Recurse
        foreach ($generated in @('.godot', 'mapsoo_imports', 'tests\.generated')) {
            $candidate = Join-Path $temporaryProject $generated
            if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Recurse -Force }
        }
        $godotProjectResolved = $temporaryProject
    }
    else {
        $godotProjectResolved = (Resolve-Path -LiteralPath $GodotProject).Path
    }
    $packRoot = Join-Path $extractRoot $archiveRoot
    $manifestPath = Resolve-RequiredFile (Join-Path $packRoot 'mapsoo.manifest.json') 'External Host pack manifest'
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifestHash -ne [string]$receipt.pack.manifest_sha256) { throw 'External Host manifest SHA-256 mismatch.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.pack.id -ne $receipt.request.pack_id -or $manifest.pack.id -ne ($archiveRoot -replace '^mapsoo-' -replace '-v0\.1\.0-alpha\.7$')) {
        throw 'External Host manifest pack identity is invalid.'
    }
    if ($manifest.schema_version -ne '0.5.0' -or $manifest.pack.version -ne '0.1.0-alpha.7') {
        throw 'External Host manifest schema or pack version is invalid.'
    }
    if (@($manifest.files).Count -ne 17 -or @(Get-ChildItem -LiteralPath $packRoot -Recurse -File).Count -ne @($manifest.files).Count + 1) {
        throw 'External Host manifest coverage is invalid.'
    }
    $recordedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($record in @($manifest.files)) {
        $relativePath = [string]$record.path
        if (-not (Test-SafePackRelativePath $relativePath) -or -not $recordedPaths.Add($relativePath)) {
            throw "Unsafe or duplicate External Host manifest file path: $relativePath"
        }
        $payloadPath = Resolve-RequiredFile (Join-Path $packRoot $relativePath) 'External Host manifest payload'
        if ((Get-Item -LiteralPath $payloadPath).Length -ne [long]$record.bytes) { throw "External Host payload byte count mismatch: $relativePath" }
        $payloadHash = (Get-FileHash -LiteralPath $payloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($payloadHash -ne [string]$record.sha256) { throw "External Host payload SHA-256 mismatch: $relativePath" }
    }
    foreach ($relativePath in @($manifest.world_spec.path, $manifest.demo.map, $manifest.runtime.places.path, $manifest.runtime.structures.path, $manifest.receipt.path)) {
        if (-not (Test-SafePackRelativePath ([string]$relativePath))) { throw "Unsafe External Host manifest path: $relativePath" }
        if (-not $recordedPaths.Contains([string]$relativePath)) { throw "Unrecorded External Host manifest path: $relativePath" }
    }
    $worldSpecPath = Join-Path $packRoot $manifest.world_spec.path
    $worldSpecHash = (Get-FileHash -LiteralPath $worldSpecPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($worldSpecHash -ne [string]$manifest.world_spec.sha256 -or
        $worldSpecHash -ne [string]$receipt.projection.world_spec_sha256 -or
        [string]$manifest.world_spec.path -ne [string]$receipt.projection.world_spec_path) {
        throw 'External Host projected World Spec hash or path mismatch.'
    }
    $generationReceiptPath = Join-Path $packRoot $manifest.receipt.path
    $generationReceiptHash = (Get-FileHash -LiteralPath $generationReceiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($generationReceiptHash -ne [string]$receipt.pack.generation_receipt_sha256) { throw 'External Host generation receipt SHA-256 mismatch.' }
    $worldSpec = Get-Content -LiteralPath $worldSpecPath -Raw | ConvertFrom-Json
    $demo = Get-Content -LiteralPath (Join-Path $packRoot $manifest.demo.map) -Raw | ConvertFrom-Json
    $places = Get-Content -LiteralPath (Join-Path $packRoot $manifest.runtime.places.path) -Raw | ConvertFrom-Json
    $structures = Get-Content -LiteralPath (Join-Path $packRoot $manifest.runtime.structures.path) -Raw | ConvertFrom-Json
    $binding = $worldSpec.extensions.'org.mapsoo.externalhost.assetrequest.v1'
    if ($binding.assetRequestSha256 -ne $receipt.request.asset_request_sha256 -or
        $binding.externalHostWorldId -ne $receipt.request.external_host_world_id -or
        $binding.externalHostWorldVersion -ne $receipt.request.external_host_world_version -or
        $binding.sceneId -ne $receipt.request.scene_id -or
        $binding.contentRating -ne $receipt.request.content_rating -or
        (@($binding.requiredSceneTags) | ConvertTo-Json -Compress) -ne (@($receipt.request.required_scene_tags) | ConvertTo-Json -Compress)) {
        throw 'External Host World Spec request binding is invalid.'
    }
    $cellCount = [int]$worldSpec.map.width * [int]$worldSpec.map.height
    $propCount = @($demo.props).Count
    $placeCount = @($places.places).Count
    $structureCount = @($structures.structures).Count
    $arguments = @(
        '--headless', '--path', $godotProjectResolved,
        '--script', 'res://tests/import_pack_cli.gd', '--',
        "--manifest=$manifestPath",
        "--expected-pack-id=$($manifest.pack.id)", '--expected-schema=0.5.0',
        "--expected-cells=$cellCount", "--expected-props=$propCount",
        "--expected-places=$placeCount", "--expected-structures=$structureCount",
        '--check-conflict=true'
    )
    $output = @(& $godotConsoleResolved @arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $lines = @($output | ForEach-Object { $_.ToString() })
    $lines | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $lines -match '^(?:SCRIPT )?ERROR:') { throw 'External Host exact-pack Godot import failed.' }
    $sentinel = "MAPSOO_PACK_CLI_OK pack_id=$($manifest.pack.id) schema=0.5.0 cells=$cellCount props=$propCount places=$placeCount structures=$structureCount first=created second=unchanged conflict=preserved"
    if ($lines -notcontains $sentinel) { throw "External Host exact-pack sentinel is missing: $sentinel" }
    Write-Host "MAPSOO_EXTERNAL_HOST_GODOT_OK pack_id=$($manifest.pack.id) sha256=$actualHash conflict=preserved"
}
finally {
    if (Test-Path -LiteralPath $extractRoot) {
        $resolvedExtract = (Resolve-Path -LiteralPath $extractRoot).Path
        if (-not $resolvedExtract.StartsWith($tempBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to delete External Host test data outside the temporary directory: $resolvedExtract"
        }
        Remove-Item -LiteralPath $resolvedExtract -Recurse -Force
    }
}
