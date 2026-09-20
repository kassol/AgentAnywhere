# R3 输入框上游提取记录

本次输入交互固定核查 Craft Agents OSS `v0.13.3`、提交 `e8963854c3679edcceb105a42537a06749e6cb64`。上游采用 Apache-2.0；版权声明为 `Copyright 2026 Craft Docs Ltd.`。完整许可文本已保存在 [`licenses/CRAFT-APACHE-2.0.txt`](../licenses/CRAFT-APACHE-2.0.txt)。

| 本地文件 | 上游原路径 | 提取内容 | 本地改动 |
| --- | --- | --- | --- |
| `src/web/Composer.tsx` | `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` | Enter 发送、Shift+Enter 换行、输入法组合期间不发送 | 使用原生 textarea 与 form；移除富文本、附件、模型选择、命令菜单、Electron API 和用户可配发送键 |
| `src/web/composer.css` | `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` | 16px 圆角输入容器、背景与细边阴影 | 改用本项目主题变量；保留原生可调整高度；增加小屏底部可达处理 |

上游完整输入链依赖 `@craft-agent/ui`、workspace 状态、Motion、Jotai、Radix、Lucide、Tailwind、富文本编辑器及 Electron 平台接口。本地实现不新增运行依赖。草稿与提交幂等使用 AgentAnywhere 的 Thread、管家轮次及公开 API 语义，不移植上游会话状态模型。
