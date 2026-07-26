# First Godot import in 10 minutes / 10 分钟首次导入 Godot

This is the public acceptance path for Mapsoo Worldsmith `v0.1.0-alpha.9`. It imports the exact complete `topdown-farm` Pack 0.6 archive exercised by release CI on Linux and Windows with Godot 4.3 and 4.7.

这是 Mapsoo Worldsmith `v0.1.0-alpha.9` 的公开验收路径。下面导入的正是发布 CI 在 Linux、Windows 的 Godot 4.3 和 4.7 中验证过的完整 `topdown-farm` Pack 0.6 素材包。

## What you need / 准备

- Godot 4.3 or newer / Godot 4.3 或更高版本；
- a new or disposable Godot project / 一个新建或可用于测试的 Godot 项目；
- about 10 minutes / 约 10 分钟；
- no Mapsoo account, backend, API key, or itch.io login.

## 0–2 min — Download and verify / 下载并校验

Download these two attachments from the [audited Alpha9 release](https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.9):

1. [Complete farm Pack 0.6](https://github.com/babyrush0101-source/mapsoo-kids/releases/download/v0.1.0-alpha.9/mapsoo-alpha9-godot-smoke-v0.1.0-alpha.9.zip)
2. [Mapsoo Godot importer](https://github.com/babyrush0101-source/mapsoo-kids/releases/download/v0.1.0-alpha.9/mapsoo-godot-importer-v0.1.0-alpha.9.zip)

| File | SHA-256 |
| --- | --- |
| `mapsoo-alpha9-godot-smoke-v0.1.0-alpha.9.zip` | `10d89c7888b70215a14af2b6552fc5237d799df9cd3092aee99541961d9e480c` |
| `mapsoo-godot-importer-v0.1.0-alpha.9.zip` | `bfb736d044818b01955feb35d84b438fe6c139e77764907847a1f4d89ea7b526` |

PowerShell:

```powershell
(Get-FileHash .\mapsoo-alpha9-godot-smoke-v0.1.0-alpha.9.zip -Algorithm SHA256).Hash.ToLower()
(Get-FileHash .\mapsoo-godot-importer-v0.1.0-alpha.9.zip -Algorithm SHA256).Hash.ToLower()
```

macOS or Linux:

```bash
shasum -a 256 mapsoo-alpha9-godot-smoke-v0.1.0-alpha.9.zip
shasum -a 256 mapsoo-godot-importer-v0.1.0-alpha.9.zip
```

Linux users may use `sha256sum` instead. Stop and download again from the official release if either digest differs.

## 2–5 min — Install the importer / 安装导入器

1. Close the target project in Godot.
2. Extract `mapsoo-godot-importer-v0.1.0-alpha.9.zip` into the project root.
3. Confirm `<your-project>/addons/mapsoo_importer/plugin.cfg` exists.
4. Open the project, then choose **Project → Project Settings → Plugins**.
5. Enable **Mapsoo Pack Importer**.

如果插件没有出现，通常是 ZIP 解压后多套了一层目录。`addons` 必须直接位于 Godot 项目根目录。

## 5–8 min — Import the complete farm / 导入完整农场包

1. Extract `mapsoo-alpha9-godot-smoke-v0.1.0-alpha.9.zip` to a local folder.
2. In Godot choose **Project → Tools → Import Mapsoo Pack...**.
3. Select the extracted root `mapsoo.manifest.json`.
4. Wait for the importer to report `created`.
5. Repeat the same import once; a clean deterministic re-import should report `unchanged`.

The asset ZIP contains PNG, JSON and documentation only—no addon or executable GDScript. The importer is installed separately from the official repository release.

素材 ZIP 只包含 PNG、JSON 和文档，不包含 addon 或可执行 GDScript。导入器必须从官方 Release 单独安装。

## 8–10 min — Open the result / 打开结果

Open the generated scene under:

```text
res://mapsoo_imports/alpha9-godot-smoke-pack/
```

Success means the imported farm scene opens without an importer error and includes terrain, water, paths/fences, soil/crops, props, structures, collision/navigation data, spawn data, and the four-direction character preview. Keep hand-authored work outside `res://mapsoo_imports/<pack-id>/`; that directory is managed output.

成功标准：生成的农场场景可以无导入错误地打开，并包含地形、水域、路径/栅栏、土壤/作物、道具、建筑、碰撞/导航数据、出生点数据和四方向角色预览。手工内容应放在 `res://mapsoo_imports/<pack-id>/` 之外。

## Share either success or failure / 提交成功或失败结果

Use the [structured first-import form](https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml). Record:

- operating system and exact Godot version;
- time from download to first opened scene;
- the exact pack filename and SHA-256;
- `created → unchanged`, or the complete error and last successful step;
- one instruction or workflow detail that was confusing.

成功和失败都是真实、有效的反馈。请勿提交凭证、儿童数据、私有本地路径、External Host 私有内容或无权公开的素材。所有独立测试结果统一索引在 [issue #12](https://github.com/babyrush0101-source/mapsoo-kids/issues/12)。

## Troubleshooting / 排错

### Plugin is not listed / 插件未显示

The required file is `<project>/addons/mapsoo_importer/plugin.cfg`, not `<project>/mapsoo-godot-importer.../addons/...`. Move `addons` to the project root and reopen Godot.

### Import menu is missing / 导入菜单未显示

Confirm the plugin is enabled, then reopen the project. The command appears under **Project → Tools → Import Mapsoo Pack...**.

### Manifest or checksum error / manifest 或哈希错误

Select the extracted root `mapsoo.manifest.json`. Re-extract the complete ZIP instead of copying individual files.

### Re-import reports conflict / 重复导入报告冲突

Mapsoo refuses to overwrite manually changed, missing, unexpected, or state-mismatched managed files. Save your work, move the old `res://mapsoo_imports/<pack-id>/` directory aside, and retry with a clean target. See the [safe re-import contract](11_SAFE_GODOT_REIMPORT.md).

## Scope boundary / 范围边界

Alpha9 supports only `topdown-farm`. It is not evidence of external adoption, External Host production integration, itch.io publication, or support for `side-platformer`, `isometric-action`, or `layered-depth-2d`.
