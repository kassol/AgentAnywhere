---
name: AgentAnywhere
description: Self-hosted personal delegated workbench inheriting Craft Agent v0.13.3 visual craft
colors:
  primary: "#674e84"
  neutral-bg: "#faf9fa"
  neutral-fg: "#26242a"
  accent: "#674e84"
  info: "#b47828"
  success: "#368c4a"
  destructive: "#c63d29"
  border: "rgba(38, 36, 42, 0.08)"
  border-strong: "rgba(38, 36, 42, 0.16)"
  muted: "rgba(38, 36, 42, 0.50)"
typography:
  display:
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.01em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "#553e70"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-fg}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-ghost-hover:
    backgroundColor: "rgba(38, 36, 42, 0.06)"
---

# Design System: AgentAnywhere (Craft Agent v0.13.3)

## Overview

**Creative North Star: "The Restrained Editorial Workbench"（克制严谨的编辑工作台）**

AgentAnywhere 的视觉设计全盘继承自 **Craft Agents OSS (v0.13.3)** 的设计哲学与组件底座。它摒弃喧嚣、浮夸的渐变与过度装饰，以高密度、高信息秩序感与精细的微交互呈现专业级桌面工作台质感。界面专注于将用户的认知负荷降到最低，让长时间阅读调研报告、审阅审计轨迹与进行原位批注成为一种宁静、流畅且富有确定性的体验。

整体界面建立在“清晰的层级”、“细腻的色调叠加（Tonal Layering）”与“精准的原语组件”之上。每一个元素都承担明确的功能含义：状态圆点与药丸指示真实运行态，圆角输入表面承载纯文本与快捷操作，悬浮的 Island 浮岛为选区批注提供零跳转的原地编辑体验。

**Key Characteristics:**
- **克制严整**：大面积中性色表面、极窄精致边框与低对比度背景，单色强调（Accent）使用极为节制。
- **排版至上**：自托管 Inter 配合精心调校的 OpenType 字形特性（`cv01`, `cv02`, `cv03`, `cv04`, `case`），中文自然回退，行间距与阅读宽度经过严格考量。
- **色调分层而非重阴影**：依靠背景与前景的微调混色（`--foreground-2%`, `5%`, `7%`, `10%`）建立层次，拒绝大面积脏污阴影。
- **连续性阅读流**：A 三段式外壳（252px 侧栏 + 800px 任务流 + 620px 待办区），去除卡片包裹感，形成连贯自然的专业阅读动线。

## Colors

调色体系以 OKLCH 色彩空间构建，兼具完美的感知一致性与原生明暗主题适配能力。

### Primary & Accent
- **Craft Editorial Violet** (`oklch(0.62 0.13 293)` / `#674e84`)：核心强调色，仅在主操作按钮（发送、确认）、活跃选中状态及关键锚点指示时使用。在深色模式下自适应调整为 `oklch(0.65 0.22 293)` 以保证视觉对比度。

### Functional Accents
- **Info Amber** (`oklch(0.75 0.16 70)` / `#b47828`)：用于权限请求、待办交互警告与等待用户输入的警示场景。
- **Success Forest** (`oklch(0.55 0.17 145)` / `#368c4a`)：用于已完成状态、校验通过标记与健康状态指示。
- **Destructive Crimson** (`oklch(0.58 0.24 28)` / `#c63d29`)：用于删除、失败提示、取消操作与危险操作警示。

### Neutral & Tonal Hierarchy
- **Canvas Background** (`oklch(0.98 0.003 265)` / 深色: `oklch(0.145 0.015 270)`)：主画布与面板表面。
- **Elevated Sidebar** (`color-mix(var(--foreground) 1.5%, var(--background))`): 侧栏与次级分栏的微弱抬升背景。
- **Foregound Stack**:
  - `Foreground`: 100% 正文字体色。
  - `Foreground-Dimmed`: 80% 次级正文与说明文本。
  - `Muted / Foreground-50`: 50% 弱化标签与图标色。
  - `Selected / Foreground-10`: 选中项底色。
  - `Hover / Foreground-7`: 悬停态反馈底色。
  - `Subtle / Foreground-5`: 弱分隔底色与气泡背景。
- **Border**: `oklch(from var(--foreground) l c h / 0.05)`（常规极细边框）与 `0.12`（强对比边框）。

### Named Rules
**The Restrained Accent Rule.** 强调色（Accent Violet）在单个视图中的视觉面积占比严禁超过 5%。强调色的唯一目的是指引视线落点与明确主操作，而不是作为装饰填充。
**The Semantic State Rule.** 严禁随意变换状态语义色彩；执行中固定使用动态 Spinner，成功固定 Forest，失败固定 Crimson，等待用户确认固定 Amber。

## Typography

**Display / Interface Font:** Inter (开启 `font-feature-settings: 'cv01', 'cv02', 'cv03', 'cv04', 'case'`)  
**Chinese Fallback:** 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif  

**Character:** 精密、清晰、高保真。字形线条明快，小字号下字怀开阔，大段代码与技术报告具有极佳的辨识度与阅读愉悦感。

