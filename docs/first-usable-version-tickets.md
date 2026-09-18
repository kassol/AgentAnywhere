# 首个可用版本：实施任务索引

规格：[Spec #3](https://github.com/kassol/AgentAnywhere/issues/3)。14 张任务及以下依赖经用户确认；正文与实时状态以 GitHub Issues 为准。每张票已标记 `ready-for-agent`，19 条依赖已使用 GitHub 原生阻塞关系建立。

| 顺序 | 任务 | 直接阻塞项 | 规格验收覆盖 |
| --- | --- | --- | --- |
| 01 | [#4 登录并进入精简工作台](https://github.com/kassol/AgentAnywhere/issues/4) | 无 | T01、T16 |
| 02 | [#5 配置模型连接并发现模型](https://github.com/kassol/AgentAnywhere/issues/5) | [#4](https://github.com/kassol/AgentAnywhere/issues/4) | T01、T02 |
| 03 | [#6 补全模型元信息](https://github.com/kassol/AgentAnywhere/issues/6) | [#5](https://github.com/kassol/AgentAnywhere/issues/5) | T04 |
| 04 | [#7 创建工作并持久保存待执行请求](https://github.com/kassol/AgentAnywhere/issues/7) | [#5](https://github.com/kassol/AgentAnywhere/issues/5) | T08（创建部分）、T14（持久部分） |
| 05 | [#8 在真实沙箱执行首个工作](https://github.com/kassol/AgentAnywhere/issues/8) | [#7](https://github.com/kassol/AgentAnywhere/issues/7) | T03（Chat Completions）、T08、T14、T15（Worker） |
| 06 | [#9 打通 Responses 工作执行](https://github.com/kassol/AgentAnywhere/issues/9) | [#8](https://github.com/kassol/AgentAnywhere/issues/8) | T03（Responses） |
| 07 | [#10 保存、阅读和下载报告](https://github.com/kassol/AgentAnywhere/issues/10) | [#8](https://github.com/kassol/AgentAnywhere/issues/8) | T01（成果）、T12、T13（保存失败）、T15（预览） |
| 08 | [#11 通过私有 SearXNG 完成真实调研](https://github.com/kassol/AgentAnywhere/issues/11) | [#10](https://github.com/kassol/AgentAnywhere/issues/10) | T05、T15（网络）、T17（搜索部署） |
| 09 | [#12 执行中追加要求](https://github.com/kassol/AgentAnywhere/issues/12) | [#8](https://github.com/kassol/AgentAnywhere/issues/8) | T06、T14 |
| 10 | [#13 提问、释放沙箱并恢复工作](https://github.com/kassol/AgentAnywhere/issues/13) | [#10](https://github.com/kassol/AgentAnywhere/issues/10)、[#12](https://github.com/kassol/AgentAnywhere/issues/12) | T07、T08（等待让位）、T14 |
| 11 | [#14 取消工作并停止后台动作](https://github.com/kassol/AgentAnywhere/issues/14) | [#8](https://github.com/kassol/AgentAnywhere/issues/8) | T09、T03（取消） |
| 12 | [#15 故障恢复与执行上限](https://github.com/kassol/AgentAnywhere/issues/15) | [#13](https://github.com/kassol/AgentAnywhere/issues/13)、[#14](https://github.com/kassol/AgentAnywhere/issues/14) | T10、T11 |
| 13 | [#16 完成后继续工作并保留报告版本](https://github.com/kassol/AgentAnywhere/issues/16) | [#10](https://github.com/kassol/AgentAnywhere/issues/10) | T13 |
| 14 | [#17 部署并验收首版完整闭环](https://github.com/kassol/AgentAnywhere/issues/17) | [#6](https://github.com/kassol/AgentAnywhere/issues/6)、[#9](https://github.com/kassol/AgentAnywhere/issues/9)、[#11](https://github.com/kassol/AgentAnywhere/issues/11)、[#15](https://github.com/kassol/AgentAnywhere/issues/15)、[#16](https://github.com/kassol/AgentAnywhere/issues/16) | T01—T17 |

## 执行规则

- 从所有阻塞项已完成的票中领取任务。发布时只有 #4 可立即开始；ready-for-agent 不表示依赖已满足。
- 每张票在独立上下文执行 implement，读取父规格和直接阻塞票的完成证据。界面、API、持久化及测试按本票行为贯通。
- 模型元信息补全与基础执行可独立推进；Responses 与取消在最终发布票合流验证双协议矩阵。
- #1 继续记录 W0 保留环境回收；#2 为已纳入规格的模型需求来源，不另外启动重复实现。
- 父规格 #3 的正文、标签、状态和评论均保持不变；每张子任务正文引用父规格，原生阻塞关系仅建立在实施票之间。

## 发布核验

2026-09-18：逐票读回确认 14 张 Issue 正文与发布草稿一致、标签正确、19 条原生直接依赖符合批准图，父规格未变。此记录证明任务已发布，不表示产品实现或测试已完成。
