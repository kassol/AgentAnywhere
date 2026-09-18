# AgentAnywhere 领域定义

状态：从 [PRD 第 4 节](docs/PRD.md#4-核心领域模型) 提取的设计基线。Task、Thread 和 Run 的首次创建、Chat Completions 与 Responses 最小执行及事件持久化已实现，并经真实 PostgreSQL、pg-boss、Pi 和 OpenSandbox 隔离回归验证；Artifact/Version 的首个报告保存链路已实现，待真实隔离回归。等待、执行重试和审批仍属设计要求。术语变更时同步维护 PRD 对应定义。

## 产品

个人委托工作台。管家接受目标并组织 Agent 执行；用户通过工作、待办和成果查看进度并介入。

## 核心对象

| 对象 | 含义与关键关系 |
| --- | --- |
| Thread | 管家对话或工作对话；不等于任务状态。 |
| Task | 目标、输入、完成条件、父任务、当前状态；可以有多个 Run。 |
| Run | 一次任务执行，固定 Agent/Skill/环境配置版本、授权和预算；模型连接凭证版本由私有引用固定。 |
| AgentDefinition / Version | 职责、模型、工具上限、Skill 引用、默认环境、交付约束。 |
| SandboxProfile | 逻辑环境配置，如 worker-basic、worker-coding、browser-interactive；不是任意 Docker 参数。 |
| SandboxLease | Run 与实际供应商资源的绑定、角色、租约、续租和回收记录。 |
| Connection | 指向 OpenConnector 中明确账号的引用及安全展示信息。 |
| ModelConnection（模型连接） | 模型网关的端点、凭证引用与可用模型配置；与第三方账号 Connection 分开。 |
| RunGrant | 本次执行可用的账号、Action、资源范围、有效期、浏览器模式和预算。 |
| Interaction | 问题、审批、接管或异常核查；包含等待状态和用户回答。 |
| Operation | 外部副作用的独立记录，包含请求内容哈希、审批、幂等键和回执。 |
| Artifact / Version | 独立于 Run/Sandbox 的成果及版本；正文或文件存储位置、哈希、来源和验证信息。 |
| BrowserSession | 一个 Run 的浏览器实例与控制租约；可引用用户明确授权的登录态版本。 |
| Automation | 触发规则、模板、时区、游标、去重键、通知方式；每次触发产生新的工作或检查。 |

一个 Run 通常分配一个 Worker Sandbox，按需额外分配一个 Browser Sandbox，因此数据关系是 Run 对多个 SandboxLease，而不是永久一对一。

Run 等待后恢复仍可使用同一 Run ID，但执行代次 epoch 增加；失败后由用户重试则创建新 Run，保留 retryOfRunId。模型消息与过程审计不能代替业务数据库。


## 决策

已采纳的工程约定见 [ADR-0001](docs/adr/0001-repository-and-engineering-workflow.md)。
