# Alpha.6 地点关联的建筑外观

状态：已发布里程碑；GitHub prerelease `v0.1.0-alpha.6`，tag commit `315bc1b`。

## 1. 目的与产品边界

Alpha.5 已经为世界提供稳定的语义地点、便携 `runtime/places.json` 和 Godot `Marker2D` 锚点，但地点仍只有抽象图标。Alpha.6 的目标是在不改变已发布 Alpha.1–Alpha.5 任何字节、合同、fixture、tag 或摘要的前提下，为适合的语义地点派生**地点关联、确定性、透明背景的建筑外观素材**，使一个导出包同时具备浏览器可见的世界外观和 Godot 可查询、可渲染的结构节点。

这里的 structure 只表示地图上的建筑外观（exterior structure）。它是 portable 世界美术资产，不是可进入的场景、玩法实体或 External Host 专用对象。地点仍是语义身份真源；结构通过稳定 `placeId` 关联地点，不能另造一套互不相干的世界坐标身份。

## 2. 四种公开原型

Alpha.6 只覆盖四种有界原型：

| archetype | 视觉意图 | 典型地点关联 |
| --- | --- | --- |
| `cottage` | 小型居所外观 | settlement |
| `workshop` | 带工作台或招牌的工坊外观 | settlement / resource |
| `tower` | 瞭望塔或高塔外观 | landmark / encounter |
| `shrine` | 小型神龛或纪念性外观 | landmark |

这些名称是 Alpha.6 的公开资产合同；未来变更必须通过新的显式 world/pack 版本。原型只约束公开资产类别，不暗示商店经济、住宅所有权、敌人、宗教玩法或其他游戏逻辑。

## 3. 最终里程碑范围

Alpha.6 已完成以下纵向闭环，因此可称为地点关联的“建筑外观支持”：

1. **World Spec 0.3 输入**：作者可以在受限合同中为地点声明一个 exterior structure；引用必须指向同一 World Spec 中存在的地点，且一个地点至多拥有一个结构。未知字段、重复关联、不支持的 archetype 和不支持的版本必须 fail closed。没有 structure 声明时不得迁移或猜测出建筑。archetype 与地点种类只是编辑建议，首个合同不强制兼容矩阵。
2. **确定性核心解析**：同一受信 World Spec 必须生成相同结构 ID、`placeId`、archetype、关联地点格坐标、像素中心和声明顺序。结构精确锚定到已解析的地点；无法解析引用时明确拒绝，不得随机漂移或改绑地点。
3. **透明素材 atlas**：四种原型各有明确像素边界、透明背景和最近邻缩放约束；atlas 布局、单元 rect、pivot/foot point、像素尺寸、美术版本与 SHA-256 被版本化 manifest/verifier 绑定。透明区不得以伪透明底色代替，结构不得烧录进 ground/road/water 图层。
4. **便携 runtime sidecar**：导出 engine-neutral `runtime/structures.json`（最终文件名以合并合同为准），逐项保存稳定结构 ID、`placeId`、archetype、格坐标、像素锚点、atlas 引用、绘制排序所需数据和合同/算法版本。sidecar 必须能与 `runtime/places.json` 双向复核：不得悬空、重复占用、越界、顺序错配或引用不存在的 atlas 区域。
5. **浏览器预览**：Workbench 在真实地图预览上按相同解析结果绘制透明建筑外观，并提供结构图层开关与可读列表；列表至少显示结构 ID、关联地点和 archetype。Canvas 与导出 atlas 必须共享像素来源和 pivot 语义，不能用独立占位图掩盖导出错误；桌面与 390px 视口均不得产生阻断性遮挡或横向溢出。
6. **Godot 派生**：受信 importer 从 portable atlas、places sidecar 和 structures sidecar 派生结构容器及 `Sprite2D`；每个节点保留稳定 ID、`placeId`、archetype、格坐标和 atlas 区域等可查询 metadata，并与对应地点 `Marker2D` 建立可验证关联。pivot、层级和绘制顺序必须与浏览器一致；重导入继续遵守 `created / unchanged / updated / conflict` 所有权边界。
7. **发布证据**：真实浏览器 ZIP、逐字节重现、schema/runtime/摘要篡改负向案例、Godot 4.3/4.7 exact-pack 矩阵、视觉检查、release 清单和文档共同证明完整闭环；tag workflow 和 13 个公开附件核验均已成功。
8. **可安装采用入口**：公开 release 提供独立 Godot addon 归档，解压根目录是 `addons/mapsoo_importer`，并包含可启用插件所需文件、插件 README、LICENSE 和 icon；首次使用向导从下载、校验、安装、启用到导入示例 pack 全程可执行。可安装归档和向导只是采用准备，不表示已经上架 Godot Asset Library 或已有外部采用。

