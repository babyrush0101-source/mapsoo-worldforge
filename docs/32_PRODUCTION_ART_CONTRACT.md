# 生产美术任务契约 1.0

当前四类世界的确定性 provider 已经能生成可运行、可测试的工程占位图。生产美术层不替换这条可复现基线，而是在它前面增加一个可插拔的“源图任务 → 严格验收 → 确定性后处理”边界。

## 边界

`src/core/production-art-contract.ts` 不连接任何特定图像 API，也不读取 API key。它只负责：

1. 根据 `side-platformer`、`topdown-farm`、`isometric-action` 或 `layered-depth-2d` 生成生产美术计划；
2. 把可见资产角色分配给有固定画布、单元格、alpha、接缝和 pivot 的任务；
3. 校验生成器交回的 PNG 记录；
4. 在导入、裁切、缩放和组 atlas 之前拒绝不完整或越权的结果。

碰撞、导航和 `world.scene` 不是图像任务。它们继续由 Mapsoo 的确定性世界管线生成。生产美术只覆盖 `world.preview`、地形、物件/建筑/危险物、角色、背景/前景/灯光以及特效。

## 六种任务

| `kind` | 用途 | 关键验收 |
| --- | --- | --- |
| `scene-direction` | 一张世界视觉方向样图 | 固定画布，不进入运行时 atlas |
| `opaque-tile-sheet` | 地形与可拼接 tile 源表（历史任务名） | straight alpha、固定网格、逐格接缝检查；实体格可不透明，斜坡/平台外部必须透明 |
| `transparent-prop-sheet` | 物件、建筑、作物、危险物、收集物 | straight alpha、逐格透明留白、底部 pivot |
| `character-animation-sheet` | 玩家、NPC、敌人动作源表 | 环境与角色参考同时绑定、固定帧格和脚底 pivot |
| `background-layer` | 远景、近景、前景、灯光平面 | 固定 1920×1080，横向 parallax 接缝策略；仅天空不透明，其余层使用 straight alpha |
| `effect-sheet` | 攻击、交互、环境等特效 | straight alpha、逐格透明留白、中心 pivot |

图像模型不必直接生成最终 32×32 运行时像素。契约允许先生成较高分辨率的生产源表，之后由确定性工具裁切、去底色、修 alpha、nearest-neighbor 缩放并写入既有 Pack 角色。每个角色在计划中只能出现一次，所有单元格必须在目标网格内且不能重叠。

角色任务不再把整张源表当成一个没有语义的矩形。每个
`character-animation-sheet` 必须同时提供 canonical `pose_mappings`，逐格声明：

- 绑定的角色 role；
- `action` 和 `direction`；
- clip 内 `frame_index` 与 `duration_ms`；
- 唯一的 `{column,row}` 源格。

四档当前独立源姿势清单为：

| 档位 | 角色 | 声明源姿势 |
| --- | --- | ---: |
| `side-platformer` | player | 28 |
| `topdown-farm` | player | 24 |
| `isometric-action` | player / melee / ranged | 96 / 80 / 80 |
| `layered-depth-2d` | player / NPC | 32 / 16 |

格子布局是确定性的：同一 action 连续排列，方向顺序固定，多个 animation
frame 使用独立格。未声明格必须完全透明；已声明格必须非空并留出透明边界。
契约和 JSON Schema 会拒绝缺帧、重复格、错误方向、错误时长或被修改的
canonical 布局。自动校验只能证明格子和像素库存，动作含义、身份一致性以及
“是否真的为独立绘制而非复制位移”仍需视觉/人工审核。

## 输出验收

每张生产源图必须提交一个 `production-art-output`：

- `plan_id`、`profile`、`task_id` 必须精确回指已批准计划；
- `path` 必须是计划声明的 lowercase 安全相对 PNG 路径，禁止绝对路径、反斜杠和 `..`；
- 必须提供实际字节数、64 位小写 SHA-256、精确宽高；
- alpha、pivot 和有序角色列表必须与任务一致；
- 必须列出 1–8 个安全的本地参考 ID，但不能放原始本地路径；
- `rights.distribution` 与 `rights.license` 必须与计划完全一致。

公开输出允许 `CC0-1.0`、`CC-BY-4.0` 或 `CC-BY-SA-4.0`，署名型许可必须提供 attribution。`LicenseRef-Proprietary` 只允许 `private` 或 `internal-review` 输出，从而让尚未完成人工审核的候选美术、私有 External Host 角色与公开 OSS 示例包走不同许可通道，避免再次强制把未批准或私有资产标成 CC0。

## Provider 接入顺序

```text
四轮确认后的世界简报
  → createProductionArtPlan(...)
  → 任意本地/远程图像 provider
  → production-art-output + PNG
  → JSON Schema + 语义验证
  → 确定性裁切/alpha/缩放/atlas 后处理
  → 既有四档 Pack 完整性检查
  → Godot 导入与可进入地图
```

Provider 可以是内置图像工具、本地模型、人工绘制或未来的远程服务。只要返回同一契约，后面的 Godot、树莓派和许可流程不需要知道它来自哪一家服务。

