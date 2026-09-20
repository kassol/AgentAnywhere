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

本轮输出依次确认完整 commit、`v0.13.3`，且工作树无改动。#43 源码核查阶段未安装依赖或运行应用；#44 后续构建与真实链路结果见下文。

## 迁移边界

迁入源码放在 `src/web/craft/`，保留原组件名、原文件头的来源 commit 和 Apache-2.0 归属。按文件复制实际使用的组件，以相对 import 组成浏览器端代码；不整体引入上游 monorepo、Electron 运行时或 `@craft-agent/core` / `@craft-agent/shared` 业务状态机。

三类处理必须在实现和审查中显式标注：

1. **原源码适配**：以固定源码组件为主体，只裁掉本产品没有的功能分支，改接本地 DTO、中文文本和回调。裁剪不等于重写。
2. **业务专用组合**：Craft 没有对应的 Task、Run、Interaction、Operation 或 Artifact/Version 页面；使用迁入的 Craft 原组件组合当前业务，身份和状态继续来自现有 API。
3. **重写例外**：存在对应上游组件，却无法以原源码为主体时才适用。当前核查没有发现必须批准的例外。后续运行验证若发现此类阻塞，须带源码耦合证据和替代方案请求产品所有者确认。

A 的侧栏、对话和按需预览整体结构继续保留；局部控件和交互采用 Craft。Inter 自托管字体继续保留，中文走现有系统回退。React 版本相容：两边均为 React 18.3.1（本项目 `package.json:15-16`；上游 `apps/electron/package.json:65-68`）。

## 实际迁入索引

| 范围 | 实际迁入记录 |
| --- | --- |
| 输入、消息、工具与只读报告 | R4-02；`Button`、`RichTextInput`、`FreeFormInput`、`TurnCard`、`UserMessageBubble`、`PreviewHeader`、`DocumentFormattedMarkdownOverlay` 已接入真实链路 |
| 外壳、导航、主题与空态 | R4-03；`Panel`、`SidebarButton`、`Empty` 与固定上游主题 token 已覆盖 A 外壳 |
| 完整输入、活动、快捷动作与阅读位置 | R4-04；`LoadingIndicator`、`ActionBar` 及完整输入/活动适配已接入 |
| 工作与待办 | R4-05；`EntityRow`、`StatusBadge`、`PermissionRequest`、`Textarea` 已组合现有 Task/Run/Interaction |
| 报告批注 | R4-06；`AnnotatableMarkdownDocument`、`AnnotationIslandMenu`、`Island` 与 annotations 辅助源码已接入不可变 Version 和本机草稿 |
| 设置、登录与账户 | R4-07；`Input`、`Label`、`Badge`、`Select`、`Switch`、`Settings*` 已组合现有单连接与模型池 |

各节记录固定上游路径、保留源码、实际适配和运行入口。最终全部页面、旧数据、草稿兼容、正式环境及清理验收归 #50。

## 依赖方案

迁入组件使用以下最小底座，版本与固定上游一致：

| 依赖 | 固定上游证据 | 用途 |
| --- | --- | --- |
| `tailwindcss ^4.1.18`、`@tailwindcss/vite ^4.1.18` | 上游根 `package.json:114,140`；WebUI Vite 插件见 `apps/webui/vite.config.ts:1-17` | 执行原组件 class 和主题 token |
| `clsx ^2.1.1`、`tailwind-merge ^3.4.0` | 根 `package.json:181,203`；`packages/ui/src/lib/utils.ts:5-12` | 原 `cn` 实现 |
| `class-variance-authority ^0.7.1`、`@radix-ui/react-slot ^1.2.4` | 根 `package.json:160,180`；Button import 见 `button.tsx:1-4` | Button/Badge variants 与 `asChild` |
| `@radix-ui/react-label 2.1.8`、`@radix-ui/react-select 2.2.6`、`@radix-ui/react-switch 1.2.6` | `apps/electron/package.json:50,52,54` | 设置标签、选择器与模型池开关原组件 |
| `lucide-react ^0.561.0` | 根 `package.json:188` | 原组件图标 |
| `motion ^12.23.26` | `apps/electron/package.json:62` | 输入、TurnCard 和批注的原动画/展开状态 |

