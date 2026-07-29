# Mapsoo WorldForge 总控计划

状态：执行中

当前阶段：[`v0.1.0-alpha.9`](https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.9) 已于 2026-07-20 公开发布：本地参考图输入、程序化 `topdown-farm` 完整资产、Pack Schema 0.6.0 与 Godot 4.3+ 派生路径；另外三个 profile 仍为计划。公开 release 不等于外部采用或 External Host 生产接入。GitHub Release/Pages 是主发布渠道，itch.io 页面按维护者决定延期。

主分支：`main`

开发分支：使用短期 `codex/*` 分支，经公开 PR 合入 `main`

## 1. 总目标

把 `mapsoo-kids` 从儿童产品展示网站扩展为一个真正可复用的开源工具：用户输入世界设定，Mapsoo 生成、检查、预览并导出可以在 Godot 4 中使用、也适合发布到 itch.io 的世界美术资产包。

这不是单纯的“AI 出图网页”。项目价值来自完整工程闭环：

> 世界设定 → 可重复生成 → 素材规范化 → 地图预览 → 自动检查 → Godot 导入 → itch.io 发布包

## 2. 成功定义

项目达到 v0.1 时，陌生开发者应能在不注册账号、不配置云服务的情况下：

1. 打开网页并选择一个世界模板；
2. 修改主题、种子、Tile 尺寸、地图尺寸和配色；
3. 生成一套确定性的像素风地形与道具占位素材；
4. 在浏览器中看到按 Tile 网格渲染的地图；
5. 得到明确的素材检查结果；
6. 下载不含可执行代码、包含 PNG、世界描述、清单和许可证的 ZIP；
7. 从官方可信来源安装 Godot importer，再按 README 打开结果。

## 3. 核心产品原则

- **先闭环，后模型**：先证明导出资产真的可用，再接 AI 图像模型。
- **本地优先**：v0.1 无账号、无后端、无 API Key 也能完成生成。
- **可重复**：相同 World Spec 与 seed 必须生成相同结果。
- **供应商可替换**：AI 图像服务、本地工作流和程序化生成都实现同一个 provider 接口。
- **格式是产品**：清晰的 schema、manifest、命名和验证规则比一次漂亮出图更重要。
- **许可证跟随资产**：每个来源、生成器与输出包都有可追踪的许可和生成记录。
- **External Host 可复用但不绑死**：Mapsoo 服务所有 Godot 创作者，External Host 是计划中的首个大型真实使用方；当前只完成公开对接契约，尚无生产消费端证据。

## 4. 工作流分解

### A. 项目与安全基线

- 移除旧网站的主构建入口和客户端硬编码凭证；
- 不迁移 Supabase、博客、社区、账号、CMS 和营销素材；
- 清理 `._*` AppleDouble 文件和旧站文件；
- 确定开源许可证与资产许可证边界；
- 建立可通过 CI 的安装、构建和测试命令。

### B. 产品核心

- World Spec 编辑器；
- seed 驱动的本地生成器；
- Tile 地图预览；
- 项目状态持久化；
- 生成记录与版本迁移。

### C. 资产工程

- tilesheet 与单图组织；
- 尺寸、透明度、颜色、命名检查；
- manifest 和 license receipt；
- ZIP 导出；
- Godot 导入脚本与示例工程。

### D. AI 扩展

- provider contract；
- 图像生成、切图、去背景、缩放、调色与一致性处理；
- 失败重试与局部重生成；
- 成本、模型、prompt、seed 记录。

### E. 开源社区

- README、LICENSE、CONTRIBUTING、SECURITY、Code of Conduct；
- issue/PR 模板与路线图；
- 示例世界和首个 release；
- 外部用户反馈与贡献记录；
- Codex for OSS 申请材料。

## 5. 里程碑与出口条件

