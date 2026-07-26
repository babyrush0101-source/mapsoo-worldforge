# Alpha9 community test campaign / Alpha9 社区测试计划

This campaign exists to find real Godot users and improve the importer. It is not a star exchange, paid-star campaign, or evidence-manufacturing exercise. Stars are never required. Only independently submitted, reproducible results count as external feedback.

本计划用于找到真正的 Godot 用户并改进导入体验，不用于互赞、买 Star 或制造采用证据。测试者不需要 Star；只有独立用户亲自提交、可以复核的结果才计入外部反馈。

## Acceptance target / 验收目标

- invite 10 relevant Godot users individually;
- obtain at least 5 real Alpha9 downloads or attempted imports;
- obtain 2–3 independently authored GitHub feedback issues;
- respond to every report within 48 hours;
- record stars only as an observed repository metric, never as compensation or a condition.

目标漏斗：定向邀请 10 位 Godot 开发者，获得至少 5 次真实下载或导入尝试、2–3 个由独立用户亲自提交的 GitHub 反馈，并在 48 小时内响应。Star 只记录自然结果，不交换、不购买，也不作为测试条件。

## One task for every tester / 统一测试任务

1. Follow the [10-minute Alpha9 Godot import guide](10_FIRST_GODOT_IMPORT.md).
2. Import the complete `topdown-farm` Pack 0.6 with Godot 4.3 or newer.
3. Repeat the import and note whether it reports `created → unchanged`.
4. Open the generated scene.
5. Submit either success or failure through the [first-import form](https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml).

The maintainer must not submit an issue on a tester's behalf. If a tester cannot use GitHub, their message may inform product work but must not be counted as a public external issue.

## Direct invitation / 一对一邀请

```text
Hi — I maintain Mapsoo Worldsmith, an open-source 2D world-asset pack generator and Godot importer.

Alpha9 now has one narrow, testable path: a complete top-down farm Pack 0.6 that imports into Godot 4.3+. Would you be willing to spend about 10 minutes trying one import and reporting either success or failure?

Guide: https://github.com/babyrush0101-source/mapsoo-kids/blob/main/docs/10_FIRST_GODOT_IMPORT.md
Release: https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.9
Feedback form: https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml

No star is required. Please star only if you genuinely want to follow the project. Do not share private project content or unlicensed assets.
```

中文版本：

```text
你好，我正在维护开源项目 Mapsoo Worldsmith：一个面向 Godot 的 2D 世界素材包生成器和导入器。

Alpha9 目前只有一条明确可测的路径：把完整 top-down farm Pack 0.6 导入 Godot 4.3+。你愿意花约 10 分钟测试一次，并把成功或失败结果提交到 GitHub 吗？

指南：https://github.com/babyrush0101-source/mapsoo-kids/blob/main/docs/10_FIRST_GODOT_IMPORT.md
Release：https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.9
反馈表：https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml

不要求点 Star；只有你确实想继续关注项目时再 Star。请勿上传私有项目内容或无权公开的素材。
```

## Godot Forum draft / Godot 论坛草稿

Suggested category: **Resources → Assets**. Verify the forum's current rules before posting.

```text
Title: Open-source complete top-down farm asset pack + Godot 4.3 importer — Alpha testers wanted

I have released Alpha9 of Mapsoo Worldsmith, a local-first open-source workflow for producing validated 2D world-asset packs for Godot.

The current release is intentionally narrow: it supports only one complete `topdown-farm` Pack 0.6 profile. The public pack contains terrain, water, paths/fences, soil/crops, structures, props, scene/collision/navigation/spawn data, and a four-direction idle/walk character preview. The asset pack itself contains no executable scripts; the MIT importer is installed separately.

Release CI imported the exact published pack on Linux and Windows with Godot 4.3 and 4.7. I am now looking for independent first-import reports, including failures and confusing instructions.

10-minute guide: https://github.com/babyrush0101-source/mapsoo-kids/blob/main/docs/10_FIRST_GODOT_IMPORT.md
Alpha9 release: https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.9
Feedback form: https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml

No star is required. Current limitations: no side-platformer, isometric-action, or layered-depth-2d profile yet; no model-based image understanding; no itch.io publication; no claim of external adoption or production use.

Which next profile would be most useful for your real project, and what failed or felt slow during the import?
```

## Response protocol / 维护响应

For every independent report:

1. thank the tester without asking for a star;
2. reproduce the exact environment when possible;
3. label the issue as success, bug, documentation, or feature request;
4. link the fix or explain the confirmed limitation;
5. ask the tester to verify only when a concrete fix exists;
6. link the result from [issue #12](https://github.com/babyrush0101-source/mapsoo-kids/issues/12).

Do not count repository-owner tests, CI downloads, release audits, bots, duplicate accounts, private External Host work, or unverifiable direct messages as independent adoption.

## Evidence ledger / 证据台账

Record public evidence only after it exists:

| Date | Public report | Tester relationship | OS / Godot | Outcome | Maintainer response | Fix or follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | No independent result yet | — | — |

Replace the empty row only with a public GitHub issue authored by an independent tester. Repository stars and release download counts may be recorded separately with an observation date, but neither proves successful use.
