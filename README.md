# AgentAnywhere

自托管的个人委托工作台。通过一个管家入口组织可配置 Agent，在隔离环境中执行工作；用户可以查看过程、补充要求、审批操作和接管浏览器，成果独立于执行环境保存。

当前处于 W0 基线验证阶段，已收录产品文档、独立验证脚本和执行证据。应用集成尚未开始；已验证能力与待办见 [W0 证据](docs/evidence/w0/README.md)。

## 文档

- [工程规范](AGENTS.md)、[领域定义](CONTEXT.md)与[关键决策](docs/adr/)。
- [GitHub Issues](https://github.com/kassol/AgentAnywhere/issues)：任务与 spec。

- [产品需求（PRD）](docs/PRD.md)：产品定位、交互、领域模型与权限边界。
- [MVP 实施与验收](docs/MVP.md)：技术路线、W0—W8 任务包与 A01—A25 验收用例。
- [W0 决策记录](docs/W0.md)：已确认的验证范围、执行约束与结果入口。
- [W0 复现说明](infra/w0/README.md)：固定上游、运行配置、检查与清理。
- [总体架构](diagrams/architecture.svg)：交互面、VPS 控制面与隔离执行面。
- [浏览器隔离与人工接管](diagrams/browser.png)：Browser Broker、独立浏览器与控制租约。

## 首版范围

单用户、单工作空间、一个管家、多个 Agent 定义；默认一个活跃 Worker Run，可附带一个 Browser Session。必须完成调研报告、代码与测试、真实账号审批写入、浏览器人工接管、定时变化检查五个闭环。

基于固定 Craft 版本精简派生 WebApp，使用 Pi 执行、sub2api 模型网关、OpenSandbox/Docker 隔离环境、OpenConnector 账号工具，以及 PostgreSQL/pg-boss 持久化与调度。控制面部署于自有 VPS；Cloudflare 执行后端留待后续验证。

W0 在指定主机 `cc-la` 的独立环境执行，再进入裁剪和业务开发。HTTPS 反代已验证，等待手动配置 sub2api provider/模型后完成真实模型验证。

## 材料说明

初始材料来自 PRD.md、MVP.md、architecture.svg、browser.png。导入时修正架构图链接，并标记原文引用但未提供的执行与审批流程图、Mermaid 和 DOT 源文件；产品范围与技术决策保持原文。
