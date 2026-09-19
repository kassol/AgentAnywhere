# R3：Craft 交互复用与界面完善

状态：2026-09-20 grill-with-docs 访谈完成；Q1—Q13 及交互规则已整体确认。用户已选择 A 经典侧栏原型为基准，并要求进入 to-spec；正式功能尚未实现。

## 背景与基线

R2 已完成发布，验证证据见 [R2-12](evidence/r2-12.md)。当前界面仅明确移植空状态卡及部分样式，见 `src/web/EmptyStateCard.tsx`、`src/web/style.css`；管家、工作详情和模型设置主要为本地实现。原定复用要求见 [PRD 第 13 节](PRD.md#13-craft-复用与裁剪原则)。

## 已确认决定

| 问题 | 决定 |
| --- | --- |
| Q1 体验目标 | 尽量还原 Craft 的布局、消息流、输入框、工具卡和预览，按本项目管家与工作领域调整。实际组件复用范围须核查上游依赖后确定。 |
| Q2 功能边界 | 本轮完善现有管家、工作、待办、报告和设置体验；允许必要的快捷操作及少量后端支持。新增附件能力、浏览器接管等另行定义。 |
| Q3 界面组织 | 在管家对话中打开关联工作或报告时，保留中间对话，右侧按需展示详情或报告，保留独立页面链接。 |
| Q4 快捷操作 | 大部分操作优先填入聊天框，由用户发送；报告批注按 Q10、Q12、Q13 的已确认流程处理。 |
| Q5 外观模式 | 支持明暗主题、跟随系统及手动选择，两种主题均纳入验收。 |
| Q6 过程信息 | 工具卡默认显示工具名称、阶段和简短结果，参数与完整输出按需展开；失败与待处理事项醒目呈现。 |
| Q7 设置组织 | 分层设置：日常选择管家模型及调研模型池，网关凭证、能力来源和参数放到对应详情。 |
| Q8 草稿 | 当前浏览器按对话或报告版本保留草稿，切换及刷新可恢复，本轮不做跨设备同步。 |
| Q9 键盘发送 | Enter 发送，Shift+Enter 换行；中文输入法确认候选时不得发送。 |
| Q10 批注改稿 | Markdown 报告支持选中文字写意见，多条批注汇总填入聊天框，由用户确认发送；绑定原报告版本及引用文字，改稿生成新版本并保留旧版。 |
| Q11 原型 | 正式改造前先用可操作原型确认对话、工具卡、待办、右侧报告批注和设置；确认后接入真实后端。 |
| Q12 旧版批注 | 批注期间出现新版时，发送前提示；允许继续针对原版改稿或取消，不自动迁移批注。 |
| Q13 批注留存 | 聊天记录长期保留报告版本、引用与意见；预览只保留未发送草稿，本轮不建立逐条处理状态。 |

已有约束继续有效：保留 Inter；桌面优先，小屏按需折叠面板；保留服务端授权、幂等回执、历史成果和独立执行生命周期。Craft 固定基线以 PRD 为准，版本更新须单独核对。

## Craft 源码核查

固定基线 `e8963854c3679edcceb105a42537a06749e6cb64`：

- [Markdown 预览批注接口](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx#L41-L58)绑定 messageId 及增删改回调；当前项目需适配工作与报告版本身份。
- [会话批注保存](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/packages/server-core/src/sessions/SessionManager.ts#L5471-L5528)写入消息 annotations 并持久化。R3 采用已确认的本机草稿与聊天留存边界。
- [引用及意见格式化](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.ts#L42-L66)及[发送链路](https://github.com/craft-ai-agents/craft-agents-oss/blob/e8963854c3679edcceb105a42537a06749e6cb64/apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx#L1222-L1265)将待发送批注追加到用户消息，再调用 onSendMessage；批注本身不直接改文件。

## 已整体确认的交互与验收规则

- 沿用现有管家首页、独立工作入口及领域关系；右侧切换不丢失中间对话草稿和阅读位置。小屏切为单面板，保留返回路径。
- 快捷操作默认生成可检查的聊天内容，用户发送后执行。停止当前回复、下载、主题切换等已有直接动作保持直接执行；取消工作与停止回复保持区分。
- 批注限现有 Markdown 报告；按原版本恢复选区。无法可靠定位时展示引用与意见，不把标记落到猜测位置。发送失败保留草稿，服务端接受消息后再清理已发送草稿。
- 用户上滚阅读时不强制滚到底部；提供返回最新内容入口。消息中的工作回执与所属轮次关联，避免按操作类型在页面末尾集中堆叠。
- 原型使用固定 Craft 基线的适用组件，先验证组件依赖及平台适配；记录原路径、许可与本地修改。当前版本差异不自动引入本轮范围。
- 原型覆盖普通讨论、调研执行、等待回答、失败恢复、报告批注改稿及设置；明暗主题、键盘和小屏均检查。最终实现复用现有后端，保留授权、幂等、恢复与成果版本回归，并经 ego-browser 验证真实流程。

原型已完成，用户确认以 A 经典侧栏为基准；原型保留在 [prototype/r3-craft-ui](https://github.com/kassol/AgentAnywhere/tree/prototype/r3-craft-ui)，选择结论提交 `75efffa`。原型用于确定设计方向，真实功能仍须逐项验收。规格已发布为 [Spec #32](https://github.com/kassol/AgentAnywhere/issues/32)，仓库副本见 [R3 Spec](r3-ui-spec.md)；任务已拆分为 #33–#40，依赖与验收映射见 [R3 任务拆分](r3-tickets.md)；首项为 #33。
