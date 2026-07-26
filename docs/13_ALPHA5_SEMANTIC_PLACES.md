# Alpha.5 语义地点与运行时锚点

## 1. 目的与边界

Alpha.4 已经交付可编辑的 Ground / Water / Roads / Props 地形包，但任务、存档或上层世界系统仍只能猜测坐标含义。Alpha.5 的目标是在不改变已发布 Alpha.1–Alpha.4 字节和合同的前提下，为一个 pack 提供**稳定、可验证、引擎中立的语义地点**，并由 Godot importer 派生可供后续运行时代码查找的锚点。

本里程碑是 Mapsoo 自身的开放资产合同，不是 External Host 专用功能。External Host 只是计划中的消费场景；本文件不表示 External Host 已接入、已采用或已有外部用户。

## 2. 范围

Alpha.5 已完成以下纵向闭环：

1. **版本化输入合同**：新的 World Spec 候选合同允许作者显式声明 1–8 个地点；每个地点具有 pack 内唯一、路径安全且稳定的 ID、可读 label、受限 `kind`、受限 `placement` 规则和有界公共标签。`places` 缺省表示作者没有声明语义地点，迁移旧 World Spec 时不得凭空补地点。未知字段、重复 ID、非法枚举/标签和不支持的合同版本必须 fail closed。
2. **确定性生成**：同一受信 World Spec、Provider 版本和 seed 按 `placement` 规则产生相同地点锚点、坐标与顺序；无法满足约束时必须明确拒绝，不能静默随机降级。生成器不能从私人用户数据推断地点，也不能把普通 prop 自动宣称为任务或安全语义。
3. **便携导出**：receipt 绑定包含地点声明的 World Spec；manifest 与 Alpha.5 verifier 绑定派生的 engine-neutral `runtime/places.json`、算法版本、schema、atlas、逐文件大小和 SHA-256；旧发布 fixture、tag、hash 和 schema 不原位修改。
4. **Godot 派生**：受信 importer 从便携合同生成稳定、可查询的节点或 sidecar，保留地点 ID、类型、标签和坐标；重新导入遵守现有 `created / unchanged / updated / conflict` 所有权边界。
5. **兼容与消费示例**：提供最小 Godot fixture，证明调用方按语义 ID 查找地点，而不是依赖随机坐标、节点顺序或 atlas 索引。删除或改变既有 ID 必须成为显式兼容性决定，不能静默复用。
6. **可审核证据**：TypeScript/schema 正向与负向测试、真实浏览器 ZIP、Godot 4.3/4.7 smoke、跨平台 CI、候选 release 文件清单和文档共同覆盖该闭环。

地点合同的最终字段名和版本号以实现 PR 中通过测试的 schema 为准。规划文档不提前把未合并的字段草案声明为公共 API。

### 候选输入与派生边界

本分支审计采用以下最小候选形状，仍须以合并后的 schema 为准：

| 字段 | 候选约束 | 含义 |
| --- | --- | --- |
| `id` | 1–64 位小写字母、数字、单连字符 slug；world 内唯一 | 稳定身份，不是显示名称 |
| `label` | 1–80 位、去除首尾空白、无控制字符 | 面向编辑器/用户的文本 |
| `kind` | `spawn / settlement / landmark / resource / encounter / exit` | 有界公共分类，不代表完整玩法 |
| `placement` | `center / near-water / on-road / map-edge` | 确定性解析约束，不是作者硬编码坐标 |
| `tags` | 最多 8 个唯一 slug，每个 1–32 位 | 轻量公开分类，不得承载私人数据 |

派生记录应保留声明顺序、`id/label/kind/placement/tags`，并增加离散 `cell` 与像素中心坐标。不同地点必须占用不同的可行走格；没有任何未占用格满足规则时，生成应返回可复现错误，而不是移动到任意格子。作者身份保存在 `id` 中，派生坐标只是当前 world/pack version 的布局结果。

## 3. 验收标准

Alpha.5 只有在以下证据同时成立时才可标为已完成或发布：

- 独立的 published release 配置选择新的 schema、fixture、receipt/export policy 与文件清单，Alpha.1–Alpha.4 的公开摘要保持不变；
- 合法地点可通过 schema 与运行时语义校验，空/超量集合、重复或非法 ID、非法 kind/placement/标签、派生越界坐标、声明与导出顺序错配、悬空引用、未知字段和篡改摘要各有对应拒绝案例；
- 两次相同输入的真实浏览器导出逐字节一致，manifest/receipt 对地点真源的绑定可复核；
- Godot 4.3 与 4.7 在 Linux/Windows release matrix 中导入同一个候选包，并验证 `created → unchanged`、地点数量、稳定 ID、坐标和可查询元数据；
- 安全重导入测试证明手改托管输出会 `conflict`，不会覆盖外部 gameplay 脚本或 pack 目录外文件；
- README、路线图、release notes 和示例只声称实际通过上述门禁的能力；
- 发布前完成公开 PR 审核；发布后才固定 tag、附件 digest 与 lifecycle，且不能重建同一已发布 tag。

## 4. 明确不做

Alpha.5 不承诺：

- 完整任务、对话、存档、NPC、战斗或游戏玩法系统；
- 自动寻路、导航网格、道路连通性证明或生产级碰撞；
- 建筑内部、传送、跨 pack 世界图或无缝流送；
- 根据儿童数据、私人 External Host 内容或未声明模型推断地点语义；
- External Host 生产接入、外部采用、社区用户数量或 itch.io 页面已发布；
- 稳定版 API、对所有 Godot 版本的支持或 SLA；
- AI 图像 Provider、模型输出许可的笼统保证或自动上传第三方平台。

## 5. 兼容政策

- 地点 ID 是调用方可持久化引用的兼容面；同一已发布 pack/version 内不得改变含义或复用。
- 坐标和美术可以在新的 world/pack 版本中变更，但必须通过新 artifact 与显式版本推进；上层系统应引用语义 ID，而不是把坐标当身份。
- additive 变更仍须经过 schema/version 决策；严格 schema 下“仅新增字段”也不自动兼容。
- importer 的派生输出不是跨引擎真源，portable JSON 才是重建与审计依据。

## 6. 停止条件

若地点语义无法被 portable 文件、manifest/receipt 与 Godot 输出端到端绑定，或需要改写 Alpha.1–Alpha.4 的已发布字节，本里程碑不得发布。若只能生成视觉标记而没有稳定 ID 与消费验证，应继续作为开发分支实验，不得称为“语义地点支持”。