| 阶段 | 产出 | 出口条件 |
| --- | --- | --- |
| Phase 0 Foundation | 新定位、文档、安全修复、开发分支 | 无已知硬编码私密凭证；README 与许可证清楚；基线能构建 |
| v0.1 Local Pack | 本地生成、预览、校验、ZIP | 无 API Key 完整走通；固定 seed 快照稳定；ZIP 结构通过自动测试 |
| v0.2 AI Providers | 至少一个云端或本地 AI provider | provider 可替换；生成记录完整；错误和费用边界可见 |
| v0.3 Godot Workflow | Godot 插件/导入器和示例项目 | 新用户在 10 分钟内完成导入；Godot 4 LTS/稳定版验证通过 |
| v0.5 Community Beta | 示例、文档、贡献流程、预发布 | 至少 3 个示例包、外部 issue/反馈、首个 beta release |
| v1.0 Stable | 稳定 schema 和兼容策略 | schema 版本化、迁移策略、跨平台测试和正式 release |

表中的 `v0.1`–`v1.0` 是能力轨标签，不预留或预测 `package.json`、Git tag 或 GitHub Release 的 SemVer。公开发布序列和兼容事实只由 release registry、tag、不可变附件及其 digest 证明；例如 Alpha.6 可以推进 World System 能力，但不因此等同于能力轨 `v0.4` 或 SemVer `0.4.0`。

当前状态：Phase 0 已完成；v0.1 已具备编辑、严格 World Spec JSON 保存/加载、确定性生成、Canvas 预览、portable ZIP、Godot importer、安全重导入、四层可编辑地形、语义地点、地点关联建筑外观、三世界画廊、示例工程、桌面/390px 浏览器视觉验收、可重复 release bundle，以及真实浏览器 ZIP 在 Linux/Windows Godot 4.3/4.7 中的跨管线验收。`v0.1.0-alpha.1` 至 [`v0.1.0-alpha.9`](https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.9) 九个不可变 prerelease、Pages Demo、公开 CI、发布视频和反馈入口均已完成；alpha.7 发布三个独立世界包，alpha.8 发布脱敏 `ExternalHostAssetRequest` 到 Alpha.7 兼容 Godot 包及外部回执的可复现无 UI CLI，alpha.9 发布仅 `topdown-farm` 的参考图到 Pack 0.6 纵向闭环，但这些都不是 External Host 生产采用证明。itch.io 页面按决策延期且不再作为当前 release gate；外部反馈尚未形成。

## 6. 总控节奏

每一个实现批次遵守以下顺序：

1. 在本文件和 Roadmap 中选定一个可验证目标；
2. 如任务可独立并行，分派只读调研或边界清晰的实现子任务；
3. 主控整合设计，避免多个智能体同时修改同一文件；
4. 实现最小变更；
5. 执行构建、单元测试、导出验收或视觉检查；
6. 更新状态、风险与决策记录；
7. 形成便于 review 的提交，不把无关改动混在一起。

## 7. 决策记录

