# 路线图

路线图按可验证成果排序，不用日期掩盖不确定性。每一阶段都应保持主分支可运行。

> **两条版本轨道：** `v0.1`–`v1.0` 标题是能力轨（capability track），用于组织长期产品范围，不等于、预留或预测 `package.json` 与 GitHub tag 的 release SemVer。`alpha.4`、`alpha.5` 等标题才指向候选/公开发布序列；实际版本、lifecycle 与兼容证据以 release registry、tag 和发布附件为准。

## Phase 0 — Foundation

目标：把“公开网站代码”变成可信的开源工具基线。

- [x] 接入公开仓库并创建开发分支；
- [x] 建立新产品定位和总控文档；
- [x] 加入 MIT 源码许可证；
- [x] 移除工作树中的硬编码管理员凭证；
- [x] 把旧 Supabase 客户端配置外置；
- [x] 完成已知硬编码凭证的最低限度处置与用户提醒；
- [x] 清理当前工作树中的 AppleDouble `._*` 文件并加入忽略规则；
- [x] 重命名 package 与页面 metadata；
- [x] 建立 typecheck、test、build；
- [x] 确认旧 UI、账号、社区、CMS 和营销内容全部不迁移。
- [x] 删除当前工作树中的旧站源码与旧图片；
- [x] 建立全新 Worldsmith 工作台入口。

## v0.1 — Local World Pack

目标：零账号、零 API Key 完成一次可用导出。

- [x] World Spec TypeScript 类型与基础运行时校验；
- [x] 固定 seed 的 PRNG；
- [x] meadow/desert/snow 程序化配色与 Tile 定义；
- [x] 基础地图生成；
- [x] 工作台表单；
- [x] Canvas 地图预览；
- [x] 基础 validation report；
- [x] v0.1 manifest、JSON Schema 和 generation receipt；
- [x] 浏览器端 PNG + JSON portable ZIP 导出；
- [x] World Spec JSON 本地下载/严格加载闭环与浏览器验收；
- [x] 确定性生成、基础校验、稳定 Godot ID/atlas 坐标单元测试；
- [x] 版本化示例 World Spec 与 ZIP 文件清单/hash 回归测试；
- [x] Godot 4.3+ importer alpha 与 4.3/4.7 headless smoke；
- [x] 真实浏览器 ZIP → Godot 4.3/4.7 跨管线验收；
- [x] 固化真实 Sunny Meadow 浏览器导出包，并纳入可重复 release 打包；
- [x] GitHub Pages 与 tag-gated release-draft 工作流准备；
- [x] 完成可校验的 itch.io 封面与五张真实 release 证据图；
- [x] 完成只含素材 ZIP、校验和、页面输入与媒体的可复现 itch.io operator upload kit；
- [x] 完成 75 秒中英双语、无音轨的本地 release-candidate 证据视频；
- [x] `v0.1.0-alpha.1` GitHub 预发布、公开 CI 与 Pages Demo。

## v0.2 — AI-assisted Assets

目标：在不破坏本地闭环的前提下接入 AI 候选资产。

- [x] provider SDK、capabilities、注册表与执行前后验证边界；
- [x] 把 `procedural-pixel-v1` 包装为零凭据、离线 Provider，同时保持 v0.1 输出不变；
- [x] Workbench 首次生成、编辑器生成和 JSON 导入统一接入 Provider runner，并处理取消、过期结果和安全错误状态；
- [x] 至少一个可选的 server-only 图像 provider，并保持离线 provider 为默认基线；
- [x] 生产美术 prompt 模板、原创风格边界与命名商业作品模仿拒绝；
- [x] 生产源图的确定性去背景、网格检查、nearest 缩放与透明像素清理；
- [ ] 单个 Tile/prop 局部重生成；
- [ ] 成本/错误/重试 UI；
- [x] 可恢复的本地生产任务账本、总请求预算、方向图确认闸门、中断对账与显式重试风险确认；
- [x] 下一版本的 `0.2.0` provider receipt 类型、JSON Schema、runtime validator 与 legacy release 语义校验；
- [x] runner-owned 原子 evidence envelope、Provider claims 校验、深冻结 world/spec snapshot 与 legacy exporter 信任边界；
- [x] 可信版本 registry、按版本选择的 release/itch 输入、receipt verifier 分派、已发布 pack 重建门禁与完整 GitHub 附件 digest 固定；
- [x] 可信 runner evidence → `0.2.0` receipt → alpha.2 manifest/export 投影，以及最终 ZIP 字节/hash/文件集合一致性测试；
- [x] 原子启用 alpha.2 package/UI，提交 12 文件浏览器 fixture、固定 hash，并接入 release/itch/Godot 4.3/4.7 门禁；
- [ ] 内容安全和许可提醒。

