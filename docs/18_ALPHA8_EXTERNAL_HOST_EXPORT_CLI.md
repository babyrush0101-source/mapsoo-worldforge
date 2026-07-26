# Alpha.8 External Host 可复现素材包导出 CLI

状态：已作为 [`v0.1.0-alpha.8`](https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.8) 公开预发布；输出沿用已发布 Alpha.7 的 Pack Schema 0.5 / World Spec 0.3 合同，不创建或改写 Alpha.7 官方 release 附件。

## 1. 目的

Workbench 已能在本地载入严格的 `ExternalHostAssetRequest 1.0`，但 External Host 的构建流水线仍缺少无 UI、可重复执行的导出入口。这个切片提供一个 loopback-only 的 headless Chrome CLI，把脱敏请求转换为可由 Godot importer 直接读取的 executable-free ZIP，并同时生成机器可读的请求到素材包回执。

这是真正的程序化桥接能力，但不是 External Host 生产采用证明。当前 External Host 仓库只有营销文档，没有可接入的运行时代码；因此本阶段只交付公开、可执行、可验证的生产边界。

## 2. 命令

```bash
pnpm external-host:export -- \
  --input examples/integrations/external-host/river-valley-asset-request.json \
  --out-dir ./external-host-output \
  --completed-at 2026-07-19T12:00:00.000Z
```

运行要求：Node.js 20+、项目依赖、Chrome/Chromium。`--completed-at` 必须是规范 UTC ISO 时间；它是生成证据的一部分，显式固定后，同一请求才能逐字节复现。

输出：

```text
external-host-output/
  mapsoo-river-valley-observation-v0.1.0-alpha.7.zip
  mapsoo-river-valley-observation-external-host-export-receipt.json
```

stdout 只输出一行 JSON 摘要，`status` 为 `created` 或 `unchanged`。两个目标均不存在时使用同目录临时文件和排他 hard-link 发布，任何目标竞争都会 fail closed 并回滚本进程已创建的目标；两个文件均与预期逐字节相同时不写盘；只存在一个、类型异常、符号链接或任一字节不同都返回 conflict，首版不提供覆盖开关。这里承诺的是正常进程内的冲突保护，不宣称断电级双文件事务原子性。

## 3. 数据流与不变量

```text
public-safe ExternalHostAssetRequest 1.0 JSON
  → strict JSON parser（128 KiB / UTF-8 / duplicate key / unsafe key / depth / complexity）
  → canonical request SHA-256 + allowlist projection
  → lossless World Spec 0.2 → 0.3 migration
  → local procedural provider + frozen evidence
  → Alpha.7 browser exporter
  → ZIP reopen + CRC / root / file / manifest / receipt / binding verification
  → exclusive, no-clobber ZIP + external export receipt publication
```

升级不会推断地点或建筑。请求中的 `packId`、External Host world/scene 标识、公共标签、content rating 与 canonical request hash 原样保存在 `org.mapsoo.externalhost.assetrequest.v1` extension；extension 会进入公开 ZIP，因此它不是隐私沙箱。

外部回执使用 [`org.mapsoo.externalhost.mapsoo-export-receipt/1.0.0`](../integrations/external-host/external-host-mapsoo-export-receipt.schema.json)，绑定：

- request schema、pack ID、canonical request SHA-256、External Host world version 与 scene ID；
- World Spec 0.3 的 pack 内路径与 SHA-256；
- local procedural provider ID/version/provenance；
- Pack Schema 0.5、文件名、字节数、整体 ZIP SHA-256；
- manifest 和内置 generation receipt SHA-256；
- 显式完成时间与 CLI 工具版本。

回执不记录绝对路径、儿童数据、家庭数据、prompt、API key、私有 URL 或运行时 created/unchanged 状态，因此独立目录中的重复导出保持逐字节一致。

## 4. 验收门禁

- [x] 请求键顺序不影响 canonical hash；未知字段和重复键 fail closed；
- [x] `0.2 → 0.3` 迁移保留 request binding 且不发明 places/structures；
- [x] 同一 request + `completed-at` 两次 ZIP 与回执逐字节一致；
- [x] 同目录重复运行是真正不写盘的 `unchanged`；冲突保留已有文件；
- [x] 双进程竞争只允许完整创建一对输出，另一进程只能 `unchanged` 或 fail-closed conflict；
- [x] 导出后重新打开 ZIP，验证 CRC、单根、18 文件、17 条 manifest record、逐文件 digest、World Spec extension 和 generation receipt；
- [x] 回执通过严格 JSON Schema 正反例验证，不包含本地绝对路径，并绑定 ZIP、manifest、World Spec 与 generation receipt；
- [x] CLI 验证加入真实 Chrome gate；
- [x] Linux/Windows × Godot 4.3/4.7 对 CLI 生成包完成 `created → unchanged → conflict preserved` 的公开 CI；
- [ ] 在 External Host 出现实际消费仓库后，加入不含私密数据的消费者 contract test；在此之前不声明 production adoption。

## 5. 明确不做

- 不把 arbitrary External Host 导出登记为三个官方 Alpha.7 示例附件；
- 不上传请求、素材或回执，不调用云端/付费 Provider；
- 不从 `requiredSceneTags` 猜测地点、道路、任务、角色或学习目标；
- 不处理儿童身份、聊天、成长记录、家长资料、内容安全或商业密钥；
- 不生成印刷版式、角色动画、内部场景或 External Host 私有运行时 sidecar；
- itch.io 登录和上传继续搁置。

下一技术阶段在这个自动化消费入口稳定后，再单独设计通用语义道路/世界连接合同，避免把 CLI 与新地图 schema 两个风险轴混在同一发布切片。
