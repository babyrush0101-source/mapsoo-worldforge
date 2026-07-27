# 技术架构

## 1. 现状与目标

现有仓库曾是 React 18 + Vite 6 的网站前端。v0.1 只保留 React/Vite 工具链和 Git 历史，应用源代码直接重建为 WorldForge 工作台；营销页、博客、社区、Supabase 登录和本地管理员不迁移。

目标架构把领域逻辑与 UI 分开，确保生成、校验和导出可以在浏览器 UI、测试、CLI 或未来 Godot 插件中复用。

## 2. 逻辑分层

```text
UI / Workbench
  ├─ World Spec editor
  ├─ Map preview
  ├─ Asset inspector
  └─ Export dialog
          │
Application services
  ├─ generateWorld(spec)
  ├─ validatePack(pack)
  ├─ save/load project
  └─ exportPack(pack, target)
          │
Domain core
  ├─ schemas and migrations
  ├─ seeded random
  ├─ generator/provider contracts
  ├─ asset and layer models
  └─ validation rules
          │
Adapters
  ├─ Canvas/PNG encoder
  ├─ ZIP writer
  ├─ browser storage
  ├─ procedural provider
  ├─ AI providers (later)
  └─ Godot exporter/importer
```

## 3. 当前目录与依赖方向

```text
src/
  core/          # 纯契约、校验、指纹、版本化 manifest；不认识 UI 或供应商
  providers/     # 内置程序化实现和可替换 provider 实现
  adapters/      # PNG/ZIP、文件、Godot、SpriteCook 等格式与运行时边界
  app/           # 跨 core/provider/adapter 的用例编排与应用状态
  features/      # 浏览器组件；只调用 app 用例或稳定 core 契约
  integrations/  # 可选 server-only 外部服务入口
scripts/         # 薄 CLI；解析参数后调用 app/adapters
godot/           # importer、示例工程与 headless 验证
schemas/         # 对外 JSON Schema
```

旧网站已经存在于 Git 历史，不需要在新工作树中额外保存 `legacy` 副本。

新增模块的依赖方向保持单向：`providers` 和 `adapters` 依赖 `core`；
`app` 负责编排它们；`features` 与 `scripts` 只作为入口。早期公开 facade
`core/generation-provider.ts` 和已发布导出策略
`core/playable-terrain-export-policy.ts` 仍反向绑定内置 provider，作为版本
兼容例外保留；新代码不得复制这种方向，未来只在版本化迁移时移除。
供应商 SDK、账号状态、计费和专有响应只允许停留在 `integrations` 或
专用 adapter。已被内部测试或外部调用使用的旧路径可以保留一行
re-export 兼容层，但不再放实现。只有职责真的增长时才拆模块，避免为了
理想目录提前搭框架。

## 4. World Spec

World Spec 是系统的主要输入，也是 External Host 与 Mapsoo 的共享协议。示意：

```json
{
  "schemaVersion": "0.1.0",
  "id": "sunny-meadow",
  "title": "Sunny Meadow",
  "description": "A gentle meadow crossed by a winding stream.",
  "seed": "mapsoo-demo-001",
  "visual": {
    "style": "pixel-art",
    "tileSize": 32,
    "palette": ["#2f6b3b", "#65a84f", "#b8d96f", "#4c93b5", "#d7c28a"]
  },
  "map": {
    "width": 24,
    "height": 16,
    "biome": "meadow"
  },
  "output": {
    "targets": ["common", "godot", "itch"],
    "assetLicense": "CC0-1.0"
  }
}
```

规则：

- `schemaVersion` 使用语义化版本；
- `id` 只能使用小写 ASCII、数字和短横线；
- `seed` 是字符串，算法内部稳定映射为整数；
- 尺寸必须设上限，防止浏览器内存失控；
- v0.1 JSON Schema 采用严格模式：未声明字段校验失败，避免拼写错误和不可复现输入被静默接受；
- v0.1 已显式声明顶层 `extensions` 对象；生态扩展必须使用 reverse-DNS namespaced key（例如已实现的 `org.mapsoo.externalhost.assetrequest.v1`）；Mapsoo 原样保留其值但不解释；`extensions` 之外的未知字段仍校验失败；
- 每次迁移保留纯函数和夹具测试。

## 5. Generator Provider

```ts
interface GeneratorProvider {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: GeneratorCapabilities;
  generate(spec: WorldSpec, options?: { signal?: AbortSignal }): Promise<ProviderGenerationOutput>;
}
```