## v0.3 — Godot-native Workflow

目标：让 Godot 用户在编辑器内稳定导入和更新 Mapsoo pack。

- [x] EditorPlugin alpha；
- [x] manifest importer alpha；
- [x] TileSetAtlasSource 创建；
- [x] `TileMapLayer` 地图 scene 创建；
- [x] ownership state、`created/unchanged/updated/conflict`、输入快照复核、同父 staging、backup 后 baseline 复核与进程内回滚；
- [ ] 崩溃 journal/recovery 与同一 pack 并发锁；
- [x] importer 基线 headless smoke test；
- [x] 版本绑定的公开 10 分钟首次导入指南、Pages 下载入口与结构化反馈表单；
- [ ] Godot Asset Library 发布准备。

### alpha.4 — Playable Terrain Pack（已发布）

- [x] pack schema 0.2 的 Ground / Water / Roads / Props 分层合同；
- [x] Water 与 Roads 各 16 个 N/E/S/W mask，并在预览与 atlas 间共享像素来源；
- [x] 3 个 Ground 视觉变体与至少 6 个 biome 合理 prop；
- [x] Godot `MATCH_SIDES` Terrain Set 与 Water 全格 collision；
- [x] alpha.1–alpha.3 兼容、本地 Godot 4.3/4.7 synthetic 与 exact-pack 门禁；
- [x] 固定 alpha.4 浏览器 fixture 与候选 release bundle；
- [x] 公开 PR 的 Linux/Windows Godot 4.3/4.7 绿灯、GitHub prerelease 与发布后 digest ledger；
- [x] 离线 itch.io operator kit（只生成并验证，不上传）。

详细合同与停止条件见 [`12_ALPHA4_PLAYABLE_TERRAIN.md`](12_ALPHA4_PLAYABLE_TERRAIN.md)。

### alpha.5 — Semantic Places（已发布）

- [x] 新 schema 中的稳定、唯一、路径安全地点 ID 与受限语义字段；
- [x] 地点坐标、标签与引用的严格 schema/runtime 校验及负向案例；
- [x] receipt 绑定含地点声明的 World Spec；manifest/verifier 绑定派生地点 JSON、算法、schema、atlas、大小与 SHA-256；
- [x] Godot importer 派生按 ID 可查询的地点节点/sidecar，并保留安全重导入边界；
- [x] 最小 Godot 消费 fixture 不依赖随机坐标、节点顺序或 atlas 索引；
- [x] 真实浏览器确定性 ZIP 与 Linux/Windows Godot 4.3/4.7 exact-pack 门禁；
- [x] Alpha.1–Alpha.4 fixture、hash、tag 与合同保持不可变；
- [x] 公开 PR、release 审核、GitHub prerelease 与发布后 12-attachment digest ledger。

详细范围、验收、不做项与停止条件见 [`13_ALPHA5_SEMANTIC_PLACES.md`](13_ALPHA5_SEMANTIC_PLACES.md)。

### alpha.6 — Place-linked Exterior Structures（已发布）

