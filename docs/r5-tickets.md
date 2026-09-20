# R5 任务索引

规格：[Issue #51](https://github.com/kassol/AgentAnywhere/issues/51)。拆分及直接依赖已由产品所有者确认；任务正文、ready-for-agent 标签与 GitHub 原生阻塞关系已逐项回读核对。父规格保持原样。

| 任务 | 交付 | 直接阻塞 | 状态 |
| --- | --- | --- | --- |
| [R5-01 / #52](https://github.com/kassol/AgentAnywhere/issues/52) | 对话与工作改名 | 无 | 已完成 |
| [R5-02 / #53](https://github.com/kassol/AgentAnywhere/issues/53) | 自动生成短标题 | #52 | 已完成 |
| [R5-03 / #54](https://github.com/kassol/AgentAnywhere/issues/54) | A 三段工作台与会话导航 | 无 | 已完成 |
| [R5-04 / #55](https://github.com/kassol/AgentAnywhere/issues/55) | 对话阅读与工作集中入口 | #52, #54 | 已完成 |
| [R5-05 / #56](https://github.com/kassol/AgentAnywhere/issues/56) | 工作与待办完整流程 | #55 | 已完成 |
| [R5-06 / #57](https://github.com/kassol/AgentAnywhere/issues/57) | 报告阅读与版本导航 | #54 | 已完成 |
| [R5-07 / #58](https://github.com/kassol/AgentAnywhere/issues/58) | 报告批注与真实改稿 | #57 | 已完成 |
| [R5-08 / #59](https://github.com/kassol/AgentAnywhere/issues/59) | 设置与登录体验 | #54 | 已完成 |
| [R5-09 / #60](https://github.com/kassol/AgentAnywhere/issues/60) | 全页面验收与正式发布 | #53, #56, #58, #59 | 已完成 |

R5 已完成实现、复核和正式发布；逐项覆盖见 [用户故事映射](evidence/r5-story-coverage.md)，验收与代码版本见 [R5-09](evidence/r5-09.md)。

每项页面任务均包含真实业务与浏览器验证，最终任务汇总六类页面的 A 视觉对照、公开 API 回归、真实执行、升级兼容与正式发布。原型提交 `412e7d0` 只提供页面基准，不能替代正式业务证据。

## 规格覆盖

| 用户故事 | 主责任务 |
| --- | --- |
| 1–4 | R5-03 |
| 5–6、8–9 | R5-02 |
| 7、10–11 | R5-01 |
| 12–15、20–26 | R5-04 |
| 16–19 | R5-05 |
| 27–29 | R5-06 |
| 30–34 | R5-07 |
| 35–37 | R5-08 |
| 38–44 | 各页面任务分别落实，R5-09 汇总核验 |