## 当前状态

本契约已经覆盖四类世界、全部可见必需角色和 canonical 角色姿势库存，并有
TypeScript 与 JSON Schema 双重验证。它建立的是生产美术“接入与拒绝错误
输出”的边界；还不表示现有占位图已经自动变成最终美术，也不替代逐张视觉
QA。

## Layered-depth Pack 1.0 character projection

`src/adapters/project-layered-depth-production-character.ts` is the first
runtime projection of this contract. It consumes only a normalized,
hash/evidence-bound layered-depth player or NPC sheet and produces the exact
Pack 1.0 character shape:

- `48 × 72` runtime frames and pivot `24,67`;
- 32 player poses / 16 clips, or 16 NPC poses / 8 clips;
- two unique frame coordinates per canonical action-direction clip;
- `independent-generated-pose` provenance on every projected frame;
- an immutable PNG snapshot, Pack file record, role binding, atlas record,
  character record and machine-readable projection record.

Endpoint-aligned nearest-neighbor sampling maps source pivot `64,180` to runtime
pivot `24,67`. The projector checks transparent borders, grounded foot position,
distinct frame bytes and horizontal mirror copies before an atlas can enter a
Pack 1.0 candidate. Its record remains `human_review: required`; these pixel
checks cannot prove action meaning, identity fidelity or aesthetic quality.

## Layered-depth Pack 1.0 plane projection

`src/adapters/project-layered-depth-production-layers.ts` converts the eight
canonical normalized background, overlay and lighting tasks into `640 × 360`
Pack 1.0 runtime files. It requires the approved scene-direction hash and the
reserved `approved-scene-direction` binding on every downstream layer, verifies
the normalized output/evidence digest pair, preserves opaque-vs-straight-alpha
policy, zeroes transparent RGB through the normalization contract and emits
canonical plane, role-binding and file records.

This projection proves exact inventory, dimensions, alpha structure and
direction binding. It deliberately records `seam_review: required` and
`human_review: required`; pixel checks do not prove a visually seamless
parallax loop, coherent composition or final art quality.

## Layered-depth Pack 1.0 environment atlas projection

`src/adapters/project-layered-depth-production-atlases.ts` converts the exact
canonical `terrain-sheet`, `prop-sheet` and `effect-sheet` results into five
Pack 1.0 runtime atlases:

- terrain: six roles in `64 × 128` pivot-baked cells;
- props: six roles in `96 × 176` pivot-baked cells;
- structures: four roles in `96 × 176` pivot-baked cells;
- collectibles: two roles in `96 × 176` pivot-baked cells;
- effects: four roles in `64 × 64` centered cells.

Every result must be bound to the approved scene direction. The projector
revalidates normalized output/evidence hashes, rejects pixels in undeclared
source cells, rejects empty or exact-duplicate role cells, requires zero RGB
under transparent pixels and binary alpha, and requires transparent source
borders for every non-terrain role. It emits immutable PNGs plus canonical
Pack atlas, role-region, file and machine-readable projection records.

Pack 1.0 `Sprite2D` placements use the center of an atlas region as their world
anchor. The projector therefore preserves every source pixel and pads each
runtime cell so the declared terrain, prop or effect pivot lands exactly at the
runtime cell center. Terrain cells may touch their source boundary because they
require a separate tile-seam review. Both `seam_review` and `human_review`
remain `required`; technical projection does not prove tileability, role
meaning, composition or aesthetic quality.

## Complete Pack 1.0 internal-review assembly

Before any profile-specific projector mutates a review pack,
`materializeProductionArtRunSet` and
`materializeProductionArtRunInventory` now provide the shared four-profile
ingress boundary. They require every canonical task exactly once, prohibit
directory aliasing and absolute/URL paths, decode both frozen PNGs, re-hash
source and normalized bytes, validate every output/evidence document, and bind
provider, model, rights, role order, dimensions, alpha policy and request IDs.
The same inventory contract accepts `topdown-farm`, `side-platformer`,
`isometric-action`, and `layered-depth-2d`; only the final runtime projection
and pack merge remain profile-specific.

`src/adapters/build-pack10-production-review-candidate.ts` is the final
source-free merge boundary for this first profile. It starts from one complete,
validated data-only Pack 1.0 base world and replaces:

- all eight background, overlay and lighting planes;
- all five gameplay environment atlases and 22 role regions;
- both character atlases and their complete clip records.

The builder rechecks decoded PNG dimensions, alpha, transparent RGB, metadata
chunks, pivot padding, role regions, duplicate environment cells, character
frames, every file digest, projection schema and all 14 generation-evidence
bindings. Original model responses, normalized working sheets, evidence JSON,
raw prompts, reference images and local paths stay outside the ZIP.

The result is always `internal-review`, `LicenseRef-UNRELEASED`,
non-redistributable and non-commercial. Human-art, rights, Godot runtime and
Raspberry Pi gates are reset to `pending`; assembling a complete visible asset
inventory does not approve or publish it.
