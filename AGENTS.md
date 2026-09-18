# AgentAnywhere

## 项目概述

自托管的个人委托工作台。已实现独立 Web 登录、模型连接、工作创建、两种协议的最小隔离执行与持久事件、报告成果保存和阅读，以及执行中追加要求的持久化和流式续跑；搜索与其他交互能力仍在实施中。产品要求见 [PRD](docs/PRD.md)，实施范围见 [MVP](docs/MVP.md)。

## 技术栈

React/TypeScript、Bun、PostgreSQL、Node.js 24.21、pg-boss 12.26.3、Pi 0.85.1 与 OpenSandbox SDK 0.1.11 用于最小执行链路。sub2api 已用于模型列表发现；真实 Chat Completions 和 Responses 已在隔离 Run 验证，正式公网入口待后续验收。OpenConnector 属后续实施范围。

## 目录索引

- `docs/`：产品、实施、工程流程与决策文档。
- `diagrams/`：架构与浏览器隔离图。
- `infra/w0/`：独立基线验证脚本与运行配置；执行证据位于 `docs/evidence/w0/`。
- `infra/r1/`：R1 镜像、队列与沙箱运行配置。
- `infra/r1/search/`：cc-la 独立私有 SearXNG 的配置与复现步骤。
- `src/server.ts`：Web/API 服务与登录鉴权；`src/model-connection.ts`：单套模型连接配置与发现；`src/work.ts`：工作、事件和成果版本持久化；`src/queue-worker.mjs`：Node 队列、资料工具入口、成果复制与沙箱生命周期；`src/research-tools.mjs`：受控搜索与公开网页读取；`src/agent-worker.mjs`：沙箱内 Pi；`src/web/`：精简 Web；`docs/evidence/`：实施验证。
- `CONTEXT.md`：领域定义。

## 常用命令

- `git status --short --branch`：检查工作区。
- `gh issue list --state open`：查看待办。
- `gh issue view <number> --comments`：读取任务及讨论。
- `PYTHONDONTWRITEBYTECODE=1 python3 infra/w0/sandbox/check.py`：检查 W0 runtime 配置合并与补丁保护。

- `bun install --frozen-lockfile`：安装固定依赖。
- `bun run build && bun run typecheck && bun test`：构建、类型检查与应用回归。
- `AGENTANYWHERE_TEST_DATABASE_URL='独立测试库连接串' bun test src/work.test.ts`：工作创建、追加要求的公开 API 与真实 PostgreSQL 回归。
- `AGENTANYWHERE_PASSWORD='本机专用的至少十二位密码' DATABASE_URL='PostgreSQL 连接串' bun run start`：本地启动；模型配置目录通过 `AGENTANYWHERE_DATA_DIR` 指定，默认 `./data`。R1 部署与隔离回归见 `infra/r1/README.md`。

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
- 2026-09-18：加入 R1-04 工作创建、待执行 Run 快照和 PostgreSQL 持久化。
- 2026-09-18：加入 R1-05 Chat Completions 最小执行、队列、沙箱与事件持久化。
- 2026-09-18：加入 R1-06 Responses 执行与双协议隔离验收。
- 2026-09-18：加入 R1-09 执行中追加要求的持久化、待处理状态与流式续跑。
- 2026-09-18：加入 R1-07 报告成果保存、校验、阅读、下载与失败回收重试。
- 2026-09-18：加入 R1-08 受控搜索与公开网页读取工具。