## 4. 首个实现切片

第一个切片只交付以下内容：

- World Spec `0.3` schema、TypeScript 类型、严格迁移边界和正/负向校验；
- 四种 archetype 及地点引用的最小公共合同；
- 稳定结构 ID、地点关联、archetype、地点格坐标、像素中心和声明顺序的确定性核心解析；
- 浏览器预览中的程序化结构占位渲染、图层开关和结构列表，用来验证输入、解析与可见关系；
- 固定 seed 快照、解析顺序、越界/悬空/重复关联/非法组合等单元与浏览器门禁。

首个切片曾经只作为“Alpha.6 World Spec 0.3 与核心解析预览”；透明 atlas、portable runtime sidecar、manifest/receipt 绑定、Godot `Sprite2D` 导入和完整 release matrix 后续均已完成并纳入公开 Alpha.6。

## 5. 完整门禁

### 合同与确定性

- World Spec 0.3 schema 与 runtime validator 对合法输入结论一致，严格拒绝未知字段；
- 缺省结构集合不产生隐式建筑；旧 World Spec 的迁移不得凭地点类型自动补结构；
- 非法/重复结构 ID、悬空或重复 `placeId`、非法 archetype、未知字段和超量集合均有拒绝案例；
- 两次相同输入得到完全相同的结构记录、排序、坐标、atlas rect 和导出字节；
- 地点引用、唯一关联、place/structure 声明顺序和无结构迁移边界均有正向与负向测试。

### 素材与 portable pack

- 四种原型均存在透明背景像素资产，尺寸、alpha、颜色、pivot、atlas padding 和最近邻缩放通过自动检查；
- 浏览器预览与导出 atlas 使用相同像素源，不存在只在预览中出现的替代图；
- `runtime/structures.json` 通过独立 schema/runtime 校验，并与 World Spec、`runtime/places.json` 和 atlas 完整交叉验证；
- receipt 绑定包含结构声明的 World Spec；manifest/verifier 绑定结构 sidecar、算法/schema/atlas 版本、每个文件的大小与 SHA-256；
- 被篡改的地点引用、坐标、rect、pivot、顺序、文件大小、digest 或未知文件必须被拒绝；
- 相同真实浏览器输入两次导出的 ZIP 逐字节一致，公开 fixture 文件集和 hash 固定。

### 浏览器与视觉

- 结构在地图正确位置、正确层级绘制，透明边缘无底色方块、裁切、串色或错误缩放；
- 图层开关、结构列表、Canvas 标记和导出内容使用同一组解析结果；
- 桌面与 390px 真实浏览器验收覆盖默认、隐藏图层、四原型可见和无横向溢出；
- 自动截图只能作为证据，不能代替对真实导出 atlas 和 ZIP 的验证。

### Godot 与安全重导入

- Godot 4.3 与 4.7 在 Linux/Windows 导入同一个真实浏览器发布包；
- exact-pack 测试验证 `created → unchanged`、结构数量/顺序、稳定 ID、`placeId`、archetype、坐标、pivot、atlas region、绘制层级和可查询 metadata；
- 每个 `Sprite2D` 能解析到唯一地点 `Marker2D`，无悬空节点或靠节点顺序猜测关联；
- importer 必须复算/复核核心解析结果，不能只检查 sidecar 形状或“坐标看起来可行”；
- 手改托管结构场景或 atlas 后重导入必须 `conflict`，不得覆盖外部 gameplay 脚本、用户场景或 pack 目录之外文件；
- 新版本门禁不得削弱 Alpha.1–Alpha.5 的 importer、fixture 和 exact-pack 回归测试。

### 发布与证据边界

