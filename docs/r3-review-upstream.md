# R3 报告批注上游来源

本次适配核对 Craft `v0.13.3` 固定提交 `e8963854c3679edcceb105a42537a06749e6cb64`。上游使用 Apache-2.0 许可；完整许可见固定源码根目录的 `LICENSE`。

| 本地实现 | 上游原路径 | 保留内容 | Web 适配 |
| --- | --- | --- | --- |
| `src/web/WorkPreview.tsx`、`ReviewAnnotations.ts` | `packages/ui/src/components/overlay/AnnotatableMarkdownDocument.tsx` | 从报告正文选区创建批注，保存引用和意见，查看及删除未发送批注 | 使用浏览器原生 `Selection`/`Range` 生成文本引用和固定偏移；移除 Craft Core 注解实体、浮岛状态机、Portal、Motion 和 Electron 会话命令依赖 |
| 报告正文和选区入口 | `packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx` | 将可批注层绑定到当前文档身份，保持格式化 Markdown 阅读 | 继续使用 AgentAnywhere 的安全 `ReportMarkdown`；身份固定为 Task UUID 与不可变报告 Version UUID，引用不参与服务端授权 |
| 批注汇总与发送恢复 | `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` 的 follow-up 汇总 | 多条批注进入输入框，发送后按持久身份标记，编辑后的实际消息决定哪些批注已提交 | 汇总生成现有改稿完整命令；Composer 持久化批注快照和请求 ID，服务端接受后才按 ID、版本、更新时间及实际消息块清理 |

批注草稿仅存当前浏览器的 `localStorage`，按工作与报告版本隔离。选区只按保存时的固定偏移复核；偏移失效时保留原引用并显示无法定位，不搜索相似文本或迁移到新版。正式改稿仍使用既有管家改稿授权、稳定回执和原 Task 新 Run，不引入服务端批注状态。
