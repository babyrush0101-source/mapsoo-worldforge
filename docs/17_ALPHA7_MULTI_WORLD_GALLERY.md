# Alpha.7 多世界示例包与资产画廊

状态：已发布；`v0.1.0-alpha.7` 于 2026-07-19 通过公开审核、发布矩阵与附件审计。

公开证据：[GitHub Release](https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.7) · [PR #44](https://github.com/babyrush0101-source/mapsoo-kids/pull/44) · [发布流水线](https://github.com/babyrush0101-source/mapsoo-kids/actions/runs/29688782893)。17 个附件的实际 SHA-256 已写入不可变发布注册表；itch.io 仍按范围约束保持搁置。

## 1. 目的与选择理由

Alpha.6 已证明一套 Sunny Meadow 世界可以从 World Spec 0.3 确定性生成、导出、验证并导入 Godot，但公开 release 仍只有一个完整示例包。Alpha.7 的目标是把现有 `meadow`、`desert`、`snow` 三种程序化配方变成三个可匿名预览、独立下载、逐包验证和导入 Godot 的官方示例世界，并在 Workbench 中提供版本绑定的资产画廊。

这一阶段优先补齐“真实可选示例与采用入口”，而不是继续扩大单个世界的玩法范围。它直接推进 Community Beta 的 3–5 个高质量示例包目标，也更适合让外部开发者比较输出、完成首次导入并提交可复现反馈。

## 2. 三个官方示例世界

| world id | 展示名 | biome | 视觉方向 |
| --- | --- | --- | --- |
| `sunny-meadow` | Sunny Meadow | `meadow` | 温和草地、河流、村落与现有 Alpha.6 回归基线 |
| `dustwind-outpost` | Dustwind Outpost | `desert` | 暖色荒漠、稀疏水源、工坊与瞭望点 |
| `frostwatch-vale` | Frostwatch Vale | `snow` | 冷色雪原、冰水边界、神龛与高塔地标 |

名称、seed、配色、地点、结构声明和导出顺序必须固定在 Alpha.7 release 配置中。示例只能使用仓库自有程序化素材与明确许可，不引入第三方角色、商标或未披露来源的 AI 图片。

## 3. 完整里程碑范围

1. **三个独立 World Spec**：每个示例使用受信 World Spec 0.3，具备稳定 ID、固定 seed、至少一个语义地点和一个地点关联结构；schema 不因画廊而新增隐式字段。
2. **独立确定性素材包**：三个世界分别导出 executable-free PNG + JSON ZIP。每个 ZIP 都有自己的文件清单、大小、SHA-256、receipt、manifest、许可和版本绑定下载名，不能用一个大合集掩盖单包失败。
3. **Workbench 资产画廊**：提供三个卡片，可查看世界名、biome、版本、预览、关键内容和验证摘要，并把选中的 World Spec 加载到现有编辑/生成流程。画廊展示数据必须来自受信 release/example registry，不能维护一套与实际 fixture 无关的营销常量。
4. **真实预览与下载**：卡片预览由对应确定性世界生成；发布后下载入口指向该 tag 的不可变附件。开发态可以使用本地候选 fixture，但界面必须明确区分候选与已发布状态。
5. **Godot 精确导入**：同一个可安装 Alpha.7 importer addon 分别导入三个公开 pack；Godot 4.3/4.7 在 Linux/Windows 验证地形、地点、结构、metadata、`created → unchanged` 与安全重导入边界。
6. **发布登记**：release registry、远端历史校验和 `SHA256SUMS` 纳入三个 pack 及画廊所需公开附件；Alpha.1–Alpha.6 的 tag、附件、fixture、合同和 digest 保持不可变。
7. **外部反馈入口**：首次导入指南增加三个示例的选择说明，反馈模板要求填写示例 ID、Godot 版本、平台和结果。没有独立用户提交前，不把画廊访问、维护者下载或 CI 下载写成采用。

## 4. 首个实现切片（已完成）

首个切片只交付：

- `dustwind-outpost` 与 `frostwatch-vale` 两个 World Spec 0.3 示例及确定性快照；
- 统一、深冻结的 example registry，登记三个世界的 ID、标题、biome、World Spec 路径和候选状态；
- Workbench 三卡片画廊、选择/加载行为与桌面/390px 浏览器测试；
- 三个世界两次生成结果一致的核心/浏览器测试。

首个切片完成时只能称为“Alpha.7 画廊候选”。在三个 portable ZIP、Godot exact-pack 矩阵、发布附件和远端摘要全部通过前，不得称为已发布多世界示例包。

当前实现证据：`dustwind-outpost` 与 `frostwatch-vale` 两个新 World Spec 0.3 已加入；三个示例由深冻结 registry 登记并在模块加载时复核 ID、路径、biome 与严格 World Spec 校验；Workbench 提供三卡片选择并通过同一 provider 生成所选世界。196 个测试、完整 `pnpm check` 与安全高危门禁通过；真实浏览器已手动验证 Desert/Snow 切换时 title、ID、seed、palette、地点、结构和 Canvas 同步变化，桌面及 390px 无横向溢出或控制台错误。当前卡片顶部是受 palette 驱动的候选示意，不是发布 pack 的真实预览；真实 fixture 预览和版本绑定下载仍属于完整里程碑，不能提前勾选。

## 5. 完整门禁

### 合同与确定性

- 三个 World Spec 均通过严格 schema/runtime 校验，未知字段和非法引用 fail closed；
- ID、seed、地点、结构、排序和生成结果固定；相同输入两次导出逐字节一致；
- registry 不允许重复 ID、重复路径、未知 biome、可变对象或指向不存在的 World Spec；
- Alpha.1–Alpha.6 历史 fixture 的重建结果与公开摘要保持一致。

### 浏览器与可用性

- 三张卡片在桌面和 390px 视口无横向溢出、遮挡或不可操作控件；
- 选择卡片后编辑器、地图预览、地点/结构列表和下载信息属于同一个世界；
- 候选构建不得显示不存在的公开 release URL；已发布构建不得把 `latest` 重定向当作版本绑定证据；
- 画廊预览与导出素材共享生成真源，不使用手工营销图替代实际世界输出。

### portable pack、Godot 与发布

- 三个 pack 分别通过 manifest、receipt、许可、文件集、大小、digest 和篡改拒绝测试；
- Linux/Windows × Godot 4.3/4.7 对三个 exact pack 全绿，并验证 `created → unchanged`；
- addon 继续以 `addons/mapsoo_importer` 为归档根，README/LICENSE/icon 与摘要受发布门禁保护；
- `pnpm check`、安全审计、真实浏览器导出、视觉验收、release 可重复构建、远端历史核验和 `git diff --check` 全部通过；
- release 经公开 PR 审核，发布后再登记 lifecycle、附件数量、大小和 SHA-256。

## 6. 明确不做

Alpha.7 不实现或承诺：

- 一个世界内部的多 biome 混合、边界过渡或自动地貌融合；
- 建筑内部、门、碰撞、导航、角色、动画、任务、战斗或经济玩法；
- AI 图像 Provider、付费 API、用户账号、云端存储或默认上传内容；
- External Host 专用运行时映射、生产接入或采用证明；
- itch.io 登录、页面创建、上传或公开发布；
- Godot Asset Library 上架或外部采用证明；
- 修改任何已发布 Alpha.1–Alpha.6 tag、fixture、附件或摘要。

## 7. 发布门禁结论

以下停止条件均未触发；它们继续作为 Alpha.7 的历史审计标准：

1. 必须改写 Alpha.1–Alpha.6 历史合同或字节才能容纳三个示例；
2. 画廊、World Spec、预览和下载指向不同世界或不同版本；
3. desert/snow 只换营销截图，没有独立可验证的 portable pack；
4. 三个 pack 任一个不能逐字节复现或不能被 Godot exact-pack 矩阵导入；
5. 为缩短矩阵而只验证 Sunny Meadow，却宣称三世界均受支持；
6. 文档把候选、维护者测试、External Host 计划、延后的 itch.io 页面或未知下载者写成公开采用。
