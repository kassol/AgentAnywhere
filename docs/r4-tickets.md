# R4 任务索引

规格：[Issue #42](https://github.com/kassol/AgentAnywhere/issues/42)。本次仅发布子任务并建立阻塞关系，父规格保持不变。

以下拆分已经确认。任务正文与验收以 GitHub Issue 为准；原生阻塞关系已逐项读取核对。

| 任务 | 交付 | 直接阻塞 |
| --- | --- | --- |
| [R4-01 / #43](https://github.com/kassol/AgentAnywhere/issues/43) | 核查固定上游与迁移清单 | 无 |
| [R4-02 / #44](https://github.com/kassol/AgentAnywhere/issues/44) | 跑通 Craft 核心链路 | #43 |
| [R4-03 / #45](https://github.com/kassol/AgentAnywhere/issues/45) | 工作台导航与主题迁移 | #44 |
| [R4-04 / #46](https://github.com/kassol/AgentAnywhere/issues/46) | 管家输入与活动流完整迁移 | #44 |
| [R4-05 / #47](https://github.com/kassol/AgentAnywhere/issues/47) | 工作与待办介入迁移 | #45, #46 |
| [R4-06 / #48](https://github.com/kassol/AgentAnywhere/issues/48) | 报告审阅与改稿迁移 | #45, #46 |
| [R4-07 / #49](https://github.com/kassol/AgentAnywhere/issues/49) | 模型设置迁移 | #45 |
| [R4-08 / #50](https://github.com/kassol/AgentAnywhere/issues/50) | 全页面验收与正式发布 | #47, #48, #49 |

从 R4-01 开始；仅领取所有阻塞已完成的任务。源码核查和核心链路验证结果决定后续具体适配方案；影响范围或用户行为的新取舍须确认后更新受影响任务。

每票保留原组件来源审查、行为回归与适用的 ego-browser 证据；最终票集中完成全部页面覆盖、旧实现清理与正式发布。