`i18next` / `react-i18next` 未引入。AgentAnywhere 当前只有中文界面，迁入组件以明确中文 props 或默认文本替代 `t(...)`，避免复制上游完整词典和初始化。

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

实际安装版本与固定上游一致。未引入 Electron、Craft Core/Shared、i18next 或 diff；R4-06 将必要批注运行时按文件复制到本地，未引入 Craft 运行时包。

## R4-02 报告与下游接口确认

`src/web/craft/components/PreviewHeader.tsx` 保留上游预览头的三栏结构与 Badge，移除 Electron 窗口占位，以 `leftActions/rightActions/onClose` 接浏览器返回、下载及关闭；`DocumentFormattedMarkdownOverlay.tsx` 保留文档卡 JSX，以 `renderMarkdown` 接安全渲染，`beforeContent/afterContent` 接现有版本批注。#48 已由 `AnnotatableMarkdownDocument` 直接拥有选区入口。`WorkPreview.tsx` 仍拥有 Task/Version 加载、锁定、下载和本机批注状态。

#44 已实测 React 18、Tailwind、真实 ActivityItem DTO 和版本报告 props；#45—#49 已分别接入外壳与主题、完整输入与活动、Task/Interaction、报告批注和设置组件。核心浏览器已完成工具详情、报告打开/下载/Esc 返回；全部页面与正式环境最终验收归 #50。

## R4-06 实际迁入：报告批注

固定来源：Craft Agents OSS `v0.13.3` / `e8963854c3679edcceb105a42537a06749e6cb64`，Apache-2.0。

| 本地源码 | 固定上游路径 | 保留内容 | 必要适配与裁剪 |
| --- | --- | --- | --- |
| `src/web/craft/components/AnnotatableMarkdownDocument.tsx` | `packages/ui/src/components/overlay/AnnotatableMarkdownDocument.tsx` | selection/controller、DOM offset、position+quote selector、覆盖层几何、chip、Island 状态和恢复 | Markdown 改为调用本地安全 renderer；增删改接布尔回执；写批注前先将稳定 UUID 存入 Version 草稿，存储失败时不写批注，重试按同一 UUID upsert；恢复时从精确 DOM Range 取锚点；删除依赖 Craft block 标记的 shift-click |
| `src/web/craft/components/annotations/AnnotationIslandMenu.tsx`、`Island.tsx`、`IslandFollowUpContentView.tsx` | 同名 `packages/ui/src/components/annotations` 与 `packages/ui/src/components/ui` 文件 | 原 Island motion、视图切换、编辑/查看/删除和 textarea 高度计算 | 中文替代 i18n；裁掉产品未提供的“保存并发送”下拉；补 IME Escape 保护和视口纵向约束；A 右侧预览使用 body portal，使 Island 与原 blocker 处于同一层叠上下文 |
| `src/web/craft/components/annotations/*.ts(x)` | `packages/ui/src/components/annotations/*`、`packages/ui/src/components/markdown/annotation-resolver.ts` | controller、reducer、selection restore、overlay geometry、interaction/dismiss policy | `AnnotationV1` 采用固定上游结构的本地类型；Tooltip 改为原生 title；resolver 要求 position 与 quote 同时一致，重复 quote 无唯一上下文时不定位 |

`src/web/ReviewAnnotations.ts` 是业务适配边界，继续拥有 Task/Version、本地存储和 reviewBridge 身份。`WorkPreview.tsx` 只把原文已确认的批注交给覆盖层，失效引用仍保留在列表与改稿命令中。完整自动与浏览器验证见 `docs/evidence/r4-06.md`。

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

已删除被上述组件替代的 `src/web/quick-actions.css`，并从 `src/web/composer.css` 删除 textarea、旧发送按钮和旧控制行规则；`src/web/style.css` 的孤儿 `.tool-activity*` 已删除。StableScroll 继续保留本地阅读位置逻辑，其“回到最新内容”入口已改用迁入的 Button。

## R4-03 实际迁入：外壳与主题

固定来源：Craft Agents OSS `v0.13.3` / `e8963854c3679edcceb105a42537a06749e6cb64`。

## Panel

原路径：`apps/electron/src/renderer/components/app-shell/Panel.tsx:24-67`。

```tsx
export interface PanelProps {
  variant?: 'shrink' | 'grow'
  width?: number
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

className={cn(
  'h-full flex flex-col min-w-0 overflow-hidden',
  variant === 'grow' && 'flex-1',
  variant === 'shrink' && 'shrink-0',
  className,
)}
```

