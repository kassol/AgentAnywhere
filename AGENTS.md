# AgentAnywhere

## 项目概述

自托管的个人委托工作台。已实现独立 Web 登录、模型连接、工作创建、两种协议的隔离执行与持久事件、报告成果保存和阅读、执行中追加要求、受控搜索、取消、提问与回答恢复、完成后继续工作、失败后手动重试和执行上限；管家已支持独立持久对话、双协议流式轮次、受限查询和解读历史工作、从人工模型池派发多项独立调研，关联工作关键状态卡和全局 Interaction 待办、工作控制与回答、明确重试与改稿、按回执恢复和长对话摘要。R1/R2/R3/R4/R5 已通过隔离、真实双协议和 ego-browser 验收，并发布至正式公网。R3 加入 A 工作台、明暗主题、可靠输入与本机草稿、活动阅读保持、工作/报告预览、精确快捷操作、版本批注改稿和分层设置。R4 已将现有页面迁入固定 Craft v0.13.3 原组件与源码，保留业务接口和数据语义；来源与适配见 [R4 来源清单](docs/r4-craft-source.md)，发布验收见 [R4-08](docs/evidence/r4-08.md)。R5 加入 A 三段工作台、人工与自动短标题、按工作集中入口、独立报告与同对话批注改稿；来源见 [R5 来源清单](docs/r5-craft-source.md)，发布验收见 [R5-09](docs/evidence/r5-09.md)。产品要求见 [PRD](docs/PRD.md)，实施范围见 [MVP](docs/MVP.md)。

## 技术栈

React/TypeScript、Bun、PostgreSQL、Node.js 24.21、pg-boss 12.26.3、Pi 0.85.1 与 OpenSandbox SDK 0.1.11 用于最小执行链路。sub2api 已用于模型列表发现；真实 Chat Completions 和 Responses 已在隔离 Run 验证，正式公网已完成真实调研、报告下载与 HTTPS/WSS 验收。OpenConnector 属后续实施范围。

## 目录索引

- `docs/`：产品、实施、工程流程与决策文档。
- `diagrams/`：架构与浏览器隔离图。
- `infra/w0/`：独立基线验证脚本与运行配置；执行证据位于 `docs/evidence/w0/`。
- `infra/r1/`：R1 镜像、队列与沙箱运行配置。
- `infra/r1/search/`：cc-la 独立私有 SearXNG 的配置与复现步骤。
- `src/server.ts`：Web/API 服务与登录鉴权；`src/model-connection.ts`：单套模型连接配置与发现；`src/work.ts`：工作、事件和成果版本持久化；`src/queue-worker.mjs`：Node 队列、资料工具入口、成果复制与沙箱生命周期；`src/research-tools.mjs`：受控搜索与公开网页读取；`src/agent-worker.mjs`：沙箱内 Pi；`src/web/`：管家工作台、报告审阅与模型设置；`docs/evidence/`：实施验证。
- `src/web/fonts/`：自托管 Inter 字体；来源与许可见 `docs/r3-craft-source.md`，公网字体策略与资源随 `test-public.mjs` 验证。
- `CONTEXT.md`：领域定义。

## 常用命令

- `git status --short --branch`：检查工作区。
- `gh issue list --state open`：查看待办。
- `gh issue view <number> --comments`：读取任务及讨论。
- `PYTHONDONTWRITEBYTECODE=1 python3 infra/w0/sandbox/check.py`：检查 W0 runtime 配置合并与补丁保护。

- `bun install --frozen-lockfile`：安装固定依赖。
- `bun run build && bun run typecheck && bun test`：构建、类型检查与应用回归；运行回归前须设置独立测试库的 `AGENTANYWHERE_TEST_DATABASE_URL`，缺失时明确失败。
- `AGENTANYWHERE_TEST_DATABASE_URL='独立测试库连接串' bun test src/work.test.ts`：工作创建、追加要求和完成后继续工作的公开 API 与真实 PostgreSQL 回归。
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
- 2026-09-18：加入 R1-11 排队与执行中取消，含成果保留和沙箱回收。
- 2026-09-18：加入 R1-13 完成后继续工作与报告版本历史，通过隔离与浏览器验收。
- 2026-09-18：加入 R1-10 提问、检查点保存、等待释放与回答后排队恢复，通过隔离与浏览器验收。
- 2026-09-18：加入 R1-12 失败检查点、手动重试与执行上限，通过隔离验收。

- 2026-09-19：首版发布至 cc-la 公网，完成统一回归、真实网关、浏览器与 W0 归档回收；证据见 `docs/evidence/r1-14.md`。
- 2026-09-19：加入 R2-01 管家模型与人工调研模型池配置，实际调研验证状态留待后续工作记录接入。
- 2026-09-19：加入 R2-03 历史工作候选查询、明确关联、成果版本引用与报告解读。
- 2026-09-19：加入 R2-02 独立持久管家对话、双协议流式回复、全局单轮调度、停止与中断恢复。
- 2026-09-19：加入 R2-04 人工池内模型选择、多项独立调研派发、持久回执与单轮创建额度。
- 2026-09-19：加入 R2-07 关联工作关键状态卡和全局 Interaction 待办。
- 2026-09-19：加入 R2-11 长管家对话自动摘要、覆盖范围与原文留存，并统一模型请求和业务操作的轮次硬额度。
- 2026-09-19：加入 R2-08 管家显式同模型/替代模型重试、失败与模型池证据、检查点预校验和稳定回执。
- 2026-09-19：加入 R2-09 明确报告改稿、来源版本冻结、原工作新 Run 与稳定回执，失败保留旧报告。
- 2026-09-19：加入 R2-10 各类回执的明确继续命令、原结果核对、当前授权重验及真实业务拒绝原因留存。
- 2026-09-19：R2 发布至 cc-la；统一 isolated/live/public、旧数据兼容及临时资源清理通过，证据见 `docs/evidence/r2-12.md`。
- 2026-09-20：R3 工作台与报告审阅发布至 cc-la；兼容、备份、浏览器和目录归并证据见 `docs/evidence/r3-08.md`。

- 2026-09-20：R5 页面体验发布至 cc-la；真实改稿、双协议、页面矩阵与服务器收敛证据见 `docs/evidence/r5-09.md`。

- 2026-09-21：R6 编码闭环（C2: dev→test→patch）发布至 cc-la；SandboxAdapter 中立接口、AgentDefinition 持久化、worker-coding 镜像与 Profile 选择、编码工具集（shell/read_file/write_file/git_diff）与 submit_artifact、Git 仓库预注入、管家委派编码任务。真实公网编码任务验收（bug 修复 + 报告 + 测试日志）证据见 `docs/evidence/r6-07.md`。
