# 产品与 MVP 规格

## 1. 一句话定位

Mapsoo WorldForge 是一个面向独立游戏、Game Jam、教育游戏与叙事世界创作者的开源世界素材资产生成器，把世界设定转换为可预览、可验证、可追踪、可导入 Godot 的资产包。

## 2. 首批用户

### Godot 独立开发者

需要快速获得风格一致的地形、道路、建筑和道具，不希望先学习复杂美术管线。

### Game Jam 参与者

在数小时内需要一套许可清楚、尺寸一致、能直接导入的素材，而不是几十张需要手工整理的图片。

### 教育与儿童世界创作者

需要把课程、故事或主题世界快速变成可探索地图，同时控制内容边界和视觉表达。

### External Host 团队

需要从 World Engine 的主题、角色、任务和地点定义生成游戏场景、故事地图与可持续扩展的世界资产。

## 3. 用户任务

用户真正要完成的任务不是“生成一张图”，而是：

> 在较短时间内获得一套风格一致、尺寸正确、许可证清楚、可以继续编辑并能进入游戏引擎的世界素材。

## 4. v0.1 用户流程

1. 选择世界模板：草地、沙漠、雪原中的一个；
2. 填写世界名称和一句描述；
3. 设置 `seed`、Tile 尺寸、地图宽高和调色板；
4. 点击 Generate；
5. 系统生成 tilesheet、地图矩阵、道具 sprites 和封面预览；
6. 用户查看合成地图、图层摘要和资产清单；独立图层显隐切换仍是后续交互；
7. Validation 面板展示错误、警告和通过项；
8. 用户下载一份引擎中立 portable ZIP；Godot importer 从官方仓库独立安装；
9. ZIP 中的 README 解释如何导入和使用。

## 5. v0.1 功能范围

### 必须有

- World Spec 表单与 JSON 预览；
- seed 驱动、可重复的程序化生成；
- 一个有固定回归包的默认 meadow 示例，另有 desert/snow 程序化配色模板；
- 32×32 默认 Tile，可选择 16×16 和 64×64；
- 地形、道路/水域、装饰物至少三类资产；
- 2D Tile 地图预览；
- PNG 与 manifest 导出；
- Godot 导入说明或 importer；
- itch.io 友好的 ZIP 目录；
- 许可证与 generation receipt；
- 本地项目保存/加载（World Spec JSON 下载与严格导入，失败时不覆盖当前世界）；
- 对核心 schema、生成和导出函数的测试。

当前 alpha 的加载边界：单文件最大 128 KiB，只接受严格 UTF-8 JSON；拒绝重复键、危险原型键、过深/过复杂结构、不可安全往返的数字和不符合 schema 的字段。加载成功后立即重建预览，失败或较早的异步读取结果不会修改现有项目。

### 应该有

- 调色板编辑；
- 自动命名和 slug；
- 尺寸、透明度、唯一 ID、缺失文件检查；
- 下载前的摘要；
- 中英文界面基础框架；
- 示例世界作为回归测试夹具。

### v0.1 不做

- 不做完整账户、社区、商城和订阅系统；
- 不承诺生产级角色动画生成；
- 不做 3D 模型；
- 不做实时多人协作；
- 不把任何一个云端 AI 服务写死为唯一方案；
- 不直接代替 itch.io 上传或定价；
- 不保证所有第三方模型输出都可商业使用。

## 6. 默认输出内容

- 1 个地形 tilesheet；
- 1 个装饰物 spritesheet；
- 1 个地图数据文件；
- 1 张 cover/preview；
- 1 个 `mapsoo.manifest.json`；
- 1 个 `generation-receipt.json`；
- `readme.md`、`license-assets.md`；
- manifest 中声明的 Godot importer 版本与官方来源；importer 和示例项目不进入素材 ZIP。

## 7. 核心验收场景

### A. 可重复性

给定同一份 spec 和 seed，两次生成的地图矩阵与文件命名相同。程序化 PNG 的内容 hash 应保持一致；若浏览器实现导致字节编码差异，至少像素数据 hash 必须一致。

### B. 离线闭环

关闭网络后，内置模板仍可以生成、预览、检查与导出。

### C. Godot 可用性

按导出包 README 操作，新建 Godot 4 项目可以看到 tilesheet 和示例地图，像素采样设置正确，无平滑模糊和 Tile 错位。

### D. 发布完整性

ZIP 解压后不存在缺失的 manifest 引用；包含版本、许可、预览和使用说明；目录名不依赖中文或系统特有路径。

### E. 错误可解释

当 Tile 尺寸不匹配、名字无效或文件缺失时，用户看到具体修复方法，不只是“导出失败”。

## 8. 产品指标

v0.1 不追求注册量，优先测量：

- 从打开页面到首次成功导出的时间；
- 导出包在 Godot 中首次成功导入率；
- 每个包的 validation 错误数；
- 示例 spec 的确定性测试通过率；
- 外部开发者能否不求助完成一次导入；
- issue 中“资产不可用”与“文档不清楚”的比例。

## 9. Reference World Job Alpha.9（已发布）

[`v0.1.0-alpha.9`](https://github.com/babyrush0101-source/mapsoo-kids/releases/tag/v0.1.0-alpha.9) 已公开发布：创作者提供一张环境参考图、一张角色参考图和一段短描述，由离线程序化 Provider 通过参考摘要与 seed 派生 palette/视觉变体，生成一份完整的 `topdown-farm` 世界美术资产包。它不执行模型级图像理解，也不表示复制原图、品牌、角色或构图。

产品最终覆盖四个中立 asset profile：`side-platformer`、`isometric-action`、`topdown-farm` 与 `layered-depth-2d`。每个 profile 都有独立投影、atlas、动画、排序和 Godot 合同；首个纵向切片只覆盖 `topdown-farm`，不得据此声称另外三个 profile 已实现。

`topdown-farm` 的完整结果不是单张合成图。发布包同时具备地形、水域、道路/田埂与围栏、作物阶段、建筑、道具、分层地图、可行走/阻挡数据、四方向角色 `idle/walk`、preview、严格 sidecar、manifest、receipt、许可与使用说明。下载前由版本化 completeness matrix 逐类证明文件、像素、动画、引用、摘要和权利信息完整；任何 error 阻止导出。

参考图在本地执行字节、媒体签名、尺寸、预算和权利验证，不进入示例、ZIP、截图或公开日志；这不是人脸、OCR、商标或其他内容级净化。Alpha.9 只接受用户拥有且明确允许衍生、输出再分发和 CC0 dedication 的环境图与角色图，licensed 参考输入拒绝导出。公开发布不表示外部团队已经采用、External Host 已生产接入或 itch.io 已上架。详细范围见 [`19_ALPHA9_REFERENCE_TO_FARM_WORLD.md`](19_ALPHA9_REFERENCE_TO_FARM_WORLD.md)。