本地保留 sizing、class 合并和 JSX 容器；增加 `as` 以继续输出浏览器 `aside/main` landmark。A 的 252px 网格仍由 `style.css` 决定。

## SidebarButton

原路径：`apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx:456-593`。

```tsx
className={cn(
  'group flex w-full items-center gap-2 rounded-[6px] text-[13px] select-none outline-none',
  'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
  link.compact ? 'py-[3px]' : 'py-[5px]',
  'px-2',
  link.variant === 'default'
    ? 'bg-foreground/[0.07]'
    : 'hover:bg-sidebar-hover',
)}
```

本地保留图标、标题、label、active/ghost 与焦点结构；导航根元素改为 `a`，保留直接链接、刷新、浏览器历史与新标签页。未迁入 expandable、DnD、context menu、sortable 分支。

## Empty

原路径：`apps/electron/src/renderer/components/ui/empty.tsx:5-104`。

```tsx
<div data-slot="empty" className={cn(
  'flex min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg p-6 pb-[20%] text-center text-balance',
  className,
)} />
```

本地保留 `Empty/Header/Media/Title/Description/Content` 的 data-slot 与组合结构；中文内容由调用方传入。

## 主题

原路径：`apps/electron/src/renderer/index.css:66-180,250-311,386-460`。

```css
--background: oklch(0.98 0.003 265);
--foreground: oklch(0.185 0.01 270);
--accent: oklch(0.62 0.13 293);
--info: oklch(0.75 0.16 70);
--success: oklch(0.55 0.17 145);
--destructive: oklch(0.58 0.24 28);
```

本地保留六色与 Shadcn 派生 token；继续用 `data-theme` 表达浅色、深色和跟随系统，使用自托管 Inter，并在字体栈中保留中文系统回退。


## R4-05 实际迁入：工作与待办组件

固定来源：Craft Agents OSS `v0.13.3` / `e8963854c3679edcceb105a42537a06749e6cb64`，Apache-2.0。许可与归属见 `licenses/CRAFT-APACHE-2.0.txt` 和 `licenses/CRAFT-NOTICE.txt`。

| 本地源码 | 固定上游源码 | 保留内容 | 必要适配与裁剪 |
| --- | --- | --- | --- |
| `src/web/craft/components/EntityRow.tsx` | `apps/electron/src/renderer/components/ui/entity-row.tsx:46-148,266-421` | icon、title、subtitle、badges、trailing、children、选中条和主表面 JSX | 主表面在有 `href` 时输出浏览器链接，保留新标签页和复制链接；裁掉 Craft dropdown/context menu、长按和多选状态依赖。children 仍位于主表面外，成果链接与快捷按钮不会嵌套进链接 |
| `src/web/craft/components/StatusBadge.tsx` | `apps/electron/src/renderer/components/app-shell/kanban/StatusBadge.tsx:4-48` | 圆点、淡色药丸、label、live ping 与原 class/style 结构 | `SessionStatus.resolvedColor` 改为调用方传入 `{label,color}`；`WorkStatus.tsx` 把真实 Run/Interaction 状态映射到中文，工作 `running` 显示“执行中” |
| `src/web/craft/components/PermissionRequest.tsx` | `apps/electron/src/renderer/components/app-shell/input/structured/PermissionRequest.tsx:8-109` | info 背景、边框/阴影、ShieldAlert 标题、滚动正文和固定动作区 | Craft permission DTO、i18n 和 Allow/Always Allow/Deny 回调改为 Task/Run/Interaction 身份、问题/额度文案及既有回答回调；动作区复用已迁入 ActionBar/Button |
| `src/web/craft/components/Textarea.tsx` | `apps/electron/src/renderer/components/ui/textarea.tsx:1-18` | `data-slot`、边框/焦点/无效/禁用状态、field sizing 和全部 JSX | 把 `cn` 改为相对 import；为 React 18 显式 `forwardRef`，供键盘选区读取原生选择范围；全局 CSS 排除 `[data-slot="textarea"]`，避免旧表单规则覆盖原组件 |
| `src/web/EmptyStateCard.tsx` | `apps/electron/src/renderer/components/ui/empty.tsx:5-104` | 使用已迁入的 Empty/EmptyHeader/EmptyMedia/EmptyTitle/EmptyDescription 组合 | 保留本地中文 title/description 接口并增加可替换 icon；删除旧近似空态 DOM |

