# AgentAnywhere

## 项目概述

自托管的个人委托工作台。已实现独立 Web 登录、空工作列表和单套模型连接配置；模型推断、执行及成果能力仍在实施中。产品要求见 [PRD](docs/PRD.md)，实施范围见 [MVP](docs/MVP.md)。

## 技术栈

已使用 React/TypeScript 与 Bun 实现 Web 登录和模型配置；Node.js 队列进程、PostgreSQL/pg-boss、Pi、OpenSandbox 与 OpenConnector 仍属后续实施范围。sub2api 已用于模型列表发现，推断能力尚未接通。具体版本和兼容性以各阶段实测为准。

## 目录索引

- `docs/`：产品、实施、工程流程与决策文档。
- `diagrams/`：架构与浏览器隔离图。
- `infra/w0/`：独立基线验证脚本与运行配置；执行证据位于 `docs/evidence/w0/`。
- `src/server.ts`：Web/API 服务与登录鉴权；`src/model-connection.ts`：单套模型连接配置与发现；`src/web/`：精简 Web；`docs/evidence/`：实施验证。
- `CONTEXT.md`：领域定义。

## 常用命令

- `git status --short --branch`：检查工作区。
- `gh issue list --state open`：查看待办。
- `gh issue view <number> --comments`：读取任务及讨论。
- `PYTHONDONTWRITEBYTECODE=1 python3 infra/w0/sandbox/check.py`：检查 W0 runtime 配置合并与补丁保护。

- `bun install --frozen-lockfile`：安装固定依赖。
- `bun run build && bun run typecheck && bun test`：构建、类型检查与应用回归。
- `AGENTANYWHERE_PASSWORD='本机专用的至少十二位密码' bun run start`：本地启动；模型配置目录通过 `AGENTANYWHERE_DATA_DIR` 指定，默认 `./data`。部署配置见 `docs/evidence/r1-01.md` 和 `docs/evidence/r1-02.md`。

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
- 2026-09-18：加入独立 W0 验证目录；远程复现与清理流程见 `infra/w0/README.md`。
- 2026-09-18：加入 R1-01 独立 Web 登录与精简工作台。
- 2026-09-18：加入 R1-02 单套模型连接配置、持久化与网关模型发现。