- [x] World Spec 0.3 合同、四种 exterior structure archetype、确定性核心解析与浏览器预览；
- [x] 透明 structure atlas 与可复核 pivot/region/像素元数据；
- [x] engine-neutral runtime structures sidecar 及 manifest/receipt/verifier 绑定；
- [x] 浏览器结构图层、列表、桌面/390px 真实视觉验收；
- [x] Godot importer 派生与地点锚点关联的 `Sprite2D` 及安全重导入；
- [x] 以 `addons/mapsoo_importer` 为归档根的可安装 Godot addon（含插件 README/LICENSE/icon）及全新项目首次使用向导；不声称已上架 Godot Asset Library；
- [x] 真实浏览器 ZIP、Linux/Windows × Godot 4.3/4.7 exact-pack、GitHub prerelease 与 13-attachment 摘要门禁；
- [x] Alpha.1–Alpha.5 fixture、hash、tag 与合同保持不可变。

本版本只覆盖地点关联的四类建筑外观及可安装采用入口，不包含内部、门、碰撞、导航、玩法、External Host 专用映射/采用、itch.io 上传或 Godot Asset Library 上架声明。完整范围、门禁与停止条件见 [`15_ALPHA6_EXTERIOR_STRUCTURES.md`](15_ALPHA6_EXTERIOR_STRUCTURES.md)。

### alpha.7 — Multi-world Gallery（已发布）

- [x] Sunny Meadow、Dustwind Outpost、Frostwatch Vale 三个受信 World Spec 0.3 示例；
- [x] 统一、深冻结的 example registry 与 Workbench 三卡片资产画廊；
- [x] 三个独立、确定性、可逐包核验的 portable ZIP；
- [x] 三世界真实预览、版本绑定下载和桌面/390px 浏览器验收；
- [x] Linux/Windows × Godot 4.3/4.7 对三个 exact pack 的导入矩阵；
- [x] 首次导入指南和反馈模板支持明确选择示例世界；
- [x] 保持 Alpha.1–Alpha.6 fixture、hash、tag、附件与合同不可变；
- [x] 公开 PR、prerelease 与发布后 17 附件远端摘要门禁。

本版本是在三个独立单-biome 世界之间提供可验证选择，不实现单个世界内部的多 biome transition。完整范围、门禁与停止条件见 [`17_ALPHA7_MULTI_WORLD_GALLERY.md`](17_ALPHA7_MULTI_WORLD_GALLERY.md)。

### alpha.8 — Reproducible External Host Pack Export CLI（已发布）

- [x] 严格解析公开安全的 `ExternalHostAssetRequest 1.0`，绑定 canonical SHA-256；
- [x] 无损迁移到 World Spec 0.3，不推断或虚构地点与建筑；
- [x] 通过 loopback-only headless Chrome 复用已审核的 Alpha.7 浏览器导出器；
- [x] 输出 executable-free Alpha.7 兼容 ZIP 与 `org.mapsoo.externalhost.mapsoo-export-receipt/1.0.0` 外部回执；
- [x] 显式 UTC 时间、跨运行字节复现、`created / unchanged / conflict` 与原子独占写入；
- [x] Linux/Windows × Godot 4.3/4.7 exact-pack CI 全绿；
- [x] 公开 PR、Alpha.8 prerelease 与发布后 20 个远端附件摘要回写。

本切片提供公开可执行的生产边界，不代表 External Host 已有运行时消费者或生产采用。完整范围见 [`18_ALPHA8_EXTERNAL_HOST_EXPORT_CLI.md`](18_ALPHA8_EXTERNAL_HOST_EXPORT_CLI.md)。

### alpha.9 — Reference Images to Top-down Farm Pack（已发布）

- [x] 严格 Generation Request V2：环境参考图、角色参考图、短描述、精确 `topdown-farm` profile、seed、预算与逐输入权利声明；
- [x] 本地字节、媒体签名、尺寸、预算、路径与权利验证，以及公开 receipt 隐私投影和 Provider provenance；当前不声称 OCR、人脸、商标检测或内容级净化；
- [x] Ground/Water/Paths-Fences/Crops/Structures/Props/Map/Character 八类完整 portable 资产；
- [x] 四方向角色 `idle/walk`、透明 atlas、pivot/foot point、作物阶段、分层地图和可行走/阻挡数据；
- [x] Pack Schema 0.6.0、`topdown-farm-complete-v1` 及 schema/像素/动画/引用/摘要/权利负向门禁；
- [x] 一键浏览器生成、预览、确定性 ZIP 与桌面/390px 视觉验收；
- [x] Godot 4.3+ importer 与 Linux/Windows × Godot 4.3/4.7 exact-pack `created → unchanged` 验收；
- [x] Alpha.1–Alpha.8 fixture、hash、tag、附件与合同保持不可变；
- [x] Alpha.9 release registry、24 个固定附件、公共 tag、发布工作流与发布后远端摘要审计。

