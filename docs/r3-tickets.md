# R3 任务拆分

来源：[Spec #32](https://github.com/kassol/AgentAnywhere/issues/32)；设计采用用户选定的 A 经典侧栏。

2026-09-20：8 项拆分及依赖经用户确认后发布，均标记 `ready-for-agent`。12 条原生阻塞关系已逐项读取核对；父 Spec 正文、标题、标签和开放状态保持不变。此记录表示任务已明确，功能尚未实施。

## 任务与依赖

| 任务 | 交付行为 | 直接阻塞项 | Spec 验收映射 |
| --- | --- | --- | --- |
| [R3-01 #33](https://github.com/kassol/AgentAnywhere/issues/33) | A 工作台与主题 | 无 | R3-T01、R3-T15、R3-T17 |
| [R3-02 #34](https://github.com/kassol/AgentAnywhere/issues/34) | 可靠输入与草稿恢复 | #33 | R3-T05、R3-T08、R3-T11、R3-T16 |
| [R3-03 #35](https://github.com/kassol/AgentAnywhere/issues/35) | 真实活动流与阅读保持 | #33 | R3-T03、R3-T04、R3-T15、R3-T16、R3-T17 |
| [R3-04 #36](https://github.com/kassol/AgentAnywhere/issues/36) | 右侧工作与报告预览 | #34 | R3-T02、R3-T08、R3-T13、R3-T16、R3-T17 |
| [R3-05 #37](https://github.com/kassol/AgentAnywhere/issues/37) | 快捷控制与一致待办 | #34、#35 | R3-T06、R3-T07、R3-T16 |
| [R3-06 #38](https://github.com/kassol/AgentAnywhere/issues/38) | 报告批注到真实改稿 | #34、#36 | R3-T08、R3-T09、R3-T10、R3-T11、R3-T12、R3-T13、R3-T16、R3-T17 |
| [R3-07 #39](https://github.com/kassol/AgentAnywhere/issues/39) | 分层模型设置 | #33 | R3-T14、R3-T15、R3-T17 |
| [R3-08 #40](https://github.com/kassol/AgentAnywhere/issues/40) | R3 整体验收与发布 | #35、#37、#38、#39 | 全部 18 项 |

## 实施方式

从无阻塞的 R3-01 开始。完成后 R3-02、R3-03、R3-07 可独立推进；存在共享样式或同一页面写入时采用串行或隔离分支集成，逻辑独立不代表可以同时修改同一文件。

各票均贯穿真实数据、交互和适用的 API/浏览器检查；授权、恢复、版本保护及来源记录随功能验收，不推迟到发布票。R3-06 保持批注到真实改稿的完整闭环，防止只有批注界面而缺失失败保护。

R3-01 至 R3-07 已覆盖 R3-T01—R3-T17；R3-08 汇总全部证据并负责 R3-T18 的兼容、正式发布和资源清理。原型演示不作为真实执行证据。

原型一手资料保留在 [prototype/r3-craft-ui](https://github.com/kassol/AgentAnywhere/tree/prototype/r3-craft-ui)，选择结论提交 `75efffa`。完成各任务后按其验收条件记录 resolution；父 Spec 独立验收，不自动随最后一票关闭。