当前注册表内置 `procedural-pixel-v1@0.1.0`，声明本地执行、seeded determinism、零凭据、程序化 provenance、支持的 biome/Tile 尺寸、地图上限和局部重生成能力。`runGenerationProviderWithEvidence()` 在执行前验证并快照 Provider 元数据、World Spec 与 capabilities，向 Provider 传入第二份 spec 副本，并在执行后验证 tile/prop 完整性、Provider 身份和 spec 未被改写；随后从白名单字段重新物化 world，严格校验 Provider claims，深冻结 world/spec/evidence，并原子返回单一 `GenerationRunResult`。Provider 不能声明 runner-owned 的身份、时间、AI flag 或 human-curation 状态。AbortSignal 在调用前、Provider 返回后和 evidence 完成后都有稳定错误边界，vendor 异常统一包装为 `provider.execution-failed`。World Spec 的程序化调用与文件导入共享 128 KiB、32 层和 10,000 节点上限，且拒绝循环和非 JSON extension 值。详见 [Provider SDK](09_PROVIDER_SDK.md)。

Workbench 的首次生成、编辑器生成和 World Spec 导入都通过同一个 runner。UI 以单一 generation session 管理请求：新意图会中止并淘汰旧请求，每个异步边界后都检查请求是否仍为最新，只有最新成功的完整 world/evidence 对能原子替换预览。失败时保留最后一个成功结果；面向用户和控制台的状态只暴露稳定错误码，不输出 Provider 自定义错误正文或 `cause`。生成、导入或 ZIP 构建期间互斥相关操作，legacy exporter 只接受 runner-owned result 并仍保留程序化 allowlist。

未来 AI Provider 不能绕过 domain validation；它们只返回标准化候选世界/资产，后续仍执行切图、缩放、命名、元数据与检查。当前 v0.1 exporter 只接受程序化 Provider，防止尚无 receipt 的模型输出被错误声明为 `contains_generative_ai: false` 或 CC0 程序化资产。

Provider receipt 至少记录：

- provider 和版本；
- 模型/工作流标识；
- seed；
- prompt 与负向约束（如适用）；
- 生成时间；
- 输入 spec hash；
- 后处理步骤；
- 用户声明与资产许可选择；
- 错误与重试次数。

## 6. Generated Pack

```ts
interface GeneratedPack {
  spec: WorldSpec;
  manifest: PackManifest;
  assets: GeneratedAsset[];
  map: TileMapData;
  receipt: GenerationReceipt;
  validation: ValidationReport;
}
```

资产在运行时使用 `Uint8Array`/`Blob`，避免把 base64 大量存入 React state。预览使用对象 URL，并在替换或卸载时释放。

## 7. 可重复随机数

不得使用 `Math.random()` 生成核心地图。实现固定算法（例如 xmur3 字符串散列 + mulberry32），并用固定输入/输出测试锁定行为。算法一旦进入 release 就带版本号；升级算法时保留旧版本或提供迁移说明。

## 8. 校验架构

每条规则返回：

```ts
type ValidationIssue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  assetId?: string;
  message: string;
  suggestion?: string;
};
```

v0.1 规则至少覆盖：schema、ID、文件名、Tile 整除、像素尺寸、alpha、引用完整性、重复 ID、地图 Tile ID 范围、license/receipt 缺失。

## 9. 导出架构

`output.targets` 表达同一份 portable pack 的消费意图，不代表当前浏览器会生成三份不同 ZIP。导出器接收同一个已校验的 `GeneratedPack`：

- `common`：稳定、引擎无关的素材和 JSON，是 ZIP 的实际来源；
- `godot`：在同一 manifest 中声明 importer 版本/官方来源；可执行 addon 独立安装，不进入素材包；
- `itch`：同一素材 ZIP 进入独立、由 release 工具构建的 operator kit；封面、截图和页面文案不由浏览器 ZIP 重复携带。

导出前若存在 error，默认阻止下载；warning 可由用户确认后继续。

## 10. 测试策略

- schema parse 和错误信息单元测试；
- seed 随机算法黄金值测试；
- 示例 world 的地图矩阵快照；
- PNG 像素数据 hash；
- ZIP 文件清单快照；
- manifest 引用完整性测试；
- Godot importer 的 headless smoke test（环境具备 Godot 时）；
- 浏览器端生成与下载 E2E；
- 对大尺寸 spec 的性能和内存上限测试。

## 11. 后端边界

v0.1 不需要后端。以下情况出现时再引入：

- 需要保护服务端 API Key；
- 需要队列处理长时间图像生成；
- 需要账户同步、公共图库或协作；
- 需要计费、速率限制、审核和审计。