`Work.tsx` 使用上述组件和 R4-03/R4-07 已迁入的 Button、Empty、Input、Label、Select、LoadingIndicator、UserMessageBubble。Task/Run/Interaction/Artifact DTO、API 路径、幂等 requestId/commandId 和生命周期继续由 AgentAnywhere 业务层管理。`Steward.tsx`、`StewardReceipts.tsx` 与 `main.tsx` 只把持久工作投影组合进 EntityRow；精确命令生成仍在 `QuickActions.tsx`，点击只填草稿。

完整 Craft `TaskTile.tsx` 依赖 Kanban/Jotai/子任务/模型状态机，其前提与本产品持久 Task/Run 不同，因此没有迁入。这里是业务边界适配，不是重写原 EntityRow、StatusBadge 或 PermissionRequest。


## R4-07 实际迁入：模型设置、登录与账户

以下源码固定来自 Craft Agents OSS `v0.13.3`、commit `e8963854c3679edcceb105a42537a06749e6cb64`。所有本地文件保留原路径、版权和 Apache-2.0 说明。

| 本地组件 | 固定上游源码 | 实际适配 |
| --- | --- | --- |
| `src/web/craft/components/Input.tsx:1-21`、`Label.tsx:1-19`、`Badge.tsx:1-28`、`Switch.tsx` | `apps/electron/src/renderer/components/ui/input.tsx:1-22`、`label.tsx:1-22`、`badge.tsx:1-39`、`switch.tsx:1-31` | 保留 JSX、`data-slot`、forwardRef 和变体；仅改相对 import，Badge 的 destructive 文本接现有主题。 |
| `src/web/craft/components/Select.tsx:1-56` | `apps/electron/src/renderer/components/ui/select.tsx:1-167` | 保留 Radix Root/Trigger/Portal/Viewport/Item 与滚动按钮；将上游全局 `popover-styled`、`z-dropdown` 改为组件内等价主题类。 |
| `src/web/craft/components/SettingsSection.tsx:1-39`、`SettingsCard.tsx:1-24`、`SettingsRow.tsx:1-22` | `components/settings/SettingsSection.tsx:14-117`、`SettingsCard.tsx:11-86`、`SettingsRow.tsx:12-104` | 保留分组、卡片分隔、行标签/说明/动作结构；改相对 import。SettingsCard 接收原生 div 属性，供主题分组传入 aria。 |
| `src/web/craft/components/SettingsInput.tsx:1-50`、`SettingsSelect.tsx:1-34`、`SettingsUIConstants.ts:1-14` | `components/settings/SettingsInput.tsx:16-304`、`SettingsSelect.tsx:20-179`、`SettingsUIConstants.ts:7-22` | 保留输入、密钥显隐、行内选择及样式常量；增加现有表单需要的 name/autocomplete/required/autofocus，并为密钥显隐补键盘名称。Select 触发器显式关联可见标签和说明。中文占位为本地文案适配。 |
| `src/web/craft/components/SettingsToggle.tsx` | `components/settings/SettingsToggle.tsx:13-80` | 保留原 Settings 行、label、description 与 Switch 组合；人工调研模型池使用受控 `checked/onCheckedChange`，替代旧原生 checkbox。 |

`src/web/ModelSettings.tsx:126-204` 用上述原组件组合现有单连接、管家模型、调研模型池、协议和能力字段。`main.tsx:44-53,56-95,182-188` 将主题、登录和账户区接入同一组件组。没有迁入 Craft 的多连接、OAuth、Workspace、Jotai 或 Electron 状态机；没有重写例外。

新增依赖严格使用固定上游版本：`@radix-ui/react-label 2.1.8`、`@radix-ui/react-select 2.2.6` 和 `@radix-ui/react-switch 1.2.6`。

R4 正式视觉复核补充：固定上游通过 Tailwind 4.1.18 Preflight 重置原生控件；本地为保留 A 外壳而不启用全局 Preflight，因此 `craft/styles.css` 只对已迁入的原生 button slots 补齐 appearance、margin、border、background、color 与字体继承基线。
