# External Host × Mapsoo 集成

## 1. 关系定位

External Host 是儿童 AI 创作平台与持续世界体验；Mapsoo 是通用的世界美术资产生产和导出工具。二者共享世界描述，但职责不同：

```text
External Host World Engine
  ├─ 孩子、伙伴、成长目标
  ├─ 故事、任务、地点和世界状态
  └─ 内容安全与家庭边界
             │ World Spec
             ▼
Mapsoo Worldsmith
  ├─ 视觉风格与 palette
  ├─ terrain / props / buildings
  ├─ 地图与预览
  ├─ 资产检查和来源记录
  └─ Godot / itch.io / 通用包导出
```

## 2. 共享信息

公开 Alpha.4 使用 World Spec `0.1.0`；当前公开 Alpha.5 使用 `0.2.0` 并保持旧版显式迁移。两者共有的核心通用字段：

- pack/world ID、标题、描述和 seed；
- meadow、desert 或 snow biome，以及地图宽高；
- pixel-art 风格、五色调色板和 Tile 尺寸；
- `common / godot / itch` 输出目标；
- CC0-1.0 资产许可；
- 严格、namespaced `extensions` 扩展入口。

External Host world version、scene ID、公共场景标签和年龄分类并不是核心 World Spec 的原生字段。它们由独立的 `ExternalHostAssetRequest` 白名单投影后写入 `org.mapsoo.externalhost.assetrequest.v1`。Alpha.5 的 World Spec 0.2 已支持作者显式声明通用地点锚点，但 External Host Asset Request 1.0 不会把 `requiredSceneTags` 自动推断成地点；道路语义、角色视觉引用和任务交互仍是后续契约。

External Host 私有字段不要强行进入 Mapsoo 核心字段。v0.1 使用严格 schema，并已为集成方显式声明 `extensions` 对象；扩展必须使用 reverse-DNS namespaced key，例如：

```json
{
  "extensions": {
    "org.mapsoo.externalhost.assetrequest.v1": {
      "schemaVersion": "org.mapsoo.externalhost.asset-request/1.0.0",
      "assetRequestSha256": "<canonical request SHA-256>",
      "externalHostWorldId": "river-valley",
      "externalHostWorldVersion": "1.0.0",
      "sceneId": "riverbank-observation",
      "requiredSceneTags": ["riverbank", "old-bridge", "observation-point"],
      "contentRating": "ages-7-plus"
    }
  }
}
```

Mapsoo 对 `extensions` 中合法 namespace 的值原样保留但不解释；对象之外的未知顶层字段仍应校验失败。涉及儿童、家庭或商业隐私的数据仍应只保存在 External Host 自己的数据层，不进入开源示例和导出包。

### 2.1 字段所有权与隐私边界

External Host 不应把完整 World State 直接传给 Mapsoo。两者之间增加一个脱敏、白名单化、可 hash 的 `ExternalHostAssetRequest` 投影层：

| 方向 | 允许传递 | 不允许跨界 |
| --- | --- | --- |
| External Host → Mapsoo | 脱敏 world/scene ID、world version、biome、视觉约束、公共场景标签、资产许可选择 | 儿童身份、语音/聊天、个人学习目标与进度、家长资料、伙伴关系、家庭设置、私有服务地址、商业密钥 |
| Mapsoo → External Host | pack ID/version、Asset Request hash、manifest 逐文件 hash、整体 ZIP hash、World Spec/receipt hash、当前 tile/prop ID、atlas 坐标、地图图层、预览与 license/provenance；Alpha.7 兼容 pack 包含通用 places/structures sidecar，但尚无 External Host 消费端映射 | Mapsoo 不生成或推断儿童画像、家庭结论、内容安全结论和打印履约数据 |

`learningGoals` 不属于 `ExternalHostAssetRequest 1.0.0`，即使是非个人化分类也必须先由 External Host 投影成公共 `requiredSceneTags`，例如 `riverbank`、`observation-point`；某个孩子的目标或完成状态永远不跨界。当前 `extensions` 是格式扩展口，不是隐私沙箱；进入其中的内容也会随 World Spec 导出。

### 2.2 已实现的可执行对接契约

公开集成层已经提供：

- [`integrations/external-host/external-host-asset-request.schema.json`](../integrations/external-host/external-host-asset-request.schema.json)：严格 Draft 2020-12 schema，所有层级 `additionalProperties: false`；
- [`examples/integrations/external-host/river-valley-asset-request.json`](../examples/integrations/external-host/river-valley-asset-request.json)：不含真实儿童、家庭或商业数据的合成请求；
- [`src/integrations/external-host/asset-request.ts`](../src/integrations/external-host/asset-request.ts)：字段白名单、规范化 JSON、SHA-256 与 World Spec 投影；
- [`src/integrations/external-host/asset-request.test.ts`](../src/integrations/external-host/asset-request.test.ts)：确定性、版本、标签、尺寸、风格、许可和隐私字段拒绝测试；
- [`src/adapters/import-external-host-asset-request.ts`](../src/adapters/import-external-host-asset-request.ts)：复用 World Spec 读取边界的严格本地文件导入；
- Workbench 中的 **Load External Host Asset Request**：投影成功后进入同一个 Provider runner、预览、validation 与 portable ZIP 流程；
- [`integrations/external-host/external-host-mapsoo-export-receipt.schema.json`](../integrations/external-host/external-host-mapsoo-export-receipt.schema.json)：严格的请求到 ZIP 外部回执；
- [`scripts/export-external-host-pack.mjs`](../scripts/export-external-host-pack.mjs)：显式时间、无 UI、可复现、永不覆盖的 Alpha.7 兼容包导出 CLI；
- [`scripts/run-external-host-pack-godot.ps1`](../scripts/run-external-host-pack-godot.ps1)：逐文件摘要核验后执行真实 Godot exact-pack 导入。