项目最终目标包含 `side-platformer`、`isometric-action`、`topdown-farm`、`layered-depth-2d` 四个公开 profile，但 Alpha.9 只实现 `topdown-farm` 纵向闭环；另外三个仍为计划。Alpha.9 已公开发布，但不表示外部采用、External Host 生产接入或第三方平台上架。完整范围、隐私/权利边界与验收证据见 [`19_ALPHA9_REFERENCE_TO_FARM_WORLD.md`](19_ALPHA9_REFERENCE_TO_FARM_WORLD.md)。

### Alpha.10 — complete side-platformer contract（进行中）

- [x] 冻结 Generated Asset Bundle `0.2.0` 与 `side-platformer-complete-v1` 的 30 个 canonical role；
- [x] 冻结左右向 `idle/run/jump/fall/land/hurt` 共 12 个角色 clip；
- [x] 可信 Provider runner 按 profile 分派完整性合同，并继续拒绝未实现 profile；
- [x] 逐 role、逐 clip、跨 profile/schema、路径和 atlas 越界负向测试；
- [x] Pack Schema 0.7、scene/collision/navigation sidecar schema 与 receipt 0.2；
- [x] 程序化 side provider、30-role/12-clip 输出与确定性 Pack 0.7 ZIP exporter；
- [ ] 浏览器一键选择 `side-platformer`、真实下载与固定 fixture；
- [ ] Godot 独立 0.7 validator、scene builder 与真实 physics smoke；
- [ ] Linux/Windows × Godot 4.3/4.7 exact candidate ZIP；
- [ ] 安全、权利、隐私、兼容与发布独立审计。

Alpha.10 不能修改已发布 Alpha.9 Pack 0.6、receipt 0.1、fixture、附件或摘要，也不能用一张横板概念图冒充完整世界资产包。权威合同与停止条件见 [`21_ALPHA10_SIDE_PLATFORMER.md`](21_ALPHA10_SIDE_PLATFORMER.md)。

## v0.4 — World System

- [ ] 多 biome 与 transition；
- [ ] 在 Alpha.5 稳定地点合同之上扩展道路关系与兴趣点系统；
- [ ] 建筑和内部场景；
- [ ] 角色 sprite/动画合同；
- [ ] 世界版本和增量更新；
- [x] 可执行、隐私最小化的 `ExternalHostAssetRequest` → World Spec namespaced extension 契约与 Workbench 本地导入；
- [x] 可复现、无 UI 的 External Host 请求 → portable Godot pack + 外部 hash 回执桥接；
- [ ] 在公开中立合同稳定后评估 External Host 专用运行时映射；未接入前不声明采用。

## v0.5 — Community Beta

- [ ] 3–5 个高质量示例包；
- [x] 贡献指南、行为准则、issue/PR 模板；
- [x] alpha.2 首次导入反馈表单与统一维护入口；
- [ ] 文档站或完整示例页；
- [ ] 外部试玩与可复现反馈；
- [ ] itch.io 免费素材页（维护者决定延期；保留已验证上传套件，但不作为当前 alpha.2 gate）；
- [ ] beta release 与 changelog。

## v1.0 — Stable

- [ ] schema 稳定性与迁移政策；
- [ ] 跨浏览器、跨平台构建；
- [ ] Godot 支持矩阵；
- [ ] 性能和文件大小预算；
- [ ] 无障碍与国际化；
- [ ] 安全、隐私和依赖审计；
- [ ] 正式文档、演示视频和 release。
