# 资产与导出规格 v0.1

本文描述 v0.1 的目标合同。当前 alpha 已输出 PNG、JSON、manifest、receipt、资产许可和所需 importer 版本；独立安装的官方 Godot EditorPlugin 可从已解压 pack 在 Godot 4.3/4.7 中派生 `TileSet`、`TileMapLayer` scene 和 props。素材包不携带可执行 GDScript，直接读取不可信 ZIP 也未开放。

## 1. 像素资产约束

| 属性 | v0.1 默认值 |
| --- | --- |
| 风格 | pixel-art |
| Tile 尺寸 | 32×32 px |
| 可选尺寸 | 16×16、64×64 px |
| 色彩 | sRGB |
| 图像格式 | PNG RGBA |
| 采样 | nearest-neighbor，无平滑 |
| 边距/间隔 | 0，除非 manifest 明确声明 |
| 文件名 | lowercase-kebab-case ASCII |
| 原点 | top-left；对象 pivot 单独记录 |
| Godot 最低版本 | 4.3 |
| Godot 地图节点 | TileMapLayer |

像素风输出不得在最终缩放时使用双线性插值。Godot 4.3 中这几项属于不同层级：PNG 导入设置使用 Lossless 压缩并关闭 mipmap；nearest 采样由显示纹理的 `CanvasItem` 控制，importer 应把生成的 `TileMapLayer`/预览节点的 `texture_filter` 设为 `TEXTURE_FILTER_NEAREST`。透明背景资产需要检查 alpha；完全不透明的地形 tilesheet 可以被允许，但必须在 manifest 标注。参考：[Godot 图片导入](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/importing_images.html)、[CanvasItem](https://docs.godotengine.org/en/stable/classes/class_canvasitem.html) 与 [TileMapLayer](https://docs.godotengine.org/en/stable/classes/class_tilemaplayer.html)。

## 2. 资产类别

- `terrain`：grass、soil、sand、snow 等基础地形；
- `transition`：岸线、道路边缘、地形过渡；
- `water`：静态水面，动画帧后续加入；
- `prop`：树、石、花、路牌等可摆放对象；
- `building`：v0.2 以后；
- `character`：v0.3 以后；
- `effect`：v0.3 以后；
- `preview`：封面和地图预览，不直接进入游戏。

## 3. Tilesheet 约定

v0.1 采用显式 atlas manifest，不依赖隐含位置：

```json
{
  "image": "assets/tiles/terrain.png",
  "tileSize": 32,
  "columns": 4,
  "rows": 2,
  "tiles": [
    { "id": 0, "name": "grass", "x": 0, "y": 0 },
    { "id": 1, "name": "water", "x": 1, "y": 0 },
    { "id": 2, "name": "path", "x": 2, "y": 0 }
  ]
}
```

`x/y` 是格子坐标而不是像素坐标。Tile ID 在同一个 tileset 内稳定；删除 Tile 时避免立即复用 ID。

Godot Atlas 额外规则：

- `TileSet.tile_size` 与 manifest 的 `cell_size_px` 一致；
- `TileSetAtlasSource.texture_region_size` 不小于 Tile 尺寸；
- v0.1 的 `margin` 和 `separation` 默认都是 0；
- `use_texture_padding = true`，减少纹理过滤产生的边缘接缝；
- Tile 由 manifest 显式创建，不扫描透明区域猜测；
- 已发布的 `source_id`、atlas 坐标和 alternative ID 不重新编号。

参考：[TileSet](https://docs.godotengine.org/en/stable/classes/class_tileset.html)、[TileSetAtlasSource](https://docs.godotengine.org/en/stable/classes/class_tilesetatlassource.html)。

## 4. 地图约定

- 使用二维 layer；
- v0.1 至少包含 `ground` 和 `props`；
- 地图坐标从左上角 `(0,0)` 开始；
- 空格使用 `-1`；
- layer 数据按 row-major 平铺，或二维数组，但 manifest 必须明确；
- 所有 Tile 引用必须指向已声明的 tileset 与有效 ID。

## 5. 包清单

`mapsoo.manifest.json` 至少包含：

- pack ID、标题、版本；
- Mapsoo 版本与 schema 版本；
- 生成时间；
- 目标引擎与验证版本；
- World Spec 路径和 hash；
- 每个文件的角色、字节数、媒体类型与必填 SHA-256；
- tileset 定义；
- map layers；
- provider receipt 路径；
- 资产许可，以及独立 importer 的 ID、最低版本和官方来源；
- attribution 条目。

## 6. v0.1 统一 ZIP 结构

```text
mapsoo-sunny-meadow-v0.1.0-alpha.1/
  readme.md
  license-assets.md
  mapsoo.manifest.json
  generation-receipt.json
  worlds/
    sunny-meadow.world.json
    demo-world.json
  atlases/
    terrain.png
    props.png
  previews/
    map-preview.png
  schema/
    mapsoo-pack.schema.json
    mapsoo-world.schema.json
```

上述树形是已发布、保持不变的 alpha.1。alpha.2 在相同结构中增加 `schema/mapsoo-generation-receipt.schema.json`，因此默认浏览器包为 12 个文件、11 条 manifest payload record；它不会把 importer addon 放进素材 ZIP。

当前已发布 Alpha.7 包使用 Pack Schema 0.5：每个包有一个版本化根目录、18 个文件和 17 条 manifest payload record，并增加四层地图数据、places/structures runtime sidecar、地点/建筑 atlas，以及对应的 World/Pack/Places/Structures/Receipt 五份 schema。Sunny Meadow、Dustwind Outpost 与 Frostwatch Vale 是三个相互独立的包，不是一个包内的多 biome。Alpha.8 External Host CLI 复用这份已审核合同；CLI 旁路生成的 `*-external-host-export-receipt.json` 位于 ZIP 外部，用来绑定请求 hash 与整体 ZIP hash，不计入包内 18 文件，也不改写 Alpha.7 官方附件。

所有消费者读取同一套 PNG、JSON、manifest 和许可文件。Godot 用户从官方仓库或未来的 Godot Asset Library 独立安装 importer；素材 ZIP 只在 manifest 中声明 importer ID、最低版本和官方来源，不维护容易漂移的第二套“Godot ZIP”。

### Provider Receipt 兼容边界

已公开的 `v0.1.0-alpha.1` 示例包含早期 `schema_version: 0.1.0` generation receipt。该文件属于已发布证据，保持原字节、manifest file record 和公开 ZIP hash 不变；它只对 allowlist 中的 `procedural-pixel-v1@0.1.0` 有效，不能作为 AI Provider 的发布凭证。

下一 pack release 使用独立 `mapsoo-generation-receipt.schema.json` 的 `0.2.0` 合同。所有顶层证据字段必填，语义上不存在的值写成 `null` 或空数组，而不是省略。Receipt 至少绑定：

- `created_at` 与 manifest 创建时间；
- World ID、seed、World Spec pack 路径与精确字节 SHA-256；
- Provider ID/version、local/remote execution 和 procedural/generative-AI provenance；
- 显式 model（程序化输出为 `null`）与版本化 workflow；
- 按执行顺序记录的 versioned transformations；
- `contains_generative_ai`、human curation 和公开说明；
- 输出许可、许可通知路径、Provider 条款与所有输入/参考 source 的 hash/许可。

Receipt validator 必须把这些字段与 runner 的冻结 Provider snapshot、World Spec、manifest、file records 和资产许可交叉校验。`human_curated: true` 不能把 AI 输出改写成非 AI；未知许可、缺模型/工作流、冲突 hash 或不完整 source 声明都必须 fail closed。许可只接受项目 allowlist 中的 SPDX ID；自定义条款必须显式使用 `LicenseRef-*`，source 的自定义许可还必须提供公开 HTTPS 条款 URL。公开 URL 禁止凭据、query 和 fragment，CC attribution 不得省略，source 必须至少绑定 pack path 或公开 URI。Receipt 不保存 API Key、私密 prompt 正文、signed URL 或原始 vendor error。

## 7. Godot 导入流程

Godot 资源通常在导入时产生 UID 和 `.godot/imported` 状态，因此 v0.1 由 Godot 内运行的普通 `EditorPlugin` 创建 TileSet/场景，而不是在浏览器里手写依赖特定 UID 的 `.tres`，也不抢占通用 `.json` 扩展名注册 `EditorImportPlugin`。`.godot/` 和 `.import` 缓存不进入导出包。参考：[Godot editor plugins](https://docs.godotengine.org/en/4.3/tutorials/plugins/editor/making_plugins.html)。

使用顺序：从官方可信来源安装并启用 Mapsoo importer → 解压 pack → 从 Tools 菜单选择已解压 pack 的 `mapsoo.manifest.json` → 打开 `res://mapsoo_imports/<pack-id>/<pack-id>.world.tscn`。

安全边界：pack 内的 SHA-256 只能证明文件与 manifest 自洽，不能证明发布者身份。第三方素材包即使附带 `addons/` 或 `.gd` 文件，也不得复制并启用；可执行 importer 必须通过独立可信渠道获得。

Importer 职责：

1. 读取 manifest；
2. 在解码前检查 PNG IHDR 尺寸/像素预算，解码后以内嵌 Lossless `PortableCompressedTexture2D` 保存，并把使用它们的 `CanvasItem`（尤其 `TileMapLayer`）设为 nearest texture filter；
3. 创建 TileSet atlas source；
4. 按 manifest 添加 Tile；
5. 创建 Godot 4.3+ 的 `TileMapLayer` 和地图内容；
6. 把两份资源和 `mapsoo.import-state.json` 完整写入同父级 staging，重新加载验证后再提交；
7. 以状态中的 manifest/output hash 判断 `created / unchanged / updated / conflict`，同一干净输入必须是真正不写盘的 no-op；
8. 更新时先把旧目录移到 backup，再 promote staging；promote 失败必须恢复旧目录；
9. manifest 解析与 hash 来自同一份字节，staging 完成后重新核对 manifest 和全部声明文件的输入快照；
10. 提交前核对旧 baseline，并在 `final → backup` 后、promote 前再次核对 backup baseline；变化时恢复 backup 并返回 `conflict`；
11. 输出可读的错误信息。

`mapsoo.import-state.json` 是本地 ownership/冲突检测记录，不是签名。目录内缺文件、多文件、hash 偏离、状态损坏或没有状态的旧 alpha 输出都必须 fail closed；用户先保留自己的修改，再移动/删除旧派生目录。当前承诺是正常进程内的事务提交与回滚，不宣称断电/进程崩溃原子性，也不允许同一 pack 并发导入。

## 8. itch.io 友好包

itch.io 不应成为私有格式。发布包在通用 ZIP 上增加：

- 清楚的封面和 2–4 张预览；
- 一页 Quick Start；
- 支持的 Tile 尺寸、引擎版本与文件格式；
- 商业使用、修改、再分发和署名规则；
- 版本号与 changelog；
- 联系方式、issue 地址和项目主页；
- 可选的 Godot demo，避免把编辑器缓存打包。

发布时将素材包归类为 `Graphical Assets`，不要因为 PNG 能在 Windows 打开就勾选 Windows 平台；生成器本身若发布到 itch.io，则归类为 Tool。生成式素材必须按 itch.io 要求填写 AI Disclosure。参考：[itch.io Creator guide](https://itch.io/docs/creators/getting-started)、[Quality guidelines](https://itch.io/docs/creators/quality-guidelines)。

## 9. 许可证模型

以下许可必须分开：

- **Mapsoo 源代码**：MIT；
- **Mapsoo 内置程序化示例资产**：推荐 CC0-1.0；
- **用户导入资产**：由用户声明并保留 attribution；
- **AI 生成资产**：记录 provider 条款、模型/工作流、生成日期和用户选择；
- **第三方字体/图标/模板**：单独列入 `THIRD_PARTY_NOTICES.md`。

导出器不能用“Mapsoo 是 MIT”推导“所有输出资产都是 MIT”。

Provider SDK 的存在不等于任意 Provider 已可发布。v0.1 exporter 只接受 `procedural-pixel-v1@0.1.0`；`0.2.0` receipt schema/runtime validator 只是下一版本的安全基础。其他 Provider 必须等 runner evidence envelope、manifest/export 接线、许可选择和 itch.io Graphics Disclosure 全部完成并评审后，才允许进入 portable/itch 输出。

## 10. 验收清单

- [x] 所有 PNG 尺寸与 manifest 一致；
- [x] tilesheet 宽高可被 Tile 尺寸整除；
- [x] 对象背景具有预期 alpha；
- [x] 地图中不存在越界 Tile ID；
- [x] 所有 manifest 路径使用 `/` 且为相对路径；
- [x] 不包含绝对本机路径、API Key 或用户目录；
- [x] README、资产许可和 generation receipt 存在；
- [x] ZIP 根目录只有一个带版本的 pack 文件夹；
- [x] 素材 ZIP 不包含 `.gd`、`addons/` 或其他可执行 importer 代码；
- [ ] Windows/macOS/Linux 解压后文件名稳定；
- [x] Godot 示例导入后保持 nearest-neighbor；
- [x] 在 Godot 4.3 与发布时最新稳定版完成导入 smoke test；
- [x] 示例场景使用 `TileMapLayer`，不依赖已弃用的旧 `TileMap`；
- [x] 重复导入区分 created/unchanged/updated/conflict，并有 no-op、冲突保护与进程内回滚测试；
- [ ] itch.io 预览与实际包内容一致。

推荐实现顺序：`manifest/PNG validator → ZIP exporter → Godot importer → 示例世界 → itch.io release pipeline`。
