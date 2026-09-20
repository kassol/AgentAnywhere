# R5 页面体验与 Craft 复用边界

本清单对应 R5 页面体验。实际代码基于 A 原型 `412e7d0` 收敛，但六类页面仍是 AgentAnywhere 业务页面；Craft 提供原组件、主题与交互结构。固定上游、许可、迁入文件和依赖版本沿用 [R4 Craft 固定源码与迁移清单](r4-craft-source.md)，R5 没有新增上游依赖或整页复制。

## 共同外壳

`src/web/main.tsx:138-178` 用 Craft `Panel`、`SidebarButton` 和 `Button` 组合主导航、对话导航、移动导航及页面入口。路由、待办数量、Thread 选择和登录会话继续由 AgentAnywhere 管理。`src/web/style.css:38-94` 实现 A 的三栏桌面外壳、固定页头和各页面滚动边界；它不是 Craft Electron 外壳的移植。

## 六类页面

| 页面 | 实际复用的 Craft 原组件 | AgentAnywhere 组合边界 |
| --- | --- | --- |
| 管家对话 | `TurnCard`、`UserMessageBubble`、`EntityRow`、`Button`、`LoadingIndicator`；输入使用 `FreeFormInput` | `src/web/Steward.tsx:299-363` 以持久 Turn、Activity、Operation、Task 和 Run 组装轮次、工作卡与精确动作；`src/web/Composer.tsx:98-125` 保留草稿 revision、幂等提交和 IME 语义。Craft 不拥有 Thread 或业务命令。 |
| 工作 | `Button`、`Input`、`Label`、`Select`、`Textarea`、`LoadingIndicator`、`PermissionRequest`、`UserMessageBubble`，状态由 `StatusBadge` 适配 | `src/web/Work.tsx:267-367` 直接绑定 Task、Run、Interaction、Artifact/Version 和既有 API；列表行与详情是本地业务布局，创建仍保留目标、公开链接、模型和协议。 |
| 待办 | `PermissionRequest`、`Textarea`、`Button`、`LoadingIndicator` | `src/web/Work.tsx:369-432` 聚合全部 pending Interaction，提交时携带真实 Interaction ID；问题回答和额度决定仍由服务端校验 Task/Run 当前状态。 |
| 报告 | `PreviewHeader`、`PreviewHeaderBadge`、`DocumentFormattedMarkdownOverlay`、`AnnotatableMarkdownDocument`、`Textarea`、`Button` 及 annotations 辅助源码 | `src/web/WorkPreview.tsx:513-597` 绑定不可变 Task/Version、下载、阅读位置和批注；`src/web/ReviewAnnotations.ts:67-172` 继续负责本机草稿、引用校验和改稿命令。独立报告页占满主内容区，避免 A 评审确认后的空报告列。 |
| 设置 | `SettingsSection`、`SettingsCard`、`SettingsRow`、`SettingsInput`、`SettingsSecretInput`、`SettingsSelect*`、`SettingsToggle`、`Badge`、`Input`、`Button` | `src/web/ModelSettings.tsx:131-205` 保留单连接、协议、默认模型、管家模型、调研池、发现目录、能力来源、显式映射和人工覆盖值。A 原型只展示简化设置；真实页面保留完整字段，因为这些字段决定后续 Run 快照与模型可用性。 |
| 登录 | `SettingsInput`、`Button` | `src/web/main.tsx:55-90` 保留本地密码、限流错误和会话创建；品牌、说明和无卡片登录布局为本地 A 适配，不对应 Craft 完整登录页。 |

## R5 布局适配

- `src/web/work.css:1-36,150-244` 将工作页压到 A 的 800px 阅读宽度，以分隔线、短标题、状态和按需展开原始要求替代厚重卡片；完整创建表单和全部精确操作仍在同一页面。
- `src/web/work.css:588-620` 将待办控制在 620px，并保留加载、错误和空态；`PermissionRequest` 的固定动作区没有重写。
- `src/web/style.css:82-94` 让设置、工作和待办共享 A 的 78px 页头及独立滚动内容。移动端继续由现有导航和页面 CSS 自适应。
- `src/web/style.css:235-240` 只移除 `TurnCard` 回复区域的外框和高度限制，使正文回到 A 的连续阅读流；折叠活动、流式状态和原组件结构继续保留。
- `src/web/theme.ts:18-23` 固定页面使用 Inter；`src/web/craft-theme.css:1-10,97-100` 使用仓库内自托管字体和中文系统回退。R5 没有增加字体或 UI 运行时依赖。

R5 的复用原则是：优先使用已迁入的 Craft 原组件；页面路由、持久身份、业务状态、幂等边界和响应式信息结构由 AgentAnywhere 负责。因此不能将这些页面表述为全部来自 Craft。
