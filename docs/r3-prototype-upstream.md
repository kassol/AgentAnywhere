# R3 原型：Craft 上游抽取记录

本原型固定使用 Craft Agents OSS `v0.13.3`、提交 `e8963854c3679edcceb105a42537a06749e6cb64`。上游为 Apache-2.0；版权声明为 `Copyright 2026 Craft Docs Ltd.`。仓库已保留完整许可文本：[`licenses/CRAFT-APACHE-2.0.txt`](../licenses/CRAFT-APACHE-2.0.txt)。

## 抽取内容

| 本地内容 | 上游原路径 | 保留内容 | 本地改动 |
| --- | --- | --- | --- |
| `CraftSpinner` | [`packages/ui/src/components/ui/LoadingIndicator.tsx`](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/packages/ui/src/components/ui/LoadingIndicator.tsx) | 3×3 方块结构、`currentColor` 与 1.3 秒交错动画 | 移除 `react-i18next` 和 `cn`；用中文默认 `aria-label`；加上减少动态效果规则 |
| `CraftSurface kind="input"` | [`apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx#L1572-L1583) 与 [`InputContainer.tsx`](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx) | 16px 圆角、背景和 `shadow-middle` | 只保留无状态容器；由原型自行放置 textarea、工具栏和发送按钮 |
| `CraftSurface kind="tool"` | [`apps/electron/src/renderer/index.css`](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/apps/electron/src/renderer/index.css) 与 [`packages/ui/src/components/chat/TurnCard.tsx`](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/packages/ui/src/components/chat/TurnCard.tsx) | 8px 圆角、`shadow-minimal` 的 1px 环线及工具状态使用 spinner 的方式 | 这是从上游 token 和活动行用法组合出的原型容器，不声称逐行移植某个工具卡组件 |
| `craft-primitives.css` | [`apps/electron/src/renderer/index.css`](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/apps/electron/src/renderer/index.css) | renderer 的亮暗背景、前景、强调/提示/成功/失败色，边框与两档阴影 | 全部改为 `--craft-*` 并限制在 `.craft-prototype`，避免污染现有页面 |

## 为什么没有整包搬入

固定提交的 `@craft-agent/ui` 除 React 外还依赖两个 workspace 包、`react-i18next`、Tailwind、Motion、Jotai、Radix、Lucide、KaTeX、Shiki 和多种文档渲染库。完整输入链还引用富文本编辑器、附件、模型选择、工作区状态、Electron API 和后台任务状态。当前项目没有这些依赖，整包引入会把桌面产品状态模型一并带入。

本次只保留两个原型原语和其真实来源 token；运行时新增依赖为零。它们位于 `src/web/prototype-craft/`，只供 R3 可操作原型判断界面方向。
