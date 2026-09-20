# R3 活动流上游来源

本次适配核对 Craft `v0.13.3` 固定提交 `e8963854c3679edcceb105a42537a06749e6cb64`。上游使用 Apache-2.0 许可；完整许可见固定源码根目录的 `LICENSE`。

| 本地实现 | 上游原路径 | 保留内容 | Web 适配 |
| --- | --- | --- | --- |
| `src/web/ActivityFeed.tsx` 的工具卡 | `packages/ui/src/components/chat/TurnCard.tsx` | 工具名称、运行/完成/失败阶段、简短摘要、展开详情；完成和错误状态来自真实工具结果 | 使用原生 `details`，移除 Tailwind、Radix、Lucide、Motion 和 Electron 详情面板依赖；参数与完整结果按本项目持久事件展示 |
| 管家按轮展示 | `packages/ui/src/components/chat/turn-utils.ts`、`packages/ui/src/components/chat/TurnCard.tsx` | 将消息和工具活动归入同一轮次，失败状态留在所属轮次 | 直接使用 AgentAnywhere 的 `turnId` 和稳定操作回执，不推断或补造旧数据 |
| 用户与助手消息层级 | `packages/ui/src/components/chat/UserMessageBubble.tsx`、`packages/ui/src/components/chat/TurnCard.tsx` | 用户消息和助手回复的视觉区分，活动位于同一轮上下文 | 保留现有安全 Markdown 渲染和服务端状态语义 |
| 阅读位置 | `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | 对话内容独立滚动，阅读历史时保持当前位置 | 按对话或 Run 存入浏览器 `sessionStorage`；仅位于底部时跟随新内容，并提供“回到最新内容”按钮 |

本地代码没有复制上游桌面运行时、模拟数据、任务树、文件编辑详情或其他平台能力。活动事实分别来自 `steward_events` 与工作 Run 事件；升级前没有工具事件的历史轮次保持为空。
