param(
    [string[]]$GodotConsoles = @(),
    [string]$Atlas = '',
    [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$godotRoot = Join-Path $repoRoot 'godot'
if ([string]::IsNullOrWhiteSpace($Atlas)) {
    $Atlas = Join-Path $repoRoot 'docs\visual-qa\production-art\side-platformer-character-atlas-v2.png'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot 'docs\visual-qa\production-art'
}
$atlasResolved = (Resolve-Path -LiteralPath $Atlas).Path
$outputResolved = (Resolve-Path -LiteralPath $OutputDirectory).Path
if (-not $outputResolved.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Production-character preview output must stay inside the repository.'
}

if ($GodotConsoles.Count -eq 0) {
    $GodotConsoles = @(
        (Join-Path $repoRoot 'release\godot-runtimes\4.3\Godot_v4.3-stable_win64_console.exe'),
        (Join-Path $repoRoot 'release\godot-runtimes\4.7\Godot_v4.7-stable_win64_console.exe')
    )
}

$atlasHash = (Get-FileHash -LiteralPath $atlasResolved -Algorithm SHA256).Hash.ToLowerInvariant()
$results = @()
foreach ($consolePath in $GodotConsoles) {
    $consoleResolved = (Resolve-Path -LiteralPath $consolePath).Path
    $versionOutput = @(& $consoleResolved --version 2>&1 | ForEach-Object { $_.ToString() })
    if ($LASTEXITCODE -ne 0 -or $versionOutput.Count -lt 1) { throw "Cannot read Godot version: $consoleResolved" }
    $version = $versionOutput[0].Split('.')[0..1] -join '.'
    if ($version -notmatch '^\d+\.\d+$') { throw "Unexpected Godot version: $($versionOutput[0])" }
    $outputPath = Join-Path $outputResolved "side-platformer-character-godot-$version-v2.png"
    $arguments = @(
        '--headless', '--path', $godotRoot,
        '--script', 'res://tests/preview_production_character_atlas.gd', '--',
        "--atlas=$atlasResolved", "--output=$outputPath"
    )
    $output = @(& $consoleResolved @arguments 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or $output -match '^(?:SCRIPT )?ERROR:') {
        throw "Godot $version production-character preview failed."
    }
    $sentinel = $output | Where-Object { $_ -match '^MAPSOO_PRODUCTION_CHARACTER_GODOT_OK ' } | Select-Object -Last 1
    if (-not $sentinel -or $sentinel -notmatch "atlas_sha256=$atlasHash") {
        throw "Godot $version production-character sentinel is missing or bound to the wrong atlas."
    }
    if ($sentinel -notmatch 'preview_pixels_sha256=([a-f0-9]{64})') {
        throw "Godot $version production-character pixel hash is missing."
    }
    $previewPixelsHash = $Matches[1]
    if ($sentinel -notmatch 'frames=(\d+)') { throw "Godot $version frame count is missing." }
    $frameCount = [int]$Matches[1]
    if ($sentinel -notmatch 'visible_pixels=(\d+)') { throw "Godot $version visible pixel count is missing." }
    $visiblePixels = [int]$Matches[1]
    if ($sentinel -notmatch 'visible_height=(\d+)-(\d+)') { throw "Godot $version visible-height range is missing." }
    $minimumVisibleHeight = [int]$Matches[1]
    $maximumVisibleHeight = [int]$Matches[2]
    if ($sentinel -notmatch 'foot_error=(\d+)') { throw "Godot $version foot-anchor error is missing." }
    $maximumFootError = [int]$Matches[1]
    if (($frameCount -ne 28) -or ($minimumVisibleHeight -lt 72) -or ($maximumVisibleHeight -gt 96) -or ($maximumFootError -gt 2)) {
        throw "Godot $version production-character strict frame metrics failed."
    }
    $previewHash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $results += [pscustomobject]@{
        godot = $version
        atlas_sha256 = $atlasHash
        frames = $frameCount
        visible_pixels = $visiblePixels
        minimum_visible_height = $minimumVisibleHeight
        maximum_visible_height = $maximumVisibleHeight
        maximum_foot_anchor_error_px = $maximumFootError
        preview_pixels_sha256 = $previewPixelsHash
        preview_path = $outputPath.Substring($repoRoot.Length + 1).Replace('\', '/')
        preview_sha256 = $previewHash
        preview_bytes = (Get-Item -LiteralPath $outputPath).Length
    }
}

if (@($results.preview_pixels_sha256 | Select-Object -Unique).Count -ne 1) {
    throw 'Godot versions rendered different production-character pixels.'
}
$qa = [ordered]@{
    schema_version = 'mapsoo-production-art-godot-qa/1.1'
    id = 'side-platformer-character-godot-v2'
    status = 'technical-runtime-pass'
    scope = 'Godot PNG decode, 28-frame AtlasTexture slicing, 72-96px visible-height gate, <=2px foot-anchor gate, chroma spill and deterministic preview'
    atlas_path = 'docs/visual-qa/production-art/side-platformer-character-atlas-v2.png'
    atlas_sha256 = $atlasHash
    frames = 28
    visible_pixels = $results[0].visible_pixels
    visible_height_range = @($results[0].minimum_visible_height, $results[0].maximum_visible_height)
    maximum_foot_anchor_error_px = $results[0].maximum_foot_anchor_error_px
    preview_pixels_sha256 = $results[0].preview_pixels_sha256
    frame_origin = 'deterministic-postprocess-variant'
    native_model_animation_frames = $false
    runs = @($results | ForEach-Object {
        [ordered]@{
            godot = $_.godot
            preview_path = $_.preview_path
            preview_bytes = $_.preview_bytes
            preview_sha256 = $_.preview_sha256
        }
    })
    not_proven = @(
        'model-native limb animation'
        'human or user art approval'
        'complete world asset pack'
        'physical Raspberry Pi rendering'
    )
}
$qaPath = Join-Path $outputResolved 'side-platformer-character-godot-v2.json'
$qaJson = ($qa | ConvertTo-Json -Depth 6) + [Environment]::NewLine
[IO.File]::WriteAllText($qaPath, $qaJson, [Text.UTF8Encoding]::new($false))
$qa | ConvertTo-Json -Depth 6