| 编号 | 决策 | 原因 | 状态 |
| --- | --- | --- | --- |
| D-001 | 当前产品名使用 Mapsoo WorldForge；已发布 Pack 的 `Mapsoo Worldsmith` 仅作为 legacy generator/protocol identity 保留 | 对外名称与仓库一致，同时不破坏不可变 release、schema、receipt 和 Godot 校验 | 已采纳；由 product identity gate 约束 |
| D-002 | v0.1 先做程序化本地生成 | 可测试、可重复、零成本，先验证资产工程闭环 | 已采纳 |
| D-003 | 保留 React + Vite 工具链，但应用代码直接重建 | 工具链足够，旧网站业务没有迁移价值 | 已采纳 |
| D-004 | World Spec 是 External Host 与 Mapsoo 的共享边界 | 同一世界描述可驱动游戏素材、故事场景和后续内容 | 已采纳 |
| D-005 | 源码 MIT，样例/生成资产单独声明 | 代码许可不应错误覆盖第三方或模型生成内容 | 已采纳 |
| D-006 | 不直接在浏览器伪造生产级管理员认证 | 客户端凭证无法保密；v0.1 不需要管理员系统 | 已采纳 |
| D-007 | portable PNG + JSON 是跨引擎真源，Godot 资源由编辑器内 importer 派生 | 避免浏览器手写 UID 相关资源，并让 itch.io 与其他引擎也能复用 | 已采纳 |
| D-008 | v0.1 schema 严格拒绝未声明字段；生态扩展只能放入已显式声明的 `extensions` 对象，并使用 reverse-DNS namespace | 兼顾验证确定性与 External Host 等集成需求，不让“保留任意未知字段”成为隐式兼容承诺 | 已采纳 |
| D-009 | Provider SDK 先包装程序化基线；在 provider receipt、许可和 AI disclosure 完成前，v0.1 exporter 拒绝其他 Provider | 防止未来模型输出被错误标记为非生成式 AI 或沿用 CC0 程序化许可 | 已采纳 |
| D-010 | 已公开 alpha.1 receipt/fixture/hash 永不原位改写；完整 receipt 使用 `0.2.0` 合同并进入新版本 release | 保留可验证的公开证据，避免同一 tag 对应多组来源与许可语义 | 已采纳 |
| D-011 | Provider runner 原子返回深冻结的 `world + evidence`；Provider claims 不能覆盖 identity、execution、provenance、AI flag、human curation 或时间 | 消除 UI/导出错配和 Provider 返回引用的 TOCTOU，给下一版本 receipt/export 建立可信调用边界 | 已采纳 |
| D-012 | package version 只能选择 registry 中深冻结的 release 配置；receipt verifier 由可信配置分派，已发布 fixture 每次重建都必须匹配不可变公开 hash | 允许后续版本原子加入新 schema、fixture 与 itch 素材，同时防止未知版本、伪造 manifest 或新代码改写 alpha.1–alpha.4 历史证据 | 已采纳 |

## 8. 当前风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 旧仓库已公开硬编码客户端凭证 | 账号复用风险 | 已从新工作树退出；若密码复用则立即轮换；不为旧站继续投入开发 |
| 旧图片和 AppleDouble 文件导致仓库臃肿 | 克隆慢、社区体验差 | 新版本删除旧文件；历史瘦身只在确实影响贡献者时再做 |
| AI 图片不能天然满足 Tile 无缝和一致性 | 导出不是真正可用资产 | 加后处理、验证、局部重生成；程序化基线作为 fallback |
| Godot 文本资源格式受版本与 UID 影响 | 直接生成 `.tres` 容易脆弱 | 优先输出稳定原始素材 + Godot 内执行的 importer |
| 生成资产版权与训练来源不透明 | 不适合分发/销售 | provider 元数据、用户确认、生成记录、独立资产许可证 |
| 项目为了申请福利而显得一次性 | 申请可信度低 | 持续 release、外部用户、issue、贡献和真实 External Host 使用证据 |

## 9. 当前下一步

1. 维护 [`Alpha.9 参考图到 Top-down Farm 世界包`](19_ALPHA9_REFERENCE_TO_FARM_WORLD.md) 的已发布证据：公共 tag、24 个附件、远端 digest 和 Godot 4.3/4.7 四平台验收已经完成，但仍不声称外部采用；
2. 四个公开 asset profile 是长期目标；Alpha.9 只交付 `topdown-farm` 纵向闭环，不能用该结果声称侧视平台、等距动作或分层景深 profile 已支持；
3. 后续版本继续保持 profile completeness、隐私/权利、真实浏览器 ZIP、桌面/390px 视觉、Linux/Windows × Godot 4.3/4.7 exact-pack、安全重导入和已发布历史不可变门禁；
4. 继续邀请第一轮外部用户并如实记录结果；没有独立证据前不声明外部采用或生产接入；第三方平台发布继续延期，不阻塞 GitHub 路线。
