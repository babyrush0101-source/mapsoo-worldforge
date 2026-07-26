# Alpha.6 first Godot import / Alpha.6 首次导入 Godot

This is the public first-import guide for Mapsoo Worldsmith `v0.1.0-alpha.6`. Download both archives only from the matching [official GitHub prerelease](https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.6); do not substitute third-party archives.

这是 Mapsoo Worldsmith `v0.1.0-alpha.6` 的公开首次导入指南。两个归档都必须从对应的[官方 GitHub prerelease](https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.6) 下载；不要使用第三方归档。

## Publication and digest boundary / 发布与摘要边界

- Asset pack: [mapsoo-sunny-meadow-v0.1.0-alpha.6.zip](https://github.com/babyrush0101-source/mapsoo-kids/releases/download/v0.1.0-alpha.6/mapsoo-sunny-meadow-v0.1.0-alpha.6.zip), SHA-256 `4563552187977b38cdba86c7d3cbf5429a67b7a0a6049e978c2ef2992ef3a054`.
- Importer: [mapsoo-godot-importer-v0.1.0-alpha.6.zip](https://github.com/babyrush0101-source/mapsoo-kids/releases/download/v0.1.0-alpha.6/mapsoo-godot-importer-v0.1.0-alpha.6.zip), SHA-256 `bbfacd2b5c8503214b7647d59e9911a34fa1b4e073f86bd1310686812c9142c0`.
- Checksums: [SHA256SUMS](https://github.com/babyrush0101-source/mapsoo-kids/releases/download/v0.1.0-alpha.6/SHA256SUMS). It remains authoritative for all release attachments.
- The successful [release workflow](https://github.com/babyrush0101-source/mapsoo-kids/actions/runs/29685960441) audited 13 attachments and the Linux/Windows × Godot 4.3/4.7 matrix.

素材包与 importer 已作为公开 Alpha.6 附件发布。请从同一个 Release 获取两个 ZIP 与 `SHA256SUMS`，并在解压前核对上述摘要；哈希不一致时立即停止。

## What the release contains / 发布附件内容

Published attachment names:

```text
mapsoo-sunny-meadow-v0.1.0-alpha.6.zip
mapsoo-godot-importer-v0.1.0-alpha.6.zip
SHA256SUMS
```

The importer ZIP must extract with `addons/mapsoo_importer` as its project-relative root and include at least:

```text
addons/mapsoo_importer/plugin.cfg
addons/mapsoo_importer/mapsoo_importer_plugin.gd
addons/mapsoo_importer/mapsoo_pack_importer.gd
addons/mapsoo_importer/README.md
addons/mapsoo_importer/LICENSE.txt
addons/mapsoo_importer/icon.svg
```

Stop if the archive has an extra wrapper directory, lacks `README.md`, `LICENSE.txt`, or `icon.svg`, or places executable addon code inside the asset-pack ZIP. The icon is packaging evidence and a recognizable addon asset; its presence does not mean the plugin is listed in the Godot Asset Library.

若归档多出一层包装目录，缺少 README、LICENSE 或 icon，或者把 GDScript 放进素材包 ZIP，应立即停止。icon 只证明可安装归档完整，不表示已经上架 Godot Asset Library。

## 0–2 min — Verify the published attachments / 校验公开附件

Place the two ZIPs and the exact generated `SHA256SUMS` in one directory. Verify that every listed digest matches before extraction.

PowerShell:

```powershell
Get-Content .\SHA256SUMS
(Get-FileHash .\mapsoo-sunny-meadow-v0.1.0-alpha.6.zip -Algorithm SHA256).Hash.ToLower()
(Get-FileHash .\mapsoo-godot-importer-v0.1.0-alpha.6.zip -Algorithm SHA256).Hash.ToLower()
```

macOS:

```bash
shasum -a 256 mapsoo-sunny-meadow-v0.1.0-alpha.6.zip
shasum -a 256 mapsoo-godot-importer-v0.1.0-alpha.6.zip
```

Linux:

```bash
sha256sum mapsoo-sunny-meadow-v0.1.0-alpha.6.zip
sha256sum mapsoo-godot-importer-v0.1.0-alpha.6.zip
```

Compare the command output with `SHA256SUMS`; stop on any mismatch. SHA-256 proves byte consistency, not publisher identity, so obtain the files only from the official repository's matching release.

## 2–5 min — Install and enable / 安装并启用

1. Close the target Godot project if it is open.
2. Extract `mapsoo-godot-importer-v0.1.0-alpha.6.zip` into the project root.
3. Confirm these project-relative paths exist:

   ```text
   addons/mapsoo_importer/plugin.cfg
   addons/mapsoo_importer/README.md
   addons/mapsoo_importer/LICENSE.txt
   addons/mapsoo_importer/icon.svg
   ```

4. Open the project in Godot 4.3 or newer.
5. Choose **Project → Project Settings → Plugins**.
6. Enable **Mapsoo Pack Importer**.

If the plugin is missing, close Godot and fix the extraction path. It must be `<project>/addons/mapsoo_importer/plugin.cfg`, not `<project>/mapsoo-godot-importer-.../addons/...`.

如果插件未显示，关闭 Godot 并修正解压路径。禁止从第三方素材包中启用来源不明的 GDScript。

## 5–8 min — Import the published pack / 导入公开素材包

1. Extract `mapsoo-sunny-meadow-v0.1.0-alpha.6.zip` to a local folder outside the Godot project's managed output directory.
2. In Godot choose **Project → Tools → Import Mapsoo Pack...**.
3. Select the extracted root manifest:

   ```text
   mapsoo-sunny-meadow-v0.1.0-alpha.6/mapsoo.manifest.json
   ```

4. The first clean import must report `created`.
5. Open:

   ```text
   res://mapsoo_imports/sunny-meadow/sunny-meadow.world.tscn
   ```

6. Confirm the generated scene contains a `Structures` container with exactly **2** `Sprite2D` structure children. The published example links `spawn-cottage` to place `spawn` and `landmark-shrine` to place `landmark`.
7. Confirm each structure's queryable metadata preserves its stable structure ID, `place_id`, archetype, cell, pivot, and atlas region, and that the linked place exists under `Places`.

素材包自身只含 PNG、JSON 与 Markdown，不含 addon 或 GDScript。成功标准包括：首次状态为 `created`，场景中恰好有 2 个建筑 `Sprite2D`，并且两者都能通过稳定 `place_id` 关联到已有地点。

## 8–10 min — Prove a no-op re-import / 验证无改写重复导入

Without changing the source pack or anything under `res://mapsoo_imports/sunny-meadow/`:

1. Run **Project → Tools → Import Mapsoo Pack...** again.
2. Select the same `mapsoo.manifest.json`.
3. The second result must be `unchanged`.
4. Reopen the generated scene and confirm the same two structure nodes and links remain.

The expected transition is exactly:

```text
created → unchanged
```

If the second import reports `updated` or `conflict`, record the full result and stop. Do not delete or overwrite the managed directory until the failure is understood. Keep hand-authored scenes, scripts, and gameplay outside `res://mapsoo_imports/<pack-id>/`; see the [safe re-import contract](11_SAFE_GODOT_REIMPORT.md).

相同干净输入的第二次导入必须是 `unchanged`，且不应改写托管资源。若出现 `updated` 或 `conflict`，记录完整错误并停止，不要为了“通过”而覆盖用户文件。

## Record the acceptance result / 记录验收结果

For a release review, record:

- source release URL;
- operating system and exact Godot version;
- both ZIP filenames and their matching `SHA256SUMS` entries;
- confirmation that `README.md`, `LICENSE.txt`, and `icon.svg` existed at the expected addon path;
- the first and second import results (`created → unchanged`);
- generated scene path and exact structure count (`2`);
- structure IDs, `place_id` links, or the complete importer error.

Do not submit credentials, private local paths, child data, private External Host content, or unlicensed assets. Completing this procedure verifies a local import; it is not proof of external adoption or production use.
