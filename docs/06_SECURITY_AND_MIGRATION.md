# 安全与迁移审计

## 1. 审计范围

本文件记录从旧 `mapsoo-kids`/`baseul kids` 网站迁移到 Mapsoo Worldsmith 时发现的安全、隐私、依赖和仓库卫生问题。

## 2. 已发现问题

### S-001 客户端硬编码管理员凭证 — High

旧 `src/components/admin/admin-context.tsx` 在浏览器代码中直接比较固定用户名和密码。任何访问生产 bundle 或源码的人都能读取它，这不构成认证。

处理：

- 工作树已移除固定值；
- 旧管理员界面与认证逻辑没有迁移；
- v0.1 新工作台没有管理员功能，也不使用任何管理员环境变量。

用户动作：如果旧密码在其他账号或系统中复用，立即更换。Git 历史中的值已经公开，不能通过后续删除恢复保密性。

### S-002 Supabase 项目标识和 anon key 写入源码 — Medium

Supabase anon key 本来会暴露在客户端，但公开仓库不应把特定部署项目写死，而且安全性完全依赖 Row Level Security。

处理：Supabase 客户端及其配置已从新工作树移除，portable alpha 不需要 Supabase 或任何环境变量。仓库提供不含秘密的 `.env.example`，用于说明未来 provider 的 key 处理边界。如果旧 Supabase 部署仍在运行，仍需在 Dashboard 检查 RLS、OAuth redirect、数据表权限并决定是否废弃项目。

### S-003 服务端环境变量使用 — Review

旧 Edge function 未迁移到新工作树。若旧部署仍在运行，必须确认 `SUPABASE_SERVICE_ROLE_KEY` 从未进入 Git 历史、日志、客户端环境或导出包。

### S-004 旧管理员登录状态仅保存在 localStorage — High if deployed

`baseul_admin_auth=true` 可以被任意用户修改。旧管理界面只能作为 UI demo，不能控制真实写操作或敏感数据。

### S-005 AppleDouble `._*` 文件 — Repository hygiene

仓库中存在大量 macOS AppleDouble 元数据副本，包括源码和图片的 `._*` 文件。它们增加对象数量、干扰搜索和贡献体验。

处理：当前工作树中的副本已删除，`.gitignore` 已忽略 `._*`。旧对象仍可能存在于 Git 历史；历史重写会影响所有 clone，只有在仓库体积继续妨碍贡献时才单独决策。

### S-006 依赖版本使用 `*` — Supply-chain risk

部分依赖没有锁定语义范围。虽然 lockfile 暂时固定安装结果，后续更新可能引入意外破坏。

处理：新工作树已移除旧依赖，声明明确的版本范围并提交 pnpm lockfile；Dependabot 每周检查根应用、`/video` 与 GitHub Actions；CI 和 release workflow 执行 `pnpm security:audit`，两份 lockfile 中未处理的 high/critical advisory 会阻止候选构建。

### S-007 旧外部图片与 Figma bundle 许可 — License risk

旧 UI 使用多张 Unsplash 图片、Figma 生成内容和 shadcn/ui 组件。源码 MIT 不会自动授予这些图片或设计资产的再分发权。

处理：新工作台不复用旧营销图片；公共示例使用自生成 CC0 资产。`public/THIRD_PARTY_NOTICES.txt` 现在由锁定的 18 个生产依赖许可文本生成，`pnpm third-party:verify` 会在依赖、声明许可或 notice 内容漂移时失败。

### S-008 Vite 开发服务器 advisory — High

锁定的 Vite 6.3.5 命中已公开的开发服务器安全 advisory。处理：升级并锁定 Vite 6.4.3，更新 lockfile；根应用 audit 当前返回无已知漏洞，历史 alpha.1 视频 lockfile 仍报告 1 个 low advisory，但两者都没有 high/critical。`pnpm security:audit` 会同时检查两份 lockfile，且已成为 CI 与 release workflow 的独立门禁。该结果不替代后续依赖更新评审。

## 3. 发布前安全门

### 新 World Spec 导入边界

- 浏览器只读取最大 128 KiB 的本地 JSON，不上传文件；
- 使用严格 UTF-8 解码，并拒绝重复键、危险原型键、非有限数、非安全整数、过深或过复杂结构；
- 核心字段按严格 schema 校验，生态数据只能进入 reverse-DNS `extensions`；
- 不使用 `eval`、动态脚本或对象 merge 解释导入数据；失败和被新请求取代的异步读取不会覆盖当前世界；
- 导出 README 对用户标题执行 Markdown/HTML 转义，原始 World Spec 本身不被静默修改。

- [x] 2026-07-26 使用 `pnpm security:history` 扫描所有可达 Git 文本 blob；扫描器不打印候选值。旧认证组件的唯一 `password-assignment` 命中已脱敏复核为英、法、德三种界面中的“密码”字段翻译，而非凭证；扫描器只按完整 blob SHA、路径和规则精确登记这一条历史误报，其他命中仍会阻断；
- [x] 当前可达历史未发现需要轮换的已提交凭证；这不替代对仓库外服务凭证和 GitHub secret 的独立盘点；
- [x] 当前 Worldsmith 不包含客户端管理员功能，也不控制远端真实数据；
- [ ] 检查 Supabase RLS 和 OAuth redirect；
- [x] `.env*` 默认忽略，仅提交不含秘密的 `.env.example`；
- [ ] 对所有 ZIP payload 执行通用 secret/环境值内容扫描；当前只覆盖路径规范、危险引用、receipt URL 凭证规则和严格字段白名单；
- [ ] AI provider API Key 只经服务端代理或用户本地会话使用；
- [ ] 日志不记录 prompt 中的个人信息或 key；
- [x] `pnpm security:audit` 同时检查应用与历史视频 lockfile，并在 CI/release 阶段阻止 high/critical advisory；根应用无已知项，视频构建工具仍记录 1 个 low；
- [x] 生产依赖许可证清单覆盖当前 24 个锁定包，`pnpm third-party:verify` 已纳入 `pnpm check`；
- [x] SECURITY.md 给出私下报告方式。

## 4. 重建策略

1. 不迁移旧登录、社区、CMS、博客、营销页面与图片；
2. Git 历史就是旧站档案，不在新工作树保留 legacy 副本；
3. 只保留 React、TypeScript、Vite 这类通用工具链；
4. 新 `src/` 从 World Spec、generator、validator 和 workbench 开始；
5. 图片历史瘦身只有在克隆体积继续影响贡献者时再处理；
6. 新应用从第一天建立 build、typecheck 和 test，不继承旧站验证债务。
