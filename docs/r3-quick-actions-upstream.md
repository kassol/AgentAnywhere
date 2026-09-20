# R3 快捷操作上游审计

## 固定基线

- 项目：Craft Agents OSS `v0.13.3`
- commit：`e8963854c3679edcceb105a42537a06749e6cb64`
- 本地只读源码：`/tmp/agentanywhere-r3/craft-upstream`
- 许可：Apache License 2.0；已核对上游 `LICENSE` 与 `NOTICE`。本轮只提取动作条和输入区的交互模式，没有复制组件源码或样式字面量。

## 实际读取与采用范围

| 上游路径 | 实际行为 | AgentAnywhere 采用内容 |
| --- | --- | --- |
| `apps/electron/src/renderer/components/chat/AuthRequestCard.tsx` | 待处理卡片底部显示紧凑主次动作；终态不再显示动作 | 快捷操作采用紧凑按钮组；上层只为当前可操作事实传入动作 |
| `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` | 输入值由上层控制；填充输入与提交回调分开 | 快捷按钮只调用 `onFill(command)`，发送继续走既有 Composer 和服务端授权解析 |
| `apps/electron/src/renderer/components/app-shell/input/FreeFormInputContextBadge.tsx` | 紧凑按钮显示标签、当前选择和可访问名称 | 每个快捷按钮同时显示动作名和短身份，完整命令写入 `title`，键盘使用原生按钮 |

## 本地边界

`QuickActions` 不读取 API、不创建管家轮次、不修改 Run、不回答 Interaction。按钮将 Task、Run、Interaction、报告版本或操作回执身份写入完整授权命令，点击后只填入 Composer。用户可检查和编辑内容，显式发送后由服务端核对指定身份、当前授权和状态；目标已被新 Run 或问题替代时拒绝执行。旧手输命令继续兼容，工作详情现有直接回答、额度决定、取消、追加和重试接口保持原语义。

未引入 Craft 的 Electron 桥接、认证卡业务、附件、富文本、Tooltip、Lucide、Tailwind 或动画依赖。实现只使用 React、原生按钮和项目主题变量。
