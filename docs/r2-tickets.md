# R2 任务索引

来源：[Spec #18](https://github.com/kassol/AgentAnywhere/issues/18)；[规格正文](r2-steward-spec.md)；[已确认决定](r2-steward-decisions.md)。

2026-09-19：拆分经确认后发布 12 项任务，均标记 `ready-for-agent`，20 条原生阻塞关系已读取核对。父 Spec 保持开放，正文与状态未修改。本文件记录任务拆分，不表示功能已实现。

## 实施顺序

按依赖推进，当前首项为 [#19](https://github.com/kassol/AgentAnywhere/issues/19)。标签表示任务已明确；只有阻塞项全部完成的任务可开始。

| 任务 | 交付行为 | 直接阻塞项 |
| --- | --- | --- |
| [#19](https://github.com/kassol/AgentAnywhere/issues/19) R2-01 | 配置管家模型与人工调研模型池 | 无 |
| [#20](https://github.com/kassol/AgentAnywhere/issues/20) R2-02 | 持久管家对话、流式回复与有界轮次 | [#19](https://github.com/kassol/AgentAnywhere/issues/19) |
| [#21](https://github.com/kassol/AgentAnywhere/issues/21) R2-03 | 查询历史工作、关联引用与解读报告 | [#20](https://github.com/kassol/AgentAnywhere/issues/20) |
| [#22](https://github.com/kassol/AgentAnywhere/issues/22) R2-04 | 一句话派发多项调研并展示真实回执 | [#20](https://github.com/kassol/AgentAnywhere/issues/20) |
| [#23](https://github.com/kassol/AgentAnywhere/issues/23) R2-05 | 通过管家追加要求与取消指定工作 | [#21](https://github.com/kassol/AgentAnywhere/issues/21) |
| [#24](https://github.com/kassol/AgentAnywhere/issues/24) R2-06 | 通过管家回答同一工作问题 | [#21](https://github.com/kassol/AgentAnywhere/issues/21) |
| [#25](https://github.com/kassol/AgentAnywhere/issues/25) R2-07 | 向关联对话回传状态并汇总全局待办 | [#21](https://github.com/kassol/AgentAnywhere/issues/21)、[#22](https://github.com/kassol/AgentAnywhere/issues/22) |
| [#26](https://github.com/kassol/AgentAnywhere/issues/26) R2-08 | 保留进度重试工作并显式替换模型 | [#21](https://github.com/kassol/AgentAnywhere/issues/21)、[#22](https://github.com/kassol/AgentAnywhere/issues/22) |
| [#27](https://github.com/kassol/AgentAnywhere/issues/27) R2-09 | 明确改稿后生成原工作的新报告版本 | [#21](https://github.com/kassol/AgentAnywhere/issues/21)、[#22](https://github.com/kassol/AgentAnywhere/issues/22) |
| [#28](https://github.com/kassol/AgentAnywhere/issues/28) R2-10 | 管家中断后按回执继续剩余操作 | [#22](https://github.com/kassol/AgentAnywhere/issues/22)、[#23](https://github.com/kassol/AgentAnywhere/issues/23)、[#24](https://github.com/kassol/AgentAnywhere/issues/24)、[#26](https://github.com/kassol/AgentAnywhere/issues/26)、[#27](https://github.com/kassol/AgentAnywhere/issues/27) |
| [#29](https://github.com/kassol/AgentAnywhere/issues/29) R2-11 | 长管家对话自动摘要并保留原文 | [#21](https://github.com/kassol/AgentAnywhere/issues/21) |
| [#30](https://github.com/kassol/AgentAnywhere/issues/30) R2-12 | R2 兼容验证、真实端到端与发布 | [#25](https://github.com/kassol/AgentAnywhere/issues/25)、[#28](https://github.com/kassol/AgentAnywhere/issues/28)、[#29](https://github.com/kassol/AgentAnywhere/issues/29) |

每项功能通过真实 Web/API 验证完整用户行为，并接入现有统一验收入口。每项写操作首次交付即包含授权、幂等与持久回执；[#28](https://github.com/kassol/AgentAnywhere/issues/28)补齐跨轮次继续及组合故障验证。各项数据演进自身保持兼容；[#30](https://github.com/kassol/AgentAnywhere/issues/30)提供整体升级、发布与端到端证据。

## 验收覆盖

下表列出功能责任票；全部验收项最终由 [#30](https://github.com/kassol/AgentAnywhere/issues/30) 集成复核。编号含义以 Spec 为准。

| Spec 验收项 | 功能责任票 |
| --- | --- |
| R2-T01 | [#20](https://github.com/kassol/AgentAnywhere/issues/20) |
| R2-T02 | [#20](https://github.com/kassol/AgentAnywhere/issues/20) |
| R2-T03 | [#21](https://github.com/kassol/AgentAnywhere/issues/21)、[#22](https://github.com/kassol/AgentAnywhere/issues/22) |
| R2-T04 | [#22](https://github.com/kassol/AgentAnywhere/issues/22)、[#25](https://github.com/kassol/AgentAnywhere/issues/25) |
| R2-T05 | [#19](https://github.com/kassol/AgentAnywhere/issues/19)、[#22](https://github.com/kassol/AgentAnywhere/issues/22)、[#26](https://github.com/kassol/AgentAnywhere/issues/26) |
| R2-T06 | [#19](https://github.com/kassol/AgentAnywhere/issues/19)、[#20](https://github.com/kassol/AgentAnywhere/issues/20)、[#22](https://github.com/kassol/AgentAnywhere/issues/22) |
| R2-T07 | [#21](https://github.com/kassol/AgentAnywhere/issues/21)、[#22](https://github.com/kassol/AgentAnywhere/issues/22)、[#23](https://github.com/kassol/AgentAnywhere/issues/23)、[#24](https://github.com/kassol/AgentAnywhere/issues/24)、[#26](https://github.com/kassol/AgentAnywhere/issues/26)、[#27](https://github.com/kassol/AgentAnywhere/issues/27) |
| R2-T08 | [#24](https://github.com/kassol/AgentAnywhere/issues/24) |
| R2-T09 | [#21](https://github.com/kassol/AgentAnywhere/issues/21) |
| R2-T10 | [#25](https://github.com/kassol/AgentAnywhere/issues/25) |
| R2-T11 | [#20](https://github.com/kassol/AgentAnywhere/issues/20)、[#23](https://github.com/kassol/AgentAnywhere/issues/23) |
| R2-T12 | [#20](https://github.com/kassol/AgentAnywhere/issues/20)、[#22](https://github.com/kassol/AgentAnywhere/issues/22)、[#23](https://github.com/kassol/AgentAnywhere/issues/23)、[#28](https://github.com/kassol/AgentAnywhere/issues/28) |
| R2-T13 | [#22](https://github.com/kassol/AgentAnywhere/issues/22)、[#23](https://github.com/kassol/AgentAnywhere/issues/23)、[#24](https://github.com/kassol/AgentAnywhere/issues/24)、[#26](https://github.com/kassol/AgentAnywhere/issues/26)、[#27](https://github.com/kassol/AgentAnywhere/issues/27)、[#28](https://github.com/kassol/AgentAnywhere/issues/28) |
| R2-T14 | [#20](https://github.com/kassol/AgentAnywhere/issues/20)、[#22](https://github.com/kassol/AgentAnywhere/issues/22)、[#28](https://github.com/kassol/AgentAnywhere/issues/28)、[#29](https://github.com/kassol/AgentAnywhere/issues/29) |
| R2-T15 | [#29](https://github.com/kassol/AgentAnywhere/issues/29) |
| R2-T16 | [#26](https://github.com/kassol/AgentAnywhere/issues/26)、[#28](https://github.com/kassol/AgentAnywhere/issues/28) |
| R2-T17 | [#21](https://github.com/kassol/AgentAnywhere/issues/21)、[#27](https://github.com/kassol/AgentAnywhere/issues/27) |
| R2-T18 | [#20](https://github.com/kassol/AgentAnywhere/issues/20)、[#21](https://github.com/kassol/AgentAnywhere/issues/21)、[#22](https://github.com/kassol/AgentAnywhere/issues/22)、[#23](https://github.com/kassol/AgentAnywhere/issues/23)、[#24](https://github.com/kassol/AgentAnywhere/issues/24)、[#27](https://github.com/kassol/AgentAnywhere/issues/27)、[#28](https://github.com/kassol/AgentAnywhere/issues/28)、[#29](https://github.com/kassol/AgentAnywhere/issues/29) |
| R2-T19 | [#30](https://github.com/kassol/AgentAnywhere/issues/30) |
| R2-T20 | [#19](https://github.com/kassol/AgentAnywhere/issues/19)、[#30](https://github.com/kassol/AgentAnywhere/issues/30) |

发布必须分别通过 `isolated`、`live`、`public` 三阶段；隔离阶段包含真实 PostgreSQL 公开 API 检查，缺少数据库明确失败。真实模型双协议与 SearXNG 调研在指定 cc-la 验证，新增中文、键盘及完整用户流程使用 ego-browser。发布后清理临时测试资源，保留正式服务与证据。
