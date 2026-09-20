# R4 Craft 固定源码与迁移清单

本清单对应 [R4-01 / #43](https://github.com/kassol/AgentAnywhere/issues/43)。结论来自本轮直接读取 Craft 固定源码和 AgentAnywhere 当前代码。R3 提取记录只用于定位候选文件。

## 固定来源与复现

- 上游仓库：`https://github.com/craft-ai-agents/craft-agents-oss.git`
- tag：`v0.13.3`
- commit：`e8963854c3679edcceb105a42537a06749e6cb64`
- 本轮只读检出：`/tmp/agentanywhere-r4/craft-upstream`
- 许可：根 `LICENSE:1-4` 为 Apache License 2.0；`NOTICE:1-5` 记录 `Craft Agents`、`Copyright 2026 Craft Docs Ltd.` 和项目地址。`packages/ui/package.json:2-5` 同时声明包名、版本和许可。仓库已有完整副本 `licenses/CRAFT-APACHE-2.0.txt`。

可复现恢复命令：

```bash
mkdir -p /tmp/agentanywhere-r4
git clone --filter=blob:none --no-checkout https://github.com/craft-ai-agents/craft-agents-oss.git /tmp/agentanywhere-r4/craft-upstream
git -C /tmp/agentanywhere-r4/craft-upstream checkout --detach e8963854c3679edcceb105a42537a06749e6cb64
git -C /tmp/agentanywhere-r4/craft-upstream rev-parse HEAD
git -C /tmp/agentanywhere-r4/craft-upstream describe --tags --exact-match HEAD
git -C /tmp/agentanywhere-r4/craft-upstream status --short
```

本轮输出依次确认完整 commit、`v0.13.3`，且工作树无改动。本票没有安装依赖、构建或运行上游及本地应用。

## 迁移边界

迁入源码放在 `src/web/craft/`，保留原组件名、原文件头的来源 commit 和 Apache-2.0 归属。按文件复制实际使用的组件，以相对 import 组成浏览器端代码；不整体引入上游 monorepo、Electron 运行时或 `@craft-agent/core` / `@craft-agent/shared` 业务状态机。

三类处理必须在实现和审查中显式标注：

1. **原源码适配**：以固定源码组件为主体，只裁掉本产品没有的功能分支，改接本地 DTO、中文文本和回调。裁剪不等于重写。
2. **业务专用组合**：Craft 没有对应的 Task、Run、Interaction、Operation 或 Artifact/Version 页面；使用迁入的 Craft 原组件组合当前业务，身份和状态继续来自现有 API。
3. **重写例外**：存在对应上游组件，却无法以原源码为主体时才适用。当前核查没有发现必须批准的例外。后续运行验证若发现此类阻塞，须带源码耦合证据和替代方案请求产品所有者确认。

A 的侧栏、对话和按需预览整体结构继续保留；局部控件和交互采用 Craft。Inter 自托管字体继续保留，中文走现有系统回退。React 版本相容：两边均为 React 18.3.1（本项目 `package.json:15-16`；上游 `apps/electron/package.json:65-68`）。

## 核心链路接口

| 链路 | Craft 原源码与接口 | 本地入口 | 迁移方式 | #44 最小依赖与待验证项 |
| --- | --- | --- | --- | --- |
| 输入 | `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx:130-249` 定义受控值、提交、停止及状态；`:1248-1291` 形成提交快照；`:1314-1417` 处理 IME、Enter、Shift+Enter 与停止 | `src/web/Composer.tsx:23-95` 保存按 Thread 隔离的草稿和提交身份，`:97-130` 渲染输入 | **原源码适配**。保留 FreeFormInput 的表单容器、受控输入、发送/停止分支和键盘处理；移除附件、模型选择、连接、权限、slash/mention/label、工作目录等未开放功能。上游 `:1277-1283` 在调用 `onSubmit` 后立即清空输入；这里必须改为沿用本地提交快照，服务端接受后才精确清理，拒绝或未知结果保留草稿，旧响应不得清除后来输入 | `Tailwind v4`、`lucide-react`、`motion`、公共 Button/cn。#44 验证 React 18 构建、中文 IME、失败保留、并发编辑和停止回调；中文文本作为明确适配，不引入整套 i18n |
| 消息与工具 | `packages/ui/src/components/chat/TurnCard.tsx:238-277` 定义 `ActivityItem` / `ResponseContent`，`:292-359` 定义主要回调，`:791-1386` 为状态图标、活动行和分组，`:1653-2679` 为回复卡，`:2766-2850` 为轮次展开状态 | `src/web/ActivityFeed.tsx:3-65` 从持久事件生成真实活动，`:101-130` 展示工具；`src/web/Steward.tsx:70`、`src/web/Work.tsx:50` 读取真实轮次 | **原源码适配**。迁入 TurnCard 的轮次、活动行、回复卡和展开结构；增加单一 DTO 适配层，将 `turnId`、事件状态、参数和结果映射为上游展示类型。删除 plan 接受、branch、文件 diff、父任务工具和 Craft annotation 分支 | 同上。保留现有 `react-markdown` 安全边界。#44 验证 running/completed/error、工具详情、真实结果、所属轮次和流式更新；不引入 `@pierre/diffs`、Craft Core 或 Shared runtime |
| 打开报告 | `packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx:22-59` 定义内容与回调，`:61-138` 渲染文档卡；`packages/ui/src/components/ui/PreviewHeader.tsx:102-168` 定义预览头 | `src/web/WorkPreview.tsx:159-228` 固定 Task/Version 并读取真实报告；`src/web/Work.tsx:39-48` 负责安全 Markdown | **原源码适配**。保留 DocumentFormattedMarkdownOverlay 的组件、文档卡和 PreviewHeader；把 FullscreenOverlayBase 外壳改接 A 的右侧预览容器，把 `messageId` 映射为不可变 Version UUID。#44 只接只读报告；批注原组件留给 #48 | 公共依赖加现有 `react-markdown` / `remark-gfm`。#44 验证真实报告、版本固定、关闭/返回、历史链接和下载不受影响 |

核心链路不需要重写例外。`FreeFormInput.tsx` 共 2537 行、`TurnCard.tsx` 共 3284 行，且分别绑定多项 Craft 产品能力；整文件原样搬入会带入未开放功能。按上述行段保留实际组件结构、状态和交互，再删除不使用分支，符合原源码适配。#44 必须用 diff 审查确认迁入代码实际参与渲染，不能只提取样式。

## 全部页面迁移清单

| 范围 | Craft 原组件与源码证据 | 当前本地模块 | 分类与适配方式 | 最小依赖 / 风险 |
| --- | --- | --- | --- | --- |
| 应用外壳 | `apps/electron/src/renderer/components/app-shell/Panel.tsx:24-67` 是无业务状态的面板容器；完整 `PanelSlot.tsx:16-46` 依赖 Jotai、路由和 AppShellContext | `src/web/main.tsx:96-174`、`src/web/style.css` | Panel 为**原源码适配**；侧栏、导航和按需预览为**业务专用组合**，保留 A 整体。不得迁入 PanelSlot 的桌面状态 | Tailwind、cn。小屏导航和路由恢复在 #45 验证 |
| 公共控件 | `apps/electron/src/renderer/components/ui/button.tsx:1-57`；`input.tsx:1-22`；`textarea.tsx:1-18`；`badge.tsx:1-39`；`empty.tsx:1-104`；`packages/ui/src/components/ui/LoadingIndicator.tsx:18-141` | 原生 button/input、`src/web/EmptyStateCard.tsx:3-10` 与各页加载态 | 全部为**原源码适配**；保留 props、variant 和 data-slot，中文 aria 文本显式传入 | Tailwind、cn、CVA、Radix Slot；Spinner 去掉 `useTranslation` 后接中文 aria-label |
| 管家输入 | FreeFormInput 见核心链路 | `src/web/Composer.tsx`、`src/web/Steward.tsx` | **原源码适配**，现有草稿、请求身份、批注上下文仍由本地业务层管理 | #44 先跑通，#46 补全草稿、快捷填充、停止和长对话状态 |
| 管家消息与工具 | TurnCard、`packages/ui/src/components/chat/UserMessageBubble.tsx:305-519`、`turn-utils.ts:331-676` | `src/web/ActivityFeed.tsx`、`src/web/Steward.tsx`、`src/web/StewardReceipts.tsx` | TurnCard/UserMessageBubble 为**原源码适配**；按真实 `turnId` 分组和稳定回执为**业务专用组合** | #44 验证基本链路；#46 验证历史阅读保持、流式更新和回执归属。现有 StableScroll 行为继续作为业务层 |
| 工作列表与详情 | `apps/electron/src/renderer/components/ui/entity-row.tsx:46-148` 提供领域无关列表行插槽；`app-shell/kanban/StatusBadge.tsx:4-48` 提供状态徽标；完整 `TaskTile.tsx:46-539` 绑定 Craft Kanban、模型、子任务和 Jotai | `src/web/Work.tsx:50-336` | EntityRow、StatusBadge、Panel 为**原源码适配**；Task/Run/Artifact 数据、列表分组和详情为**业务专用组合**。不迁入 TaskTile 业务状态机 | #47 验证空态、长标题、状态、详情、回答/追加/取消/重试和报告链接 |
| 待办 | `input/StructuredInput.tsx:7-50` 只路由 permission/credential/admin approval；`structured/PermissionRequest.tsx:8-109` 提供带说明和主次动作的卡片结构 | `src/web/main.tsx:101-145` 汇总 pending Interaction；工作详情执行回答和额度决定 | PermissionRequest 的卡片与动作区为**原源码适配**；Interaction 去重、问题/额度语义和精确身份为**业务专用组合**。Craft 无 Interaction 页面直接对应物 | Button、Panel、Badge。#47 验证跨入口同一 Interaction、已回答消失和精确目标 |
| 报告预览与批注 | `DocumentFormattedMarkdownOverlay.tsx:22-138`；`AnnotatableMarkdownDocument.tsx:47-83` 定义内容/身份/增删改接口，`:145-227` 计算持久批注覆盖层；`annotations/annotation-core.ts:3-111` 创建 position+quote selector，`:113-223` 计算 DOM 偏移 | `src/web/WorkPreview.tsx`、`src/web/ReviewAnnotations.ts` | 预览与批注组件为**原源码适配**；Task/Version 身份、localStorage 草稿、改稿命令和成功清理为**业务专用组合**。用本地 Annotation 适配类型替代 Craft Core 类型 | #44 只读链路；#48 迁入 AnnotationIsland 相关源码并验证选区、失效引用、刷新恢复、新版确认和精确清理。风险为 Markdown DOM 偏移与当前安全 renderer 的一致性 |
| 快捷操作与回执 | `apps/electron/src/renderer/components/chat/AuthRequestCard.tsx:77-140` 提供紧凑主次动作区；`components/ui/button.tsx:6-57` | `src/web/QuickActions.tsx:3-73`、`src/web/StewardReceipts.tsx:21-78` | 动作条和 Button 为**原源码适配**；完整授权命令生成、填入后发送、目标身份为**业务专用组合**。不迁入 credential 业务 | #46/#47/#48 分别验证各入口；覆盖草稿确认继续保留现有 Composer 契约 |
| 模型设置 | `components/settings/SettingsSection.tsx:14-117`、`SettingsCard.tsx:11-86`、`SettingsRow.tsx:12-104`；完整 `pages/settings/AiSettingsPage.tsx:12-57` 绑定多连接、工作区、OAuth、Jotai 和 Onboarding | `src/web/ModelSettings.tsx:28-199`、`main.tsx:26-49` | 三个 Settings 原组件与 Button/Input/Badge 为**原源码适配**；单连接、调研池、协议与能力配置为**业务专用组合**。不迁入 AiSettingsPage 业务状态机 | #49 验证未保存状态、折叠不丢字段、凭证不回显、刷新保留选择和主题设置 |
| 主题与字体 | `apps/electron/src/renderer/index.css:143-180` 定义色阶与 Shadcn 兼容变量，`:196-205` 定义字体/布局，`:250-311` 定义深色，`:386-393` 定义 Inter，`:395-460` 映射 Tailwind v4 | `src/web/craft-theme.css:1-46`、`fonts.css:1-9`、`theme.ts:1-32` | 上游 token 与 Tailwind 映射为**原源码适配**；保留本地 `data-theme` 三态和自托管 Inter。A 的总体表面关系继续存在，局部组件类以 Craft 为准 | #45 验证明暗/系统、小屏、焦点和字体实际加载；不加载 Google Fonts |

## 依赖方案

先引入所有迁移组件共同需要的最小底座，版本沿用固定上游根依赖：

| 依赖 | 固定上游证据 | 用途 |
| --- | --- | --- |
| `tailwindcss ^4.1.18`、`@tailwindcss/vite ^4.1.18` | 上游根 `package.json:114,140`；WebUI Vite 插件见 `apps/webui/vite.config.ts:1-17` | 执行原组件 class 和主题 token |
| `clsx ^2.1.1`、`tailwind-merge ^3.4.0` | 根 `package.json:181,203`；`packages/ui/src/lib/utils.ts:5-12` | 原 `cn` 实现 |
| `class-variance-authority ^0.7.1`、`@radix-ui/react-slot ^1.2.4` | 根 `package.json:160,180`；Button import 见 `button.tsx:1-4` | Button/Badge variants 与 `asChild` |
| `lucide-react ^0.561.0` | 根 `package.json:188` | 原组件图标 |
| `motion ^12.23.26` | `apps/electron/package.json:62` | 输入、TurnCard 和批注的原动画/展开状态 |

`i18next` / `react-i18next` 不列入初始最小依赖。AgentAnywhere 当前只有中文界面，迁入组件将 `t(...)` 替换为明确中文文本，避免复制上游完整词典和初始化。若 #44 证明这会造成大范围源码改动，再将两项依赖作为运行验证结论补入。

不引入完整 `@craft-agent/ui`，其包清单同时依赖 Craft Core/Shared、多种 Markdown、PDF、diff、shader、Jotai、Radix 和国际化（`packages/ui/package.json:21-58`）。按组件复制可保留原源码，同时避免无关产品功能。`@craft-agent/core` 的 `AnnotationV1`、消息和工具类型只在本地适配层复刻最小展示形状；服务端事实仍以 AgentAnywhere DTO 为准。

## R4-02 实际迁入：输入与轮次

以下项目已在 #44 迁入并参与实际页面渲染。核心真实链路证据见 `docs/evidence/r4-02.md`。

| 本地组件 | 保留的固定上游源码 | 实际适配与删除 |
| --- | --- | --- |
| `src/web/craft/components/Button.tsx:1-49` | `apps/electron/src/renderer/components/ui/button.tsx:1-57` 的 `buttonVariants`、Radix Slot、CVA variant/size 与 `data-slot` JSX | import 改为相对路径；颜色 token 接现有主题；因本地不加载 Tailwind preflight，显式补 `border-0`。旧全局 CSS 已排除 `[data-slot="button"]`，避免覆盖原组件颜色、尺寸和焦点样式 |
| `src/web/craft/components/RichTextInput.tsx:14-302` | `rich-text-input.tsx:32-85,173-363,500-716,775-822` 的 IME guard、公开 handle、contenteditable 纯文本模型、光标换算、HTML 转义、`execCommand('insertText')` 原生撤销路径、受控值同步和原 JSX | 删除 mention badge、图标预载、长文本附件化、轮换占位；新增 `maxLength` 并在组合结束/输入时截到 16000；补 `aria-label` 接本地中文标签 |
| `src/web/craft/components/FreeFormInput.tsx:17-108` | `FreeFormInput.tsx:1248-1417,1572-1784,2400-2491` 的 `submitMessage`、表单、圆角输入容器、RichTextInput、底部控制行和 Button/ArrowUp 发送区 | 删除 Electron 附件、模型、权限、slash/mention/label、工作目录；发送键沿用现有 Enter/Shift+Enter/IME 契约。上游 `:1277-1283` 的立即清空被明确移除，`Composer.tsx:77-87,107-125` 继续只在服务端接受且草稿版本未变时清空 |
| `src/web/craft/components/TurnCard.tsx:17-231` | `packages/ui/src/components/chat/TurnCard.tsx:238-359,791-1030,1653-1684,2450-2679,2766-3254` 的 Activity/Response 类型、状态图标、活动行、300ms 回复节流、540px 回复卡、轮次展开和 Motion 结构 | 删除 Task 子代理分组、plan、branch、diff、Electron 详情窗和 Craft 批注；浏览器原生 `details` 承接详情窗，保留真实参数、错误和完整结果。完成/失败标题按真实 Activity 状态生成，终止轮次不保持流式旋转 |
| `src/web/craft/components/UserMessageBubble.tsx:12-32` | `UserMessageBubble.tsx:305-519` 的右对齐容器、80% 气泡、圆角/间距与 queued 状态结构 | 删除附件、badge 与 Markdown；本地用户消息继续按字面纯文本显示，避免改变既有输入语义 |

接入点：`Composer.tsx:94-125` 把现有草稿状态传给 FreeFormInput；`ActivityFeed.tsx:112-131` 把持久工具事件映射给 ActivityRow；`Steward.tsx:276-311` 按真实 `turnId` 组合 UserMessageBubble、ActivityItem、TurnCard 和安全 `ReportMarkdown`，`:334-341` 使用原 Button 停止对应真实轮次。Tailwind v4 插件位于 `vite.config.ts:1-8`，局部 theme/utilities 映射位于 `src/web/craft/styles.css:1-35`；未启用 preflight，A 外壳继续使用原 CSS。

实际安装版本与固定上游一致：`@tailwindcss/vite 4.1.18`、`tailwindcss 4.1.18`、`clsx 2.1.1`、`tailwind-merge 3.4.0`、`class-variance-authority 0.7.1`、`@radix-ui/react-slot 1.2.4`、`lucide-react 0.561.0`、`motion 12.23.26`。未引入 Electron、Craft Core/Shared、i18next、diff 或批注运行时。

## 后续任务清单

| 任务 | 可直接使用的 Craft 组件 | 本地适配层 | 进入任务前仍需验证 |
| --- | --- | --- | --- |
| #44 核心链路 | Panel、Button、Spinner、FreeFormInput 裁剪版、TurnCard/ActivityRow/ResponseCard 裁剪版、DocumentFormattedMarkdownOverlay 只读版、PreviewHeader | Composer 状态、ActivityEvent → ActivityItem、Artifact Version → 文档 props | Tailwind 构建、React 18、实际 API 数据、流式更新、中文 IME、真实报告 |
| #45 外壳与主题 | Panel、Button、Badge、原 token/Tailwind 映射、Lucide 图标 | A 路由与侧栏、`data-theme`、Inter | 主题首屏、系统切换、小屏导航、焦点、字体加载 |
| #46 管家输入与活动 | FreeFormInput、TurnCard、UserMessageBubble、LoadingIndicator | Thread 草稿/请求身份、turn 分组、StableScroll、回执 | 停止与发送区分、失败保留、旧响应保护、历史阅读位置 |
| #47 工作与待办 | EntityRow、StatusBadge、PermissionRequest 卡片结构、Button、Badge、Empty、Panel | Task/Run/Interaction DTO 与操作回调 | 全状态、长内容、跨入口 Interaction、精确控制目标 |
| #48 报告审阅 | DocumentFormattedMarkdownOverlay、PreviewHeader、AnnotatableMarkdownDocument、AnnotationIslandMenu 及 annotations 辅助源码 | Version 身份、localStorage 草稿、改稿命令、成功清理 | Markdown DOM 偏移、键盘选区、失效引用、新版冲突、恢复后清理 |
| #49 设置 | SettingsSection、SettingsCard、SettingsRow、Button、Input、Badge | 单连接、模型池、协议、能力与主题状态 | 折叠字段保留、刷新并发、凭证不回显、未保存提示 |
| #50 验收发布 | 上述全部 | 旧链接、旧数据、草稿兼容与清理 | 源码参与渲染、旧实现清理、全页面 ego-browser、正式环境与回滚 |

本票没有核心未决问题。构建和运行兼容性明确由 #44 前置验证；局部失败只阻塞对应组件，若失败要求放弃已有上游组件，才升级为产品所有者决定的重写例外。

## R4-02 报告与下游接口确认

`src/web/craft/components/PreviewHeader.tsx` 保留上游预览头的三栏结构与 Badge，移除 Electron 窗口占位，以 `leftActions/rightActions/onClose` 接浏览器返回、下载及关闭；`DocumentFormattedMarkdownOverlay.tsx` 保留文档卡 JSX，以 `renderMarkdown` 接安全渲染，`beforeContent/afterContent` 接现有版本批注，`documentRef/onDocumentMouseUp` 保留选区入口。`WorkPreview.tsx` 仍拥有 Task/Version 加载、锁定、下载和本机批注状态。

#44 已实测 React 18、Tailwind、真实 ActivityItem DTO 和版本报告 props；上述公共接口可供下游使用。#45 接 Panel/SidebarButton 与主题，#46 完整验收输入和活动，#47 组合 Task/Interaction，#48 替换批注插槽，#49 组合设置行。各票表中高风险交互由对应票继续验收；没有新增范围决定或重写例外。核心浏览器完成工具详情、报告打开/下载/Esc 返回，所有页面最终验收仍由 #50 执行。

## R4-04 实际迁入：完整输入与活动

固定来源：Craft Agents OSS `v0.13.3` / `e8963854c3679edcceb105a42537a06749e6cb64`，Apache-2.0。许可副本为 `licenses/CRAFT-APACHE-2.0.txt`。

| 本地文件 | 固定上游源码 | 保留内容 | 必要适配与裁剪 |
| --- | --- | --- | --- |
| `src/web/craft/components/LoadingIndicator.tsx:1-75`、`src/web/craft/styles.css:45-76` | `packages/ui/src/components/ui/LoadingIndicator.tsx:12-140`、`packages/ui/src/styles/index.css:482-510` | `formatDuration`、九格 `Spinner`、elapsed effect、`LoadingIndicator` JSX、spinner 动画 | 删除 `react-i18next`；`Spinner` 接收明确中文 aria label。输入核对、轮次等待、流式回复和对话加载均使用该组件 |
| `src/web/craft/components/ActionBar.tsx:1-25` | `apps/electron/src/renderer/components/chat/AuthRequestCard.tsx:77-140` 的 `AuthCardActions` | 原 flex 动作区、间距、边界、hint spacer 与文字结构 | 删除 credential 主次动作 DTO；改为 `children`，由 `QuickActions.tsx:56-76` 用原 Craft `Button` 渲染现有精确授权命令和目标身份 |
| `src/web/craft/components/RichTextInput.tsx:47-139,141-335` | `apps/electron/src/renderer/components/ui/rich-text-input.tsx:586-716` | contenteditable 文本/光标换算、HTML 转义、纯文本粘贴与原生 undo、IME 与受控同步 | 保留本地 16000 上限；`limitTextChange` 只裁剪本次新增段，保留原后缀。composition input 同步草稿 revision，受控 effect 在组合期间不覆盖 DOM，维持“服务端接受且草稿未变才清理”契约 |
| `src/web/craft/components/FreeFormInput.tsx:51-108` | `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx:1248-1417,1573-1645` | submit/键盘入口、圆角输入表面、RichTextInput、底部控制行与原 Button | 继续裁掉附件、菜单、模型与权限；不执行上游提交后立即清空。增加可见 `focus-within` 焦点环；发送核对使用 LoadingIndicator |
| `src/web/craft/components/TurnCard.tsx:54-228` | `packages/ui/src/components/chat/TurnCard.tsx:791-1386,1653-2679,2766-2850` | 活动状态、活动详情、ResponseCard、轮次展开结构 | 原本地 `LoaderCircle` 替换为上游 Spinner/LoadingIndicator；真实参数、结果、错误和轮次状态继续由现有 ActivityEvent 适配层提供 |

`src/web/ActivityFeed.tsx:133-190` 的 StableScroll 和 `src/web/Composer.tsx:17-125` 的草稿/请求身份是 AgentAnywhere 业务契约，Craft 没有可直接替换的浏览器实现，本轮保留。`src/web/StewardReceipts.tsx` 的 Task、Run、Interaction、Operation 投影同样保留，只把可执行快捷动作接入 ActionBar/Button。没有新增依赖。

已删除被上述组件替代的 `src/web/quick-actions.css`，并从 `src/web/composer.css` 删除 textarea、旧发送按钮和旧控制行规则。全局 `src/web/style.css` 由 R4-03 独占；其中已失去调用方的 `.tool-activity*` 留给该票合并时删除，`.return-latest` 仍服务 StableScroll。