```bash
pnpm exec vitest run src/integrations/external-host/asset-request.test.ts src/adapters/import-external-host-asset-request.test.ts
pnpm external-host:export:verify
```

`packId` 必须标识一个可独立共存的 scene/variant；同一 world 的不同场景不要复用同一个 `packId`。对象键顺序不影响 `assetRequestSha256`，而有序数组内容或顺序变化会改变 hash。适配器只把白名单字段投影到 Mapsoo；`childId`、`parentEmail`、`learningProgress`、私有服务 URL 和 API key 等未知字段会被拒绝。该适配器不是 PII 内容识别器：ID、标签、content rating、seed、标题和描述等所有允许字符串的值，都必须由 External Host 投影层预先保证为合成或明确公开安全的数据。

### 2.3 版本与稳定引用

Mapsoo pack 不与 External Host world 版本一一绑定。一个世界版本可能生成多个 scene、主题、语言或分辨率包，因此集成记录至少拆分：

- `external_host_world_id` 与 `external_host_world_version`；
- `scene_id`；
- `asset_request_hash`；
- `mapsoo_pack_id` 与 `mapsoo_pack_version`。

Alpha.5 已为作者声明的稳定语义 ID 提供通用地点合同，Alpha.6 增加地点关联建筑外观，Alpha.7 发布三个可选世界包。Alpha.8 CLI 对当前 `ExternalHostAssetRequest 1.0` 刻意不从标签推断地点或建筑，因此合成请求示例的 places/structures 数量仍为零。重新生成可以改变 atlas 排列或地图细节，但不能静默重用或改变已发布语义 ID；未来 External Host 消费端应只引用语义 ID，不引用随机坐标。当前没有 External Host 生产接入证据。

## 3. 首个联合示例

推荐第一个示例世界使用“河谷生态探险”，因为它同时覆盖：

- 草地、水域、道路与桥梁等典型 Tile；
- 树木、石头、花、观察点等 props；
- External Host 中的探索、观察与任务；
- 一张可以进入 Godot 的地图；
- 一张可作为世界书地图页视觉来源的地图预览。

当前 `map-preview.png` 不是印刷成品：它没有纸张尺寸、300 DPI、安全边距、文字区或印刷色彩配置。正式世界书页面由后续独立 `print-layout` adapter 或 External Host 排版管线负责。

开源示例只保留通用世界，不包含儿童真实数据、商业 IP 或 External Host 私有服务地址。

## 4. 内容与营销复用

External Host 文档的核心主张可以转换为 Mapsoo 的开发者表达：

- External Host：Create characters. Build worlds. Print your stories.
- Mapsoo：Describe a world. Generate its assets. Ship it to Godot.

演示视频应先展示结果：输入一个世界设定，几秒后看到地图、tilesheet、验证报告和 Godot 导出包。不要从模型参数开始讲。

## 5. 长期协同

- Mapsoo pack 独立版本化，通过 world/scene 版本与 Asset Request hash 建立可追踪引用；
- External Host 记录孩子的选择和世界状态，Mapsoo 只负责可再生视觉资源；
- Mapsoo 生成的地图 preview 可用于 External Host 世界书打印；
- External Host 中成熟的世界模板可以脱敏后成为 Mapsoo 开源示例；
- Mapsoo 社区贡献的新 biome/provider 可以反向扩展 External Host 的世界生产能力。

## 6. 当前实现边界

portable alpha 已完成确定性 terrain/props 占位素材、地图预览、manifest、validation 和 ZIP。以下能力仍是路线图，不应在演示中描述为已交付：

- `requiredSceneTags` 当前随 World Spec/pack 保存，但不会自动映射成地点或建筑；这些语义必须由 World Spec 作者显式声明，且不代表碰撞、导航、任务或交互语义；
- Godot importer 仍以 `packId` 作为派生目录；相同 `packId` 的重新导入会替换派生资源，因此多场景/多变体必须使用不同 `packId`；
- importer 会验证通用 `runtime/places.json` 并派生 `Marker2D` 元数据，但尚未生成供 External Host 运行时直接读取的专用 integration sidecar；
- 直接读取未解压、不可信 ZIP（当前流程先解压，再由插件校验 manifest、hash 并生成 `TileSet`/scene）；
- 可进入建筑内部、角色、动画和授权 IP 视觉适配；
- 正式印刷版式；
- External Host 内容安全、隐私或家长控制判断。

Mapsoo 对 External Host 最准确的定位是：**计划成为 External Host 持续儿童世界背后的可复现视觉资产管线，同时对所有 Godot 创作者开放。**
