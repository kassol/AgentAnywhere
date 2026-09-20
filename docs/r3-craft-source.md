# R3 Craft 提取记录

正式界面固定核查 Craft Agents OSS `v0.13.3`、提交 `e8963854c3679edcceb105a42537a06749e6cb64`。上游采用 Apache-2.0，版权声明为 `Copyright 2026 Craft Docs Ltd.`；完整许可见 [`licenses/CRAFT-APACHE-2.0.txt`](../licenses/CRAFT-APACHE-2.0.txt)。

## R3-01 工作台与主题

| 本地内容 | 上游原路径 | 保留内容 | 本地适配 |
| --- | --- | --- | --- |
| `src/web/craft-theme.css` | [`apps/electron/src/renderer/index.css`](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/apps/electron/src/renderer/index.css) | 亮暗背景、前景、紫色强调色、前景混色边框与克制阴影 | 缩减为浏览器所需变量；增加侧栏、选中项和可见焦点语义；用 `data-theme` 选择主题 |
| `src/web/style.css` 的应用外壳 | 同上；A 结构来源于已确认原型 | 中性表面、细边框、低层级阴影及 16px 圆角体系 | 连接现有管家、工作、待办和设置路由；桌面采用经典侧栏，小屏改为顶部导航 |

上游主题文件依赖 Tailwind、Shadcn 兼容变量及 Electron renderer 全局样式；应用外壳还绑定桌面窗口和工作区状态。R3-01 只提取与当前 Web 外壳有关的主题值和表面规则，不引入 Tailwind、Electron API 或上游状态模型。导航图标使用本地 SVG，主题选择使用浏览器 `matchMedia` 与 `localStorage`，运行时新增依赖为零。

原型中的 A/B/C 切换器、预置对话、模拟失败、调试状态和演示网关未进入正式代码。输入框、消息工具卡、报告预览和分层设置已按各自任务核查固定提交；对应提取范围与本地修改记录见各组件的上游记录。
