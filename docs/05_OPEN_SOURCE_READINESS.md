# 开源成熟度与 Codex for OSS 准备

## 1. 当前判断

仓库设为 Public 只是起点。一个可信的开源项目还需要明确许可证、可运行说明、维护轨迹、issue/PR 流程、release、真实用户和可复用价值。

Mapsoo 应以一个核心仓库申请，不需要用两个刚公开的网站凑数量。申请叙事应围绕 Godot 世界资产管线、开放格式、计划中的 External Host 首个消费场景和对独立开发者的价值；在真正接入前不得把 External Host 写成已采用。

公开 `main` 已达到 Godot-importable alpha。当前公开版本是 [`v0.1.0-alpha.9`](https://github.com/babyrush0101-source/mapsoo-worldforge/releases/tag/v0.1.0-alpha.9)：一键本地双参考图输入、离线程序化 `topdown-farm` 完整资产、Pack Schema 0.6.0、隐私最小化 receipt，以及 Godot 4.3+ 派生和 Linux/Windows × Godot 4.3/4.7 exact-pack 验收。另外三个 profile 仍为计划。GitHub Pages Demo、公开 CI 与九个不可变 prerelease 可匿名访问；itch.io 页面延期，真实外部使用反馈仍未完成。第九个 release 不能写成成熟通用图像生成器、External Host 采用或外部采用。

当前已发布证据：[仓库](https://github.com/babyrush0101-source/mapsoo-worldforge)、[Demo](https://babyrush0101-source.github.io/mapsoo-worldforge/)、[`v0.1.0-alpha.9` GitHub prerelease](https://github.com/babyrush0101-source/mapsoo-worldforge/releases/tag/v0.1.0-alpha.9)、[Alpha.9 tag workflow](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/runs/29727475555) 与[反馈入口](https://github.com/babyrush0101-source/mapsoo-worldforge/issues/12)。Alpha.9 tag commit 为 `7e0a254e59e5d49fda87fb52b91aecc46f32e3ae`；24 个附件摘要已固定，Pack 0.6 ZIP SHA-256 为 `10d89c7888b70215a14af2b6552fc5237d799df9cd3092aee99541961d9e480c`。

独立使用与维护响应只记录在 [`14_COMMUNITY_EVIDENCE.md`](14_COMMUNITY_EVIDENCE.md)。当前台账明确为空，不把维护者测试、机器人下载、star/fork 或 External Host 计划计作采用。

首次用户漏斗已准备为公开、版本绑定的工程入口：Pages 直接提供 Alpha.6 素材包与 importer addon 下载，[Alpha.6 首次 Godot 导入指南](16_ALPHA6_FIRST_GODOT_IMPORT.md) 固定文件名、SHA-256、安装/启用步骤、成功场景路径和安全重导入边界，[结构化反馈表单](https://github.com/babyrush0101-source/mapsoo-worldforge/issues/new?template=first-import-feedback.yml) 同时接受成功与失败。它只能证明项目已为外部验证做好准备；在独立用户提交结果前仍不能宣称 meaningful usage。

`v0.1.0-alpha.2` 已于 2026-07-19 从 `main` commit `072a7b8` 公开发布：包含 100 个测试、真实浏览器 12 文件 fixture、固定资产 ZIP SHA-256 `8c7720a8578cdc276ff69677ed0d64d8a1524d32fd00da0ffb8035b5a52bfcb6`、纯 JavaScript PNG 编码、receipt 0.2、31 个 receipt 篡改拒绝案例、24 个 itch 套件篡改拒绝案例、11 个可重复 GitHub Release 附件，以及全新的 1260×1000 封面和五张 1600×900 说明图。tag workflow 的 [构建与附件复核](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/runs/29674040991/job/88157935603)、[Godot 4.3](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/runs/29674040991/job/88158028238) 与 [Godot 4.7](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/runs/29674040991/job/88158028241) 全绿；发布后又逐项核对 11 个远端 digest、大小和 `SHA256SUMS`。itch.io 页面继续延期，不影响 GitHub 发布事实；宣传图的“CI-gated”仍以这些真实 job URL 为执行证据。

`v0.1.0-alpha.3` 已于 2026-07-19 从 `main` commit `65db8e3` 公开发布：真实浏览器 12 文件 fixture 固定为 SHA-256 `af95a4e57187fb85d06e34ccb0e1a1b1dba9b91e8989debf4c30a93108589696`，Godot importer 增加所有权状态、no-op、干净更新、冲突拒绝与进程内事务回滚。发布前 115 个测试、57 个跨版本 receipt 负向案例、24 个 itch 套件篡改案例和 11 个可重复附件均通过；tag workflow 在 Linux/Windows Godot 4.3/4.7 上对同一公开包完成 exact-pack 导入，发布后 11 个远端 digest 全部登记。itch.io 仍延期。

`v0.1.0-alpha.4` 已于 2026-07-19 从 `main` commit `87b9758` 公开发布：真实浏览器 ZIP SHA-256 为 `a57e810baaf2f015d7db96bf0e88ab7b6340d476a61ade7447735a6109b8fb35`，包含 schema 0.2、Ground/Water/Roads/Props、35 个 terrain tile 和 6 个 prop sprite。发布前 PR CI 的 146 个测试、90 个跨版本 receipt 负向案例、24 个 itch 套件篡改案例和完整 release/itch 可重复构建均通过；tag workflow 在 Linux/Windows Godot 4.3/4.7 上完成 `created → unchanged` exact-pack 导入，发布后 11 个远端 digest 全部登记。itch.io 仍延期。

`v0.1.0-alpha.5` 已于 2026-07-19 从 `main` commit `b67e7f4` 公开发布：真实浏览器 15-file ZIP SHA-256 为 `8d86124a4a37fa4a78487c4e91cb7f5024561f140814a5fd139c5b93fde54f36`，新增 World Spec 0.2、pack schema 0.3、4 个语义地点、地点 atlas/sidecar 与 Godot `Marker2D` 锚点。发布前 PR CI 的 171 个测试、120 个跨版本 receipt 负向案例和完整 release/itch 离线可重复构建均通过；tag workflow 在 Linux/Windows Godot 4.3/4.7 上完成 exact-pack 导入，发布后 12 个远端 digest 全部登记。itch.io 仍延期。

`v0.1.0-alpha.6` 已于 2026-07-19 从 `main` commit `315bc1b` 公开发布：真实浏览器 ZIP SHA-256 为 `4563552187977b38cdba86c7d3cbf5429a67b7a0a6049e978c2ef2992ef3a054`，新增 World Spec 0.3、pack schema 0.4、四类地点关联建筑外观、structures atlas/sidecar、Godot `Sprite2D` 派生、独立可安装 importer addon 与首次使用指南。发布前 191 个测试、155 个跨版本 receipt 负向案例、完整安全/浏览器/release 门禁和 Linux/Windows × Godot 4.3/4.7 exact-pack 均通过；发布后 13 个 Alpha.6 附件摘要及六个 release 的 69 个远端资产全部核验。itch.io 仍延期。

截至 2026-07-19，OpenAI 官方说明允许活跃开源项目的维护者申请；评审关注 meaningful usage、broad adoption、对软件生态的明确重要性，以及 PR review、issue triage、release management 等持续维护证据。项目不完全符合典型规模时仍可申请，但必须解释生态价值。入选者可获得 6 个月 ChatGPT Pro（含 Codex）；Codex Security 与 API credits 还取决于仓库和用途评审，不能在获批前写成既得权益。

官方条款还要求使用有效 ChatGPT 账号并提供准确、完整的信息；提交不保证入选，OpenAI 可验证维护者身份和仓库控制权。不要在申请材料中提交机密 External Host 信息，也不要把 Codex Security/API credits 用于无权管理的仓库。福利是个人、有限、不可转让的，并可能因项目或用途而异。

官方来源：[Codex for Open Source 项目页](https://developers.openai.com/community/codex-for-oss)、[当前申请表与评审说明](https://openai.com/form/codex-for-oss/)、[Program Terms](https://developers.openai.com/codex/codex-for-oss-terms)。

**申请条件与入选判断不能由本仓库自行确认：** 当前仓库可以提供公开代码、许可证、维护者角色、九个 release 与维护轨迹等申请材料，但是否满足计划条件及是否入选只能由 OpenAI 根据提交时的官方规则与核验结果决定。截至 2026-07-20 Alpha.9 发布后，反馈 issue 尚无独立用户结果，且 itch.io 页面未发布。Release 附件已有下载计数，但发布审计本身会下载每个附件且下载者身份不可见，所以这些计数不能证明外部采用；当前证据尚不能证明 meaningful usage。建议先取得至少一轮真实外部反馈与公开响应后再评估提交时机；itch.io 可以增加分发面，但已经延期且不作为申请准备的必需前置。若选择提前申请，也必须如实保留这些限制，不把材料齐备写成符合资格或必然入选。

## 2. 申请前证据清单

### 仓库基础

- [x] Public repository；
- [x] 明确源码许可证；
- [x] 新产品 README 与路线图；
- [x] 锁定包管理器与 lockfile，并提供 `pnpm check` 的安装后验证路径；
- [x] CI 状态徽章；
- [x] CONTRIBUTING.md；
- [x] CODE_OF_CONDUCT.md；
- [x] SECURITY.md；
- [x] issue/PR 模板；
- [x] 依赖更新和安全策略。

### 产品证据

- [x] 在线 Demo；
- [x] 本地 75 秒 release-candidate 证据视频；
- [x] 可匿名访问的公开视频 URL；
- [x] Godot 示例项目与 importer smoke fixture；
- [ ] itch.io 免费示例包；
- [x] meadow、desert、snowfield 三种本地配方；
- [x] `v0.1.0-alpha.1` pre-release 与 changelog；
- [x] 自动测试和 portable ZIP 导出契约验证；
- [x] 严格 World Spec JSON 保存/加载与非破坏性失败处理；
- [x] 浏览器视觉验收；
- [x] 本地 itch.io 封面与五张 release 证据图；
- [x] Godot 4.3/4.7 headless 导入验证。

### 维护证据

- [x] 连续、清晰的提交；
- [x] 通过公开 PR 记录 release、证据更新和输入安全加固；
- [x] 使用 issue 管理公开反馈入口；
- [ ] 至少一轮外部用户反馈；
- [ ] 对 issue 的响应记录；
- [ ] 外部 star/fork/download 或实际使用说明；
- [x] 明确 maintainer 身份与贡献边界。

## 3. 推荐申请时机

不要仅因已经 Public 就立即提交。官方条件不要求稳定版或 itch.io；对本项目而言，较强的申请节点是：

1. 至少一个可匿名下载的版本化 alpha release 已发布；
2. 在线 Demo、公开 CI 与 Godot 导入证据可访问；
3. README 和首次导入指南能让陌生用户独立完成验证；
4. 有至少一轮真实 issue、导入结果或外部反馈，以及维护者的公开响应；
5. 提交当天重新核对仓库、profile、release 与采用指标，不把维护者审计下载算成外部采用。

itch.io 是未来可选的额外分发面，当前已延期。当前查阅的官方申请材料没有把 itch.io 页面列为必填项；最终要求仍应以实际提交时的官方表单与条款为准，因此它不阻塞现阶段的材料整理。

官方说明允许重要但尚未广泛使用的项目解释自身价值，因此 star 不是唯一标准，但“刚公开、没有 release、没有社区痕迹”会明显削弱可信度。

## 4. 申请叙事草案

### 当前表单准备

截至 2026-07-19，官方表单需要：ChatGPT 账号邮箱、公开 GitHub username、公开 repository URL、Primary/Core maintainer 角色，以及不超过 500 字符的资格说明；API credits 意向需要 OpenAI Organization ID 和不超过 500 字符的用途说明，另有不超过 500 字符的补充信息。申请按 rolling basis 处理，字段和条款在真正提交当天仍需重新核对。

- GitHub username：`babyrush0101-source`
- Repository URL：`https://github.com/babyrush0101-source/mapsoo-worldforge`
- Role：`Primary maintainer`
- First name：`Josh`
- Last name：`Zhao`
- ChatGPT email：由维护者在提交时填写，不写入仓库
- OpenAI Organization ID：仅在确实申请 API credits 且维护者确认 ID 后填写

### Why does this project qualify?（500 字符内候选稿）

> I am the primary maintainer of Mapsoo WorldForge, an active MIT-licensed, local-first pipeline for auditable 2D world asset packs. Nine public prereleases provide audited worlds, a reference-to-farm Pack 0.6 workflow, versioned PNG/JSON, provenance receipts, reproducible builds, a separate Godot importer, and Linux/Windows tests on Godot 4.3/4.7. The project gives indie developers an open, engine-neutral way to create and audit reusable world assets. External adoption is still early.

### API credits usage（仅在申请时使用，500 字符内候选稿）

> API credits would be used only for opt-in experiments on a replaceable image-provider adapter: generating small 2D world-asset candidates, recording model and provenance metadata, testing deterministic post-processing, and evaluating license-safe export receipts. The existing offline procedural provider remains the free baseline. No user content would be uploaded by default, and no private External Host data would be included.

### Anything else（500 字符内候选稿）

> The repository has public CI, nine immutable prereleases, audited world packs, reproducible release ledgers, a live browser demo, a Godot addon, security and contribution policies, and structured feedback. Alpha.9 publishes a local reference-to-`topdown-farm` Pack 0.6 workflow, but we do not claim production or external adoption: maintainer/CI tests are excluded, itch.io is postponed, and the evidence ledger remains explicitly empty.

Alpha.9 is counted among the nine public prereleases above. Its offline procedural path produces only `topdown-farm` Pack 0.6 output, accepts only owned references with explicit CC0 dedication permission, performs structural/rights checks rather than content-level image screening, and provides no evidence of external adoption, External Host production use, itch.io publication, or support for the other three planned profiles.

### Role

Primary maintainer and creator of Mapsoo WorldForge.

### Project summary

Mapsoo WorldForge is an open-source, local-first pipeline that turns a versioned world specification into portable, validated 2D asset packs. Its current alpha combines deterministic procedural generation, engine-neutral PNG/JSON manifests, license provenance, executable-free asset packs, and a separately installed trusted Godot importer that derives engine-native resources inside Godot instead of making the browser emit fragile editor files.

### Ecosystem value

- 降低 Godot 独立开发者和 Game Jam 团队创建一致素材的门槛；
- 提供开放、版本化的 World Spec 与 manifest；
- AI provider 可替换，离线程序化流程不被单一平台锁定；
- 把许可和生成来源纳入导出包，而不是事后补记；
- 以 External Host 的持续世界生成需求作为计划中的首个真实消费场景；只有完成接入后才提交可公开且不泄密的采用证据。

### How Codex will be used

- 维护 schema、迁移和跨平台导出；
- 构建 Godot importer 和测试夹具；
- 自动审查 asset pack manifest 与 release；
- issue triage、文档和贡献者支持；
- 安全检查、依赖更新和 PR review；
- 维护不同生成 provider 的兼容层。

## 5. 社区边界

- 不把用户生成内容默认上传；
- 不要求贡献者提供付费 API Key；
- 内置示例必须许可清楚；
- 第三方 IP、角色和商标不得进入公共示例；
- AI provider 集成必须披露条款差异，不能笼统承诺所有输出可商用；
- 项目治理应围绕可复用工具，而不是只服务 External Host 私有逻辑。
