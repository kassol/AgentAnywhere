# R5 User Story 实现覆盖

映射基线：`658ccaf5d978955dd2cf68b6c6febaabc78e4a34`；最终代码 `0d0a798` 的增量修正见 [复核记录](r5-review.md)。规格来源：[GitHub Issue #51](https://github.com/kassol/AgentAnywhere/issues/51)。

本表从当前源码反查 44 条 User Story。“回归入口”表示仓库内已有可运行检查；最终候选是否通过完整自动、isolated、live、ego-browser、public 与正式发布门槛，统一以 [R5-09](r5-09.md) 为准。R3/R4 证据仅证明 R5 沿用的业务契约曾通过真实环境验收，不能替代 R5 页面组合和发布复验。

| # | 实际实现映射 | 可运行验证与既有证据 |
| --- | --- | --- |
| 1 管家对话为主线 | `src/web/main.tsx:94-99,137-177` 将默认路由落到 `Steward`，工作、待办、报告、设置独立直达。 | `src/server.test.ts:35-68` 覆盖登录后的页面入口；R5 默认落点与真实浏览器流程见 `r5-09.md` 最终记录。 |
| 2 稳定三段位置 | `src/web/main.tsx:148-178` 组合主导航、会话导航和主内容；`src/web/style.css:35-92` 固定三栏、页头和滚动边界。 | 结构与 Craft 来源见 `docs/r5-craft-source.md:5-7`；桌面、小屏及与 A 的视觉对照归 `r5-09.md`。 |
| 3 搜索并切换历史对话 | `src/web/ConversationNavigation.tsx:12-40` 按显示标题过滤、清空并链接持久 Thread；`src/web/main.tsx:105-124` 持续读取真实列表。 | `r5-09.md` 已记录改名、搜索无结果、清空恢复和对话切换的本地真实浏览器检查；最终候选结论仍归该文档。 |
| 4 新对话明确空态 | `src/web/ConversationNavigation.tsx:25-40` 提供新建入口；`src/web/Steward.tsx:128-157,272-277` 隔离 new 状态并展示委托空态。 | `src/steward.test.ts:30-59` 可验证独立 Thread 创建与重开；空态视觉归 `r5-09.md`。 |
| 5 对话自动短标题 | `src/steward.ts:481-510` 首条消息先写摘要并只触发一次命名；`src/title-generator.ts:16-18,38-52,86-120` 限制输入、输出、超时和工具。 | `src/title-generation.test.ts:107-125` 覆盖 Responses 对话标题、用量与人工标题保护。 |
| 6 工作自动短标题 | `src/work.ts:882-902` 创建后触发命名；`src/server.ts:99-111` 复用管家模型连接；`src/title-generator.ts:71-83` 只更新未人工编辑的工作。 | `src/title-generation.test.ts:66-105` 覆盖一次调用、Chat Completions、计量、失败和超时。 |
| 7 手动修改两类标题 | `src/web/TitleEditor.tsx:24-52` 提供键盘可达的保存/取消；`src/server.ts:262-275,423-436` 暴露受鉴权、同源和大小限制保护的 PATCH。 | `src/title.test.ts:11-70` 通过公开 API 覆盖两类改名、非法值、未认证、跨源、404、刷新投影和多入口一致性；浏览器改名见 `r5-09.md`。 |
| 8 自动命名失败可读回退 | `src/title.ts:10-12` 生成 80 字摘要；`src/work.ts:170-177,870-873` 兼容空标题；`src/title-generator.ts:109-120` 将超时、供应商、空结果和非法结果记为失败而不阻断业务。 | `src/title-generation.test.ts:96-105` 验证 provider/timeout 后标题仍为摘要。 |
| 9 迟到标题保留人工修改 | `src/title-generator.ts:71-83` 更新条件含 `NOT title_edited`；`src/steward.ts:493-505` 首轮摘要同样检查人工编辑标志。 | `src/title-generation.test.ts:85-95,122-125` 覆盖迟到模型结果和人工仍命名为“新对话”的边界。 |
| 10 查看完整原始要求 | `src/web/Steward.tsx:337-345`、`src/web/Work.tsx:282-289,358-363` 在集中入口、详情和列表按需展开 `goal`。 | `src/title.test.ts:34-64` 断言改名后原 `goal` 不变；真实创建、改名、刷新和原目标检查见 `r5-09.md`。 |
| 11 改名只影响展示 | `src/work.ts:876-879` 与 `src/steward.ts:453-456` 只写 `title/title_edited`；Task、Run、请求身份和目标未进入更新语句。 | `src/title.test.ts:43-64` 核对原目标、对象 ID 和关联投影；精确业务身份回归另见 `src/web/QuickActions.test.ts:10-33`。 |
| 12 每项工作一个集中入口 | `src/steward.ts:429-435` 按已关联 Task ID 投影；`src/web/Steward.tsx:322-354` 每个 `task.id` 只渲染一个入口；回执按 Task 归入历史。 | `src/web/StewardReceipts.test.ts:12-30` 覆盖绑定回执不在轮次重复；`src/steward.test.ts:416-548` 覆盖关联投影。 |
| 13 入口优先状态、报告、待办 | `src/web/Steward.tsx:323-336` 从最新 Run 选当前 Interaction/失败/报告并生成动作；`src/work.ts:252-302` 从真实 Run、Interaction、Artifact 投影。 | `src/web/StewardQuickActions.test.ts:19-76` 覆盖等待、失败、成功和旧 Run 不产生动作；最终多状态浏览器流程归 `r5-09.md`。 |
| 14 展开历史执行与回执 | `src/web/Steward.tsx:337-350` 展开原要求、Run、Interaction、报告版本和 Operation；`src/web/StewardReceipts.tsx:68-116` 保留稳定回执身份。 | `src/web/StewardReceipts.test.ts:4-30` 与 `src/steward.test.ts:62-131` 覆盖原轮/恢复轮归属及集中后不重复。 |
| 15 多工作独立状态 | `src/steward.ts:429-435` 分别读取各 Task；`src/web/Steward.tsx:322-354` 用 Task/Run ID 独立计算当前卡和动作，同名标题不参与合并。 | `src/steward.test.ts:561-865` 可运行多项独立派发、部分创建和限制场景；真实多工作页面验收归 `r5-09.md`。 |
| 16 工作列表直达且可直接创建 | `src/web/main.tsx:137-144` 提供 `/tasks`；`src/web/Work.tsx:341-367` 保留完整目标、链接、模型、协议创建和真实列表。 | `src/work.test.ts:14-131` 覆盖公开 API 创建、幂等、列表和详情；本地真实浏览器创建见 `r5-09.md`。 |
| 17 待办集中全部未解决事项 | `src/work.ts:296-302` 查询全部 pending Interaction；`src/web/Work.tsx:369-430` 轮询并按 Interaction 身份显示回答或额度动作。 | `src/work.test.ts:51-65,257-274` 覆盖问题与额度决定；R4 同一真实 Interaction 的跨页证据见 `r4-05.md:37-44`，R5 最终复验归 `r5-09.md`。 |
| 18 任一入口回答后同步 | 工作详情和待办共用 `/api/interactions/:id/resolve`（`src/web/Work.tsx:219-239,399-410`），各页面从服务端轮询刷新（`:101-129,381-397`）。 | `src/work.test.ts:51-65,257-274` 覆盖首次回答、幂等和冲突；R4 跨入口真实恢复见 `r4-05.md:41-42`，R5 复验归 `r5-09.md`。 |
| 19 失败原因与重试 | `src/web/Work.tsx:267-330` 显示失败、清理失败和手动重试；`src/web/Steward.tsx:63-74,318-348` 在当前失败 Run 上提供精确重试。 | `src/work.test.ts:227-254` 覆盖检查点重试生成新 Run；`src/web/StewardQuickActions.test.ts:42-67` 覆盖同模型/替代模型目标。 |
| 20 停止回复与取消工作分开 | `src/web/Steward.tsx:252-256,356-363` 调用 Turn stop；`src/web/Work.tsx:257-264,277-280` 调用 Task cancel；快捷取消携带 Task/Run。 | `src/work.test.ts:112-122` 覆盖取消；R4 浏览器已验证停止 Turn 后独立 Task 继续，见 `r4-04.md:34-37`；R5 复验归 `r5-09.md`。 |
| 21 快捷操作精确且可检查 | `src/web/QuickActions.tsx:6-25,42-75` 在命令、名称和提示中保留 Task/Run/Interaction/Version/Operation；`src/web/Steward.tsx:258-263` 填入前确认覆盖。 | `src/web/QuickActions.test.ts:10-33`、`src/web/StewardQuickActions.test.ts:19-90` 覆盖全部命令、当前 Run 和草稿保护。 |
| 22 IME、Enter 与换行 | `src/web/Composer.tsx:94-126` 排除 composition、keyCode 229、Shift/修饰键；`src/web/craft/components/FreeFormInput.tsx:65-103` 绑定发送与提示。 | `src/web/Composer.test.ts:95-106` 为可运行键盘回归；R5 真实中文 composition、换行、刷新与提交见 `r5-09.md`。 |
| 23 草稿按对话保存并故障保留 | `src/web/Composer.tsx:24-52` 按 Thread 使用 localStorage；`src/web/Steward.tsx:207-249` 仅明确接受后清理，未知结果保留同一请求。 | `src/web/Composer.test.ts:20-82` 覆盖隔离、刷新身份、拒绝和接受；断网核对重试的 R5 浏览器证据见 `r5-09.md`。 |
| 24 发送中保护新编辑 | `src/web/Composer.tsx:55-56,63-91` 用 draft revision 与 turnRequestId 精确清理；`src/web/Steward.tsx:181-249` 提交固定快照。 | `src/web/Composer.test.ts:36-55` 覆盖旧响应和预检均不清新编辑；R5 延迟响应浏览器证据见 `r5-09.md`。 |
| 25 阅读历史不被新消息抢位 | `src/web/ActivityFeed.tsx:109-190` 保存 `following/scrollTop`，仅跟随状态自动到底并提供回到最新。 | `src/web/ActivityFeed.test.tsx:8-43` 覆盖事件合并与分页；真实长流式保持曾在 `r4-04.md:34-37` 验收，R5 页面组合复验归 `r5-09.md`。 |
| 26 工具详情默认收起且可查 | `src/web/craft/components/TurnCard.tsx:85-103,150-228` 默认折叠活动，展开显示参数、错误和完整结果；`src/web/Steward.tsx:282-314` 传入真实持久事件。 | `src/web/ActivityFeed.test.tsx:8-43` 验证事实合并和摘要；R4 真实工具展开证据见 `r4-04.md:7-14`。 |
| 27 从工作入口打开报告并保留对话 | `src/web/WorkPreview.tsx:110-163` 在 URL 固定 Task/Version、保存焦点并保留主对话；`:498-512` 将批注汇总桥接回原 Composer。 | `src/web/WorkPreview.test.tsx:12-39` 覆盖链接、固定版本、滚动键和覆盖确认；完整 R5 浏览器流程归 `r5-09.md`。 |
| 28 独立阅读并返回来源 | `src/web/WorkPreview.tsx:165-230` 只接受本地来源路径并返回工作/对话；`:522-535` 提供明确返回与独立阅读标题。 | `src/web/WorkPreview.test.tsx:42-50` 覆盖允许/拒绝来源；`src/server.test.ts:35-68` 覆盖独立报告认证路由，小屏入口见 `r5-09.md`。 |
| 29 版本切换与下载固定版本 | `src/web/WorkPreview.tsx:323-360,528-555` 固定选择、按 Task+Version 保存位置并直接下载该 Version；未知版本不回退。 | `src/web/WorkPreview.test.tsx:19-33` 与 `src/work-preview-api.test.ts:12-60` 覆盖版本归属、内容/下载一致、哈希和鉴权。 |
| 30 批注绑定工作及版本 | `src/web/ReviewAnnotations.ts:13-36,124-161` 的存储键和 Craft 适配均携带 Task/Version；`src/web/WorkPreview.tsx:449-483` 用当前不可变版本写入。 | `src/web/ReviewAnnotations.test.ts:42-126` 覆盖版本隔离、Craft 适配、UUID 持久化和写失败重试。 |
| 31 刷新恢复批注且失效保留原文 | `src/web/ReviewAnnotations.ts:67-121` 按版本读取草稿/批注并严格判断 exact；`src/web/WorkPreview.tsx:373-391,602-610` 恢复草稿，失效时保留引用。 | `src/web/ReviewAnnotations.test.ts:127-166` 覆盖草稿恢复、存储故障和失效引用；R4 真实刷新/失效证据见 `r4-06.md:35-44`。 |
| 32 汇总后检查并发送改稿 | `src/web/ReviewAnnotations.ts:164-177` 构造固定 Task/Version 命令；`src/web/WorkPreview.tsx:498-512` 只写入 Composer，用户仍须发送。 | `src/web/ReviewAnnotations.test.ts:157-179` 与 `src/web/Composer.test.ts:82-94` 覆盖 reviewContext 和内容筛选；真实发送链路最终归 `r5-09.md`。 |
| 33 新版时选择原版或取消 | `src/web/Steward.tsx:169-203,364-369` 发送前核对最新成功版本，展示取消与继续原版本两支。 | `src/web/Composer.test.ts:48-55` 验证预检不覆盖新编辑；R4 两支真实流程见 `r4-06.md:39-42`，R5 复验归 `r5-09.md`。 |
| 34 旧版保留且只清已接受批注 | `src/web/ReviewAnnotations.ts:180-217` 按提交内容、ID、updatedAt 和匹配草稿精确清理；`src/work.ts:122-127` 版本为追加记录，旧版本不被覆写。 | `src/web/ReviewAnnotations.test.ts:168-219` 覆盖精确清理与清理失败保留；`src/work.test.ts:193-224` 覆盖新 Run 后旧报告正文不变。 |
| 35 设置保留完整配置 | `src/web/ModelSettings.tsx:31-42,131-205` 保留连接、协议、默认模型、管家模型、调研池、目录映射、能力来源和人工覆盖。 | `src/web/ModelSettings.test.ts:26-81` 覆盖完整 payload 与未保存编辑；`src/model-connection.test.ts:11-283` 覆盖持久化、凭证不回显和模型池；R5 浏览器保存见 `r5-09.md`。 |
| 36 设置错误、加载与保存反馈 | `src/web/ModelSettings.tsx:55-90,109-136` 对加载、保存、刷新、测试和既有失败状态给出可见反馈，并在成功后才清密钥/dirty。 | `src/web/ModelSettings.test.ts:43-61` 覆盖刷新期间保留编辑；R4 断网恢复见 `r4-07.md:37-43`，R5 成功反馈见 `r5-09.md`。 |
| 37 真实登录、退出与错误 | `src/web/main.tsx:52-90,126-135,173-176` 调用真实 auth/logout；`src/server.ts:214-245,500-506` 实施密码校验、限流、会话和私有页面边界。 | `src/server.test.ts:35-116` 覆盖匿名、错密、限流、Secure/HttpOnly、退出及 WebSocket；R5 错密、登录、退出见 `r5-09.md`。 |
| 38 六类页面一致使用 Craft | `src/web/main.tsx:13-20,148-177` 提供共同外壳；各页实际组件与本地业务边界逐项列于 `docs/r5-craft-source.md:9-18`。 | 来源、版本和许可的静态证据见 `docs/r5-craft-source.md`、`docs/r4-craft-source.md` 及迁入文件头；六页最终视觉矩阵归 `r5-09.md`。 |
| 39 浅色、深色、跟随系统可读 | `src/web/theme.ts:1-38` 持久化三态并监听系统变化；`src/web/craft-theme.css:77-101` 定义深色令牌和 Inter 回退。 | R5 三态本地浏览器检查见 `r5-09.md`；六页两主题最终截图与可读性结论仍归该文档。 |
| 40 小屏主要流程可达 | `src/web/main.tsx:159-167` 提供全页移动导航；`src/web/style.css:171-206` 切单区并保留报告高度；`src/web/work-preview.css:457-530` 调整报告、返回、版本和批注。 | R5 移动导航、设置、报告索引已有本地浏览器记录于 `r5-09.md`；完整介入、报告与返回流程由该文档最终收口。 |
| 41 键盘焦点与控件名称明确 | `src/web/TitleEditor.tsx:39-51` 支持自动聚焦/Escape/命名按钮；`src/web/QuickActions.tsx:63-73` 暴露身份；`src/web/WorkPreview.tsx:295,393-412,585-599` 管理返回焦点和键盘引用。 | `src/web/craft/components/SettingsSelect.test.ts:6-22`、`SettingsToggle.test.ts:6-21`、`src/web/Composer.test.ts:95-106` 验证名称与键盘判定；真实焦点顺序归 `r5-09.md`。 |
| 42 长内容、多工作和空态稳定 | `src/web/style.css:52-66,117-154`、`src/web/work.css:220-365,588-620` 约束截断、换行、滚动和空态；`src/web/WorkPreview.tsx:253-266` 提供报告空态/列表。 | 长标题/长消息/多工作/六页空态属于布局结果；自动回归只能覆盖数据分支，最终 1440×1000 与 390×844 视觉证据归 `r5-09.md`。 |
| 43 升级保留旧数据、链接和草稿 | `src/work.ts:58-59`、`src/steward.ts:208-212` 使用兼容 `ADD COLUMN IF NOT EXISTS`；`src/work.ts:170-177,870-873` 为旧工作回退摘要；原路由和 Composer 存储键保持。 | `src/title.test.ts:34-64` 覆盖旧字段回退与 API 投影；R4 升级、链接、哈希和草稿历史证据见 `r4-08.md:67-79`，R5 正式兼容复核只以 `r5-09.md` 为准。 |
| 44 核查组件来源与 A 差异 | `src/web/main.tsx:13-20,148-177` 是实际外壳复用链，`src/web/craft/components/TurnCard.tsx:1-10` 等迁入文件头保留固定 commit、版权、许可与删减说明；`docs/r5-craft-source.md:1-28` 逐页记录本地组合边界和 A 适配。 | `docs/evidence/r5-review.md` 记录 Standards/Spec 双轴复核及修复；最终逐页 A 对照、源码参与渲染和发布证据归 `r5-09.md`。 |
