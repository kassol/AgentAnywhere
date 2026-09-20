# R3 工作与报告预览上游提取记录

本次预览交互固定核查 Craft Agents OSS `v0.13.3`、提交 `e8963854c3679edcceb105a42537a06749e6cb64`。上游采用 Apache-2.0；版权声明为 `Copyright 2026 Craft Docs Ltd.`。完整许可文本已保存在 [`licenses/CRAFT-APACHE-2.0.txt`](../licenses/CRAFT-APACHE-2.0.txt)。

| 本地文件 | 上游原路径 | 提取内容 | 本地改动 |
| --- | --- | --- | --- |
| `src/web/WorkPreview.tsx` | `packages/ui/src/components/ui/PreviewHeader.tsx` | 居中标题、右侧关闭动作和紧凑预览工具栏 | 移除 Electron 交通灯、`react-i18next`、Lucide 与 `cn`；增加小屏“返回对话”及独立工作链接 |
| `src/web/WorkPreview.tsx`、`src/web/work-preview.css` | `packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx` | 独立滚动容器、16px 文档卡、窄阅读宽度及安全 Markdown 阅读面 | 改为工作台右栏；正文沿用本项目 `ReportMarkdown`；按 Task/报告版本读取并恢复位置；预留带 `data-task-id`、`data-report-version` 的真实报告容器 |

上游完整预览依赖 `FullscreenOverlayBase`、Portal、Tailwind、Motion、Lucide、`react-i18next`、`@craft-agent/core`、Markdown 渲染器和批注控制器。本地不新增运行依赖，也不移植 Electron 全屏窗口、复制、文件打开或批注状态。预览只调用现有只读 Task 与 Artifact API；报告批注由后续任务在真实报告容器上实现。