即使增加后端，World Spec、manifest、validator 和 procedural provider 仍保持可离线使用。

## 12. Godot 派生资源事务

Godot importer 把 portable pack 的 PNG/JSON 视为权威输入，把 `.tres`、`.tscn` 与本地 ownership state 视为同一代派生输出。alpha.3 开发合同使用输入 snapshot、精确受管文件集合、同父 staging、`final → backup → promote` 和 backup 后 baseline 复核，输出 `created / unchanged / updated / conflict` 四种显式状态。

该机制只承诺正常进程内事务与回滚，不承诺断电原子性或跨进程并发。完整状态机和恢复边界见 [`11_SAFE_GODOT_REIMPORT.md`](11_SAFE_GODOT_REIMPORT.md)。

## 13. Reference World Job 候选管线

Reference World Job 是独立于 World Spec 的受限摄取信封：它接收环境参考图、角色参考图、公开安全描述、精确 asset profile、seed、输出预算和逐输入权利声明。摄取层先验证媒体/文本上限、净化 metadata 并生成不含本地路径或身份信息的公共投影；只有通过隐私、内容与权利门禁的投影才能进入 Provider runner。

```text
environment image ─┐
character image ───┼─> isolated decode/sanitize ─> public style contract ─┐
safe description ──┘                                                       │
                                                                            v
profile + seed + rights ─> provider candidate sets ─> normalize/atlas/map ─> completeness validator
                                                                            │
                                                                            ├─> portable PNG + JSON pack
                                                                            └─> Godot importer derived resources
```

四个公共 profile 为 `side-platformer`、`isometric-action`、`topdown-farm` 和 `layered-depth-2d`。它们共享 job envelope、provenance 与安全规则，但各自拥有独立的投影和 completeness validator；Alpha.9 只允许 `topdown-farm` 通过导出策略。

完整性验证器读取 manifest 绑定的 profile matrix，逐类复核必需资产、atlas region、alpha/pivot、动画方向/帧、地图图层、可行走数据、跨 sidecar 引用、文件大小与 SHA-256。Provider 只能返回分类候选，不能自己声明 pack 完整；exporter 只接受 runner-owned、深冻结且完整性无 error 的单一结果。非确定模型输出按冻结候选审计，seed 只承诺受信后处理、地图解析、packing 和序列化可复现，不能伪称模型像素可重复。

原始参考图、其原始公开 digest、EXIF/OCR、文件名、本地路径和自由文本 Provider 错误默认不进入公共 artifact。公开 receipt 只记录安全投影、Provider/工作流、确定性边界、权利类别、人工选择和输出许可；需要对私有原图做精确审计时使用不随 pack 发布的本地记录。详细合同、Godot matrix 与停止条件见 [`19_ALPHA9_REFERENCE_TO_FARM_WORLD.md`](19_ALPHA9_REFERENCE_TO_FARM_WORLD.md)。

## 14. 自研与复用边界

WorldForge 只自研决定项目差异化和可验证交付的核心：

- 多轮对话确认后的世界定义与版本化 checkpoint；
- `WorldLayoutConstraints`、四类确定性布局求解、`WorldLayoutPlan`、角色身份绑定和完整性规则；
- 人工确认的角色语义身份，以及四类镜头下只允许的适配边界；
- provider-neutral 美术任务、候选归一化、来源/许可记录和人工审核状态；
- 可复现世界包、Godot importer、World Runner 契约与树莓派交付证据。

已经存在且不是项目差异化的能力优先复用，不在核心中重复实现：

- 图像生成、参考图编辑和风格一致性；
- Sprite sheet、方向与动画候选生成；
- TileSet/auto-tile 制作、拼接预览和素材编辑器；
- 抠图、放大、格式转换等通用图像工具。

所有外部能力只能通过一个小型 adapter 接入：

```text
confirmed world
  -> confirmed WorldLayoutConstraints
  -> profile solver
  -> WorldLayoutPlan
  -> provider-neutral AssetRequirements
  -> ProductionArtPlan
  -> ProductionArtProvider port
       -> built-in offline adapter
       -> optional server-only SpriteCook adapter (implemented)
       -> optional model/artist adapter
  -> untrusted candidates
  -> normalize + validate + human review
  -> reproducible pack
  -> Godot importer / World Runner
```

核心、schema、manifest 和 Godot importer 不导入供应商 SDK，也不理解供应商响应格式。API key、OAuth session、计费、重试和供应商错误只存在于 adapter/runtime 边界；原始错误、私有 prompt、用户路径和凭据不得进入 pack。adapter 必须把结果降为标准候选文件和证据，不能自行宣布世界包完整、可发布或权利合格。

