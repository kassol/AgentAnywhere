# AgentAnywhere

## 项目概述

自托管的个人委托工作台。当前处于文档与基线验证准备阶段；产品要求见 [PRD](docs/PRD.md)，实施范围见 [MVP](docs/MVP.md)。

## 技术栈

拟采用 React/TypeScript、Bun 控制服务、Node.js 队列进程、PostgreSQL/pg-boss、Pi、OpenSandbox、OpenConnector 与 sub2api。具体版本和兼容性以 W0 验证结果为准。

## 目录索引

- `docs/`：产品、实施、工程流程与决策文档。
- `diagrams/`：架构与浏览器隔离图。
- `CONTEXT.md`：领域定义。

## 常用命令

- `git status --short --branch`：检查工作区。
- `gh issue list --state open`：查看待办。
- `gh issue view <number> --comments`：读取任务及讨论。

应用构建与测试命令在引入实际工程后确定。

## 全局规范

- 开工前读取领域文档、相关 ADR 和任务验收条件；区分设计要求与已验证能力。
- 文档使用中文，commit message 使用简洁英文。
- 引入上游代码时记录来源版本、原路径和本地修改，保留适用许可与归属声明。
- 完成工程技能产物后，仅提交本任务改动并推送当前分支。部署按后续明确的项目流程执行。

## Agent skills

### Issue tracker

任务与 spec 使用 GitHub Issues。操作前读取 [issue-tracker.md](docs/agents/issue-tracker.md)。

### Triage labels

任务分流使用五个默认标签。分流前读取 [triage-labels.md](docs/agents/triage-labels.md)。

### Domain docs

采用根目录 `CONTEXT.md` 与 `docs/adr/`。探索前读取 [domain.md](docs/agents/domain.md)。

## 变更日志

- 2026-09-18：建立公开仓库与工程技能配置。