- `pnpm check`、构建、浏览器导出、发布候选、receipt/manifest 负向套件、安全审计和 `git diff --check` 全部通过；
- 发布工作流采用 manifest 推导的文件数和 schema，不得硬编码一个只对本地 fixture 成立的哨兵；
- Alpha.1–Alpha.5 的公开 tag、附件、fixture、合同和 SHA-256 逐项复核且保持不变；
- README、路线图、release notes、示例和截图只陈述已由门禁证明的能力；
- 发布前经过公开 PR 审核；发布后再固定 prerelease lifecycle、远端附件清单和 digest ledger；
- release 包含可独立下载并安装的 Godot addon 归档；归档根为 `addons/mapsoo_importer`，插件 README/LICENSE/icon、文件清单、大小和摘要均被发布校验覆盖；
- 首次使用向导由全新 Godot 项目按公开归档实测，覆盖下载摘要核验、正确解压位置、启用插件、导入示例 pack、预期输出和常见失败恢复；
- 文档只能声称“提供可安装 addon”；在真实 Godot Asset Library 条目可公开核验前，不得声称已提交、已审核、已上架或可从 Asset Library 安装；
- itch.io 上传不是 Alpha.6 gate，延后状态不得被描述为已上传或已公开。

## 6. 明确不做

Alpha.6 不实现或承诺：

- 建筑内部、室内地图、楼层、房间或进出切换；
- 门、门锁、入口交互、传送点或可进入状态；
- 建筑碰撞、物理形状、遮挡多边形或导航网格；
- 自动寻路、道路可达性证明、NPC 行为或交通系统；
- 商店经济、住宅、任务、战斗、资源生产、存档等玩法；
- External Host 专用运行时映射、生产接入、采用证明或私人内容推断；
- AI 图像 Provider、第三方素材来源的笼统许可保证；
- itch.io 登录、页面创建、上传或公开发布；
- Godot Asset Library 上架、审核通过或外部采用证明；
- 稳定版 API、所有 Godot 版本支持或对未来版本字段的兼容承诺。

## 7. 兼容与所有权政策

- Alpha.1–Alpha.5 是不可变历史；Alpha.6 必须使用新的独立 release 配置、schema、fixture、tag 和附件，不能原位修改旧摘要或重建旧 tag。
- `placeId` 是结构与地点之间的兼容关联；结构 ID 是结构自身身份。新 pack 版本可以改变美术或位置，但必须显式推进 artifact/version，不得在同一已发布 pack 中偷偷复用 ID 表示另一建筑。
- portable PNG + JSON 是跨引擎真源；浏览器 Canvas 和 Godot 派生场景不是独立合同源。
- importer 只拥有自己生成并记录的输出；项目作者的 gameplay、场景组织和脚本不属于 Mapsoo 托管范围。

## 8. 停止条件

出现以下任一情况，Alpha.6 不得发布：

1. 必须修改 Alpha.1–Alpha.5 已发布字节、tag、fixture、合同或 digest 才能支持新功能；
2. 结构不能通过稳定 `placeId` 与 Alpha.5 地点端到端绑定，或浏览器、sidecar、atlas 和 Godot 对关联/坐标/pivot 的解释不一致；
3. 只能显示程序化占位图，却没有可验证透明 atlas、runtime sidecar 与 Godot `Sprite2D` 闭环；
4. 相同输入不能逐字节复现，或失败时会静默改绑地点、移动结构或改变 archetype；
5. importer 不能拒绝被篡改 sidecar/atlas，不能复核解析结果，或安全重导入会覆盖用户文件；
6. 四种原型中任一种缺少实际透明素材、完整元数据或跨浏览器/Godot 视觉验证；
7. Linux/Windows × Godot 4.3/4.7 exact-pack 矩阵未通过，或 Alpha.1–Alpha.5 回归不再通过；
8. 文档、截图或发布页需要把未完成切片、External Host 计划或延后的 itch.io 上传包装成已交付能力。
9. release 缺少可从 `addons/mapsoo_importer` 正确解压安装的 addon 归档，归档缺 README/LICENSE/icon，或首次使用向导未在全新 Godot 项目中按公开附件实测。

上述停止条件均已在发布前解除；公开 [Alpha.6 prerelease](https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.6) 及其 13 个附件现为不可变发布证据。任何后续合同变化必须推进新版本，不能改写 Alpha.6 tag、fixture 或摘要。