角色参考图的像素签名只证明几何和颜色来源相同，不能证明发型、脸部、服装或装备仍然是同一角色。`CharacterIdentitySemantics 1.0` 因此作为私有、人工确认的输入存在：核心校验其角色身份、来源摘要和确认 checkpoint，按 profile 编译允许的镜头/方向适配规则；模型 adapter 只在该任务获得单次 prompt/reference 上传授权后使用原始语义。公开 Pack、workflow state 和 receipt 不包含这些描述。

SpriteCook 作为已实现的可选 adapter，先复用其参考图驱动的通用 Sprite 生成和稳定 asset ID。私有工作流通过仓库外、账号隔离的 HMAC 缓存跨任务复用导入结果；缓存、锁和远程 ID 均不进入核心协议、公开状态或 Pack。其专用动画和 TileSet 工作流仍作为后续 adapter 能力，不并入核心。WorldForge 仍负责把候选组织成已确认世界的完整资产角色、地图计划和 Godot 可加载包。集成采用用户自带账号/授权，不复制其产品 UI，不把第三方 API 转售为 WorldForge 自有 API，并保留离线 provider 与其他 adapter 的同等入口。实现与未完成边界见 [`59_SPRITECOOK_PROVIDER_ADAPTER.md`](59_SPRITECOOK_PROVIDER_ADAPTER.md)。

SpriteCook 只允许两种薄接入方式，不成为运行时依赖：

1. 公开 API 通过现有 `ProductionArtProvider` port 返回 PNG 候选；凭据、资产 ID、轮询和计费信息停留在 server-only adapter。
2. 用户主动导出的 Godot 资源作为 authoring input；adapter 只提取 atlas、动画帧和 terrain 信息，再转换为 WorldForge 的逻辑材质映射并重新校验。Top-down/platformer 可复用其 auto-tile terrain，isometric 只按 atlas 输入处理。

可以直接吸收的工作流优点包括：批量生成前检查额度、把可复用资产 ID 保存到本地私有运行记录、用参考资产维持风格、默认紧裁切透明边界、按显式下载清单落盘，以及把动画帧和 Godot 资源分开物化。它们是 adapter 的操作策略，不是新的核心领域对象。WorldForge 不复制 SpriteCook 的账户、素材库、编辑器、计费或 MCP 会话管理。

核心不调用 SpriteCook MCP、不加载其插件，也不把第三方 `.tres` 直接当作可信 pack 内容。四类 profile 共用同一套候选和逻辑材质端口，不为每个供应商或 profile 复制一套 importer。

`AssetRequirements 1.0` 同样不建立第二套角色目录。它直接复用四类
profile 已有的 canonical role inventory：先保留完整基线角色，再把路线、
规模、垂直度、水域、聚落、危险度和地标数量编译为小型结构需求。当前
profile 没有诚实可用的角色时，需求必须标记为 `unresolved`，不能借用
无关贴图伪装覆盖。Provider 仍只负责候选生成，不能修改这些需求或决定
世界完整性。

已经审核并组装完成的 Pack 同样只走薄适配层，不再复制投影器：

```text
reviewed Pack 0.6 / 0.7 / 0.8 / 1.0
  -> shared exact archive loader
  -> small profile projector
  -> one reviewed-world source receipt
  -> fingerprint-bound recorded replay provider
  -> core/runWorldAssetProvider
  -> Godot importer / World Runner
```

`replayReviewedWorldAsset()` 是四类 profile 的唯一公开回放入口。Pack 1.0
仍是 layered-depth 可见资产、角色动画和地图 sidecar 的唯一组装来源；
Pack 0.6/0.7/0.8 review archive 分别保留现有 top-down、platformer 和
isometric 投影规则。四个投影器只负责校验 schema/语义/哈希并映射到已经
存在的角色契约；license、provenance 和审核状态统一保留在
`reviewed-world-asset-source-receipt`，不作为运行时资产，也不会被 replay
自动提升。这样 SpriteCook、模型、艺术家或离线工具只需产出同一标准候选/
Pack，核心和 Godot 路径保持不变。

新增依赖前使用四个判断：

1. 是否属于上述 WorldForge 核心；若是，维护稳定的内部契约。
2. 是否已有成熟、许可可接受的实现；若是，优先 adapter 或库。
3. 移除该供应商后，核心测试、离线基线和 pack validator 是否仍能运行。
4. 新抽象是否至少服务一个当前实现和一个可替代实现；否则保持简单函数，不提前搭框架。