### Hierarchy
- **Display** (600, 20px, 1.3): 页面主标题（如独立报告大标题、全屏工作预览页头）。
- **Headline** (600, 16px, 1.4): 章节小标题、卡片组标题、设置分类标题。
- **Title** (500, 14px, 1.4): 对话轮次角色名、工作项短标题、导航项标题。
- **Body** (400, 13px, 1.55): 默认正文文本、Markdown 报告阅读正文、管家回复。正文最大阅读宽度控制在 65~75ch（约 800px）。
- **Label / Meta** (500, 12px, 1.3, letter-spacing: 0.01em): 状态标签（StatusBadge）、时间戳、快捷动作按钮文本、输入计数器。
- **Micro** (600, 10px, 1.0): 专用于行内极小角标与高亮批注序号 Chip（如 AnnotationOverlayLayer）。

### Named Rules
**The Native CJK Integration Rule.** 中文字段继承与英文字符完全相同的行高与字重阶梯，严禁为中文单独重写非对称的行距或打破垂直节奏。

## Layout

**A 三段式工作台空间网格：**
- **侧栏导航（Left Sidebar）**：固定 252px 宽度，紧凑排列主导航、管家对话列表与底端系统设置。
- **任务与对话流（Main Reading Stream）**：居中限制宽度 800px，保持最佳阅读视距，去除外部多余卡片包边，呈现开阔连续的文字瀑布流。
- **待办与交互区（Pending Interactions）**：限制宽度 620px，垂直紧凑排列权限与追问卡片。
- **报告全屏/侧滑层（Document Overlay）**：占满可用主内容区，配备顶部 48px 工具栏（PreviewHeader），左侧返回/关闭，右侧版本切换与下载。

## Elevation & Depth

**Tonal Layering Over Drop Shadows（色调分层胜于投影）：**
系统以无阴影为常态（Flat at rest）。深浅层次主要通过背景颜色的细微明度差异（`background-elevated`）和 1px 极细边框（`var(--border)`）来界定，保持视线清爽通透。

### Shadow Vocabulary
- **Shadow Minimal** (`0 0 0 1px rgba(var(--foreground-rgb), .07), 0 1px 2px var(--shadow)`): 用于按钮悬停与轻微浮动组件。
- **Shadow Tinted** (`.shadow-tinted` 多段混合色调阴影): 用于悬浮 Island 批注菜单与弹窗，根据 `--shadow-border-opacity` 自适应明暗主题微光。

## Shapes

- **6px (Default Radius)**：核心交互组件的基础圆角（Button, SidebarButton, Badge, Input, SelectTrigger）。
- **8px (Container Radius)**：卡片、输入容器外框（FreeFormInput 表面）、下拉浮层。
- **12px ~ 16px (Surface Radius)**：批注浮岛（Island）、覆盖层容器。

## Components

所有组件严格沿用 `src/web/craft/components/` 迁入的原组件源码与契约：

### Button (`data-slot="button"`)
- **Shape:** 6px 圆角。
- **Variants:** Primary（强调紫底白字）、Secondary（次级轻底色）、Ghost（透明悬浮态）、Destructive（危险红）。
- **Size:** default (h-8 px-3 text-xs), sm (h-7 px-2 text-xs), icon (h-8 w-8)。

### FreeFormInput & RichTextInput
- **Shape:** 8px 圆角容器，内置纯文本 contenteditable 输入区与底部控制行。
- **Behavior:** 纯文本提交，支持原生 Undo/Redo，严格保护中文输入法（IME）组合状态；右下角集成发送状态与 LoadingIndicator。

### TurnCard & UserMessageBubble
- **Structure:** 轮次卡片无多余外边框，融入连续阅读流；包含折叠式活动事件详情（工具调用、参数、结果）、真实时长计数与回复卡。
- **User Bubble:** 靠右对齐，80% 最大宽度，使用 `--user-message-bubble` 微弱底色。

### EntityRow & StatusBadge
- **EntityRow:** 统一的工作/任务列表行，左侧图标，中间标题与副标题，右侧状态药丸与快捷操作。
- **StatusBadge:** 微型状态药丸，左侧为脉冲圆点（Running 状态支持动态 ping），右侧为中文状态文本。

### AnnotatableMarkdownDocument & Island
- **Annotation:** 在报告原文选区上浮现 Island 胶囊菜单，输入评注即时保存稳定 UUID 草稿；原文行内生成精确高亮覆盖层。

### Settings UI (Section / Card / Row / Toggle / Select)
- **Settings:** 标准两栏/分组表单，卡片式分隔，行内整合标签、说明、Toggle 开关与 Input 输入框。

## Do's and Don'ts

### Do:
- **Do** 优先复用 `src/web/craft/components/` 中的既有组件，保持代码库的组件同构性。
- **Do** 始终采用 `var(--background)`, `var(--foreground)`, `var(--accent)` 等 CSS 变量，确保明暗主题自动相容。
- **Do** 使用 800px 的标准阅读宽度呈现报告与长对话流，保证最佳阅读舒适度。
- **Do** 在所有异步加载与轮次等待场景中使用 Craft 统一的九宫格 LoadingIndicator (Spinner)。

### Don't:
- **Don't** 引入上游无关的 Electron 依赖、富文本/Markdown 客户端混淆库或复杂国际化包。
- **Don't** 为组件添加未经设计的深重、大范围外阴影；始终坚持使用 Tonal Layering 与极细边框建立层次。
- **Don't** 打破既有 A 外壳的 252px 导航与三段工作台网格。
- **Don't** 在没有必要的情况下使用高饱和度色彩，保持“克制严谨的编辑工作台”的核心视觉调性。
