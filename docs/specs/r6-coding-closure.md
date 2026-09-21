# Spec R6: 编码闭环与底层收敛

版本：v1.1 · 2026-09-21
状态：建议实施基线
对应：MVP C2（开发→测试→Patch）、W3 部分补完、W4 部分补完

## 0. 目标

R6 让 AgentAnywhere 具备第二种工作类型——编码任务。用户通过管家委托编码工作，系统在隔离沙箱内修改代码、运行测试、保存 diff 和测试日志，沙箱销毁后成果仍可查看。同时将现有 OpenSandbox 直接调用收敛为 SandboxAdapter 中立接口，将隐式的单一 Agent 类型收敛为持久化的 Agent 定义。

## 1. 设计决策总表

| 决策 | 选择 | 替代方案与排除理由 |
|---|---|---|
| R6 核心闭环 | C2 开发→测试→Patch | C3/C4 各引入全新子系统，风险面大；底层收敛嵌入 C2 |
| W5 推迟 | 接受，R6 无第三方写入 | 两套独立复杂度不混一个里程碑 |
| worker-coding 镜像 | 基于现有 Dockerfile.agent 扩展层 | 独立镜像维护成本高；动态安装不可控 |
| Git 仓库注入 | 控制面沙箱外 clone，writeFiles 分批注入（50 文件/批），200MB 上限 | volume mount 暴露宿主机路径；沙箱内 clone 需凭证入 Agent 环境 |
| 仓库 URL 字段 | work_tasks 新增 repo_url 列，独立于 source_url | 复用 source_url 语义冲突（网页阅读 vs git clone） |
| 编码成果类型 | 新增 patch + test_log 两种 Artifact kind | 嵌入 Markdown 报告丢失结构化信息 |
| 成果提交通道 | 扩展 submit_report 为 submit_artifact，新增 kind 参数 | 独立工具增加重复逻辑 |
| SandboxAdapter | 中立接口 + OpenSandboxAdapter 首版实现（ADR-0004） | 直接分支逻辑后续 Cloudflare 改造成本高 |
| SandboxAdapter 文件格式 | 纯 .mjs + JSDoc 类型注释 | .ts 需引入 Node 端构建链，与现有 queue-worker/agent-worker 模式不一致 |
| R6 实现方法 | 8 个核心（create/inspect/startProcess/processStatus/stopProcess/readFile/writeFile/destroy） | renew/resolveEndpoint/capabilities 留 R7 |
| FakeSandboxAdapter | 测试专用，bun test 中验证接口契约和能力拒绝 | 运行时可选增加配置复杂度，R6 不需要 |
| Agent 定义持久化 | 数据库 agent_definitions + agent_versions 表，幂等 DDL 追加 | 独立迁移文件——项目无此模式 |
| Agent 定义深度 | 内置两个定义 + 管家选择类型，不做子任务拆分 | 完整管理 UI 过度工程 |
| 旧数据兼容 | work_runs.agent_version_id 允许 NULL，查询时 NULL 等同 research | NOT NULL 外键破坏旧数据；迁移回填增加启动风险 |
| coding Agent 指令 | Agent 定义携带不同 system prompt 模板 | 共用 prompt 区分度不够 |
| 编码工具执行位置 | 沙箱内本地执行（Node child_process + fs） | 绕回 queue-worker 增加延迟和协议复杂度 |
| 编码工具集 | research 工具 + shell + read_file + write_file + git_diff（叠加模式） | 纯编码工具缺少文档查阅能力 |
| 工具集传递 | queue-worker POST /run 新增 agentType 参数，agent-worker 据此条件注册 | 环境变量不够灵活（需重建沙箱才能改） |
| shell 限制策略 | 依赖沙箱隔离，不做命令级白/黑名单 | 白名单过严，Agent 需要不可预测的命令 |
| diff 生成 | Agent 内部运行 git diff 并通过 submit_artifact(kind='patch') 提交 | 控制面介入增加协议复杂度 |
| 测试执行 | Agent 自主运行 + 判定 | 控制面触发增加流程耦合 |
| 管家委派机制 | 自动识别 + 告知用户；dispatch 工具 items 新增 agentType 字段 | 用户显式选择增加操作负担 |
| worker-coding 资源 | 2 vCPU / 2 GiB 内存 / 4 GiB 工作目录 | MVP 5.3 建议值；实测后按需调整 |
| 凭证安全 | 控制面持有 Git token，沙箱外 clone，沙箱内无凭证 | token 传入沙箱违反安全门槛 |
| 验收样例 | 预设 Node.js + TypeScript 小型项目，vitest 测试套件 | AgentAnywhere 自身太大；任意仓库不可控 |
| 验收用例 | 核心 9 项（A01/A02/A04/A16/A17/A18/A19/A21/A23） | 全部 25 项含 C3/C4/C5 前置 |

## 2. 实施范围

### 2.1 SandboxAdapter 中立接口（W3 补完）

新增 `src/sandbox-adapter.mjs`，导出 SandboxAdapter 接口（JSDoc 类型注释），定义 8 个核心方法的输入/输出：

```
create({ requestId, profileId, role, runId, epoch, image, entrypoint, env, resource, timeoutSeconds }) → { sandboxId, status }
inspect(sandboxId) → { status, createdAt, metadata }
startProcess(sandboxId, { argv, cwd, env, timeoutSeconds }) → { processId }
processStatus(sandboxId, processId) → { running, exitCode, stdout, stderr }
stopProcess(sandboxId, processId) → void
readFile(sandboxId, path) → Buffer
writeFile(sandboxId, entries[]) → void  // entries: { path, data, mode }
destroy(sandboxId) → void
```

新增 `src/sandbox-opensandbox.mjs`，实现 OpenSandboxAdapter，将上述方法映射到 `@alibaba-group/opensandbox` SDK 的 `Sandbox.create()`、`sandbox.files.*`、`sandbox.commands.*`、`manager.killSandbox()` 等调用。

重构 `src/queue-worker.mjs`：将所有直接 SDK 调用替换为通过 adapter 实例调用。adapter 在 worker 启动时根据配置实例化（R6 只有 OpenSandboxAdapter）。

新增 `src/sandbox-fake.mjs`（测试专用）：FakeSandboxAdapter 实现接口但在特定方法上抛出"能力不支持"错误，用于 A23 契约测试。放在 `src/` 目录但仅测试引用。

### 2.2 worker-coding 镜像与 Profile（W3 补完）

新增 `infra/r6/Dockerfile.agent-coding`，基于 `infra/r1/Dockerfile.agent` 同一 Node 基础镜像扩展：

```dockerfile
FROM node@sha256:<同 Dockerfile.agent 的 digest>
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*
# Node.js 已在基础镜像中；npm 随之可用
WORKDIR /app
COPY infra/r1/agent/package*.json ./
RUN npm ci --omit=dev
COPY src/agent-worker.mjs ./agent-worker.mjs
USER node
CMD ["node", "/app/agent-worker.mjs"]
```

在 queue-worker 的 Profile 配置中新增 worker-coding：

| 参数 | 值 |
|---|---|
| image | `agent-coding@sha256:<构建后固定>` |
| cpu | `2` |
| memory | `2048Mi` |
| workspaceSize | `4Gi` |
| entrypoint | `['node', '/app/agent-worker.mjs']` |

### 2.3 AgentDefinition 持久化与内置定义（W4 补完）

在 `src/work.ts` 的幂等 DDL 链中追加：

```sql
CREATE TABLE IF NOT EXISTS agent_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES agent_definitions(id),
  version integer NOT NULL,
  profile_id text NOT NULL,
  system_prompt text NOT NULL,
  tool_set text NOT NULL,     -- 'research' | 'coding'
  config jsonb NOT NULL DEFAULT '{}',
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, version)
);
ALTER TABLE work_runs ADD COLUMN IF NOT EXISTS agent_version_id uuid REFERENCES agent_versions(id);
```

`agent_version_id` 允许 NULL——旧 Run 不回填，查询时 NULL 等同 research 定义。

在 `src/work.ts` 启动时（DDL 之后）执行幂等 upsert，预置两个定义：

- **research**（name='research'）：version=1，profile_id='worker-basic'，tool_set='research'，system_prompt 为现有调研指令。
- **coding**（name='coding'）：version=1，profile_id='worker-coding'，tool_set='coding'，system_prompt 包含编码规范、测试要求、diff 生成指令（见 2.4）。

Run 创建时（`createWorkInTransaction`）根据 agent_type 查找对应定义的最新版本，写入 `agent_version_id`。

### 2.4 编码工具集与 Agent 指令

#### 工具执行位置

编码工具在沙箱内本地执行。agent-worker.mjs 根据 `/run` 请求中的 `agentType` 参数条件注册工具：

- **agentType='research'**（默认）：注册现有 5 个工具不变。
- **agentType='coding'**：注册现有 5 个工具 + 4 个编码工具。

#### 编码工具定义

| 工具 | 参数 | 执行方式 | 输出 |
|---|---|---|---|
| shell | `{ command: string, cwd?: string }` | `child_process.execFile('/bin/sh', ['-c', command], { cwd, timeout: 120000, maxBuffer: 64*1024 })` | stdout + stderr + exitCode |
| read_file | `{ path: string }` | `fs.readFile(resolve(workdir, path), 'utf-8')` | 文件内容，限 1MB |
| write_file | `{ path: string, content: string }` | `fs.writeFile(resolve(workdir, path), content)` | 确认消息 |
| git_diff | `{ staged?: boolean }` | `execFile('git', ['diff', ...(staged ? ['--staged'] : [])], { cwd: workdir })` | unified diff 文本 |

所有文件路径限制在工作目录内（resolve 后检查前缀）。

#### 成果提交

扩展 submit_report 为 submit_artifact：

```
submit_artifact({
  kind: 'report' | 'patch' | 'test_log',
  content: string,           // report: markdown; patch: unified diff; test_log: JSON string
  attachments?: [...]        // 仅 kind='report' 时可用
})
```

- kind='report'：行为与现有 submit_report 完全一致。
- kind='patch'：将 content 写入 `output-dir/patch.diff`。
- kind='test_log'：将 content 写入 `output-dir/test-log.json`。

queue-worker 的 `persistArtifacts()` 识别 manifest 中的 kind，创建对应 Artifact 记录。work_artifacts 的 kind 列已存在，直接写入新值。

coding Agent 可多次调用 submit_artifact——先提交 test_log 再提交 patch 再提交 report，每次创建或更新对应 Artifact Version。

#### coding Agent system prompt 要点

- 你在一个已 clone 的 Git 仓库中工作。
- 使用 shell、read_file、write_file 工具修改代码。
- 修改完成后运行测试命令验证。
- 测试通过后：(1) 用 submit_artifact(kind='test_log') 提交测试结果 JSON（含命令、stdout、stderr、exitCode）；(2) 用 submit_artifact(kind='patch') 提交 git diff 输出；(3) 用 submit_artifact(kind='report') 提交 Markdown 总结。
- 测试失败时继续修改直到通过或判断无法修复则报告原因。

### 2.5 Git 仓库预注入

#### 数据模型

```sql
ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS repo_url text;
```

dispatch 工具 items 新增 `repoUrl` 字段（可选，HTTPS URL）。steward_research_operations 表追加 `repo_url` 列。`createFromSteward` 透传到 `work_tasks.repo_url`。

#### 注入流程

Run 创建后、沙箱启动后、POST /run 之前，queue-worker 执行：

1. 从 work_tasks 读取 repo_url。若为空则跳过注入。
2. 在宿主机 `os.tmpdir()` 下创建临时目录。
3. 执行 `git clone --depth 1 <repo_url> <tmpdir>`。若配置了 Git token，通过 `GIT_ASKPASS` 环境变量注入（仅 clone 进程可见，不写入文件）。
4. 遍历 clone 结果（排除 `.git` 目录），校验总大小 ≤ 200MB，单文件 > 10MB 跳过并警告。
5. 按 50 文件一批调用 `adapter.writeFile(sandboxId, entries)`。
6. 在沙箱工作目录执行 `git init && git add -A && git commit -m "initial"` 使 Agent 的 git diff 有基准。
7. 清理宿主机临时目录。

clone 失败或大小超限时，Run 进入 failed 状态并记录原因。

### 2.6 管家委派编码任务

#### 管家 system prompt 变更

增加 Agent 类型选择指引：
> 当用户目标涉及代码修改、bug 修复、功能实现、测试编写、仓库操作时，使用 agentType='coding'。其他情况使用 agentType='research'（默认）。选择 coding 时在回复中告知用户将使用编码环境。

#### dispatch 工具变更

`dispatch_research` 改名为 `dispatch_work`（或保持原名，新增字段）。items 数组每项新增：

```json
{
  "agentType": { "type": "string", "enum": ["research", "coding"], "default": "research" },
  "repoUrl": { "type": ["string", "null"], "maxLength": 2048 }
}
```

steward_research_operations 表追加：
```sql
ALTER TABLE steward_research_operations ADD COLUMN IF NOT EXISTS agent_type text NOT NULL DEFAULT 'research';
ALTER TABLE steward_research_operations ADD COLUMN IF NOT EXISTS repo_url text;
```

`createFromSteward` 读取 agent_type 和 repo_url 并透传到 Task/Run 创建。

#### queue-worker 变更

execute() 函数中：
1. 从 work_tasks 读取 repo_url，从 work_runs 读取 agent_version_id（若 NULL 则查 research 定义）。
2. 根据 agent_version 的 profile_id 选择镜像和资源配置。
3. 根据 agent_version 的 system_prompt 构建 goal。
4. 沙箱创建后，若有 repo_url 则执行预注入（2.5）。
5. POST /run 时传入 `agentType` 参数（从 agent_version 的 tool_set 读取）。

### 2.7 验收样例项目

创建 `infra/r6/sample-project/`：

```
infra/r6/sample-project/
├── package.json          # name: sample-project, scripts: { test: "vitest run" }
├── tsconfig.json
├── vitest.config.ts
├── src/
│   └── todo.ts           # 简单 todo CRUD 函数库
└── test/
    └── todo.test.ts      # 5 个测试，其中 2 个因 todo.ts 的 bug 故意失败
```

验收时委托 coding Agent 修复 `src/todo.ts` 中的 bug 使全部测试通过。验证 patch、test_log 和 report 三种成果都正确保存。

## 3. 验收用例

| 编号 | 操作 | 通过标准 |
|---|---|---|
| A01 | 委托编码任务 | 管家识别为 coding 类型，创建 Task/Run 绑定 coding AgentVersion，使用 worker-coding Profile |
| A02 | 同时创建调研和编码工作 | 两个 Run 分别使用 worker-basic 和 worker-coding，工作目录隔离 |
| A04 | 修改样例项目并运行测试 | 保存 patch（可读 unified diff）、test_log（通过的测试结果 JSON）和 report（Markdown 总结）；无宿主目录写入 |
| A16 | 编码执行中取消 | 及时确认，沙箱清理，已产出的部分成果保留 |
| A17 | worker-coding 沙箱 TTL 到期 | 回收任务幂等；残留有告警 |
| A18 | 事件回放 | 刷新后依 serverSeq 正确重放编码事件，无重复 |
| A19 | 编码成功后销毁沙箱 | patch、test_log 和 report 仍可读取，hash 一致 |
| A21 | 达到模型轮次上限 | 编码 Run 正确停止并保存已有成果 |
| A23 | FakeSandboxAdapter 拒绝不支持能力 | 调度明确拒绝，不假成功 |

## 4. 不进入 R6

- W5 OpenConnector / 审批（→ R7）
- W6 浏览器沙箱 / Browser Broker（→ R7+）
- W7 恢复与自动化（→ R7+）
- AgentDefinition 管理 UI
- 子任务拆分
- SandboxAdapter renew / resolveEndpoint / capabilities 方法
- 任意 Git 仓库支持（R6 仅预设样例 + 管家传入的 HTTPS 公开仓库）
- Cloudflare 真实验证
- dispatch 工具改名（保持 dispatch_research 名称，新增字段）

## 5. 工程约定

- DDL 变更追加到 work.ts 和 steward.ts 的幂等链中，不建立独立迁移文件。
- worker-coding Dockerfile 放 `infra/r6/Dockerfile.agent-coding`。
- SandboxAdapter 接口放 `src/sandbox-adapter.mjs`，OpenSandboxAdapter 放 `src/sandbox-opensandbox.mjs`，FakeSandboxAdapter 放 `src/sandbox-fake.mjs`。
- 编码工具实现放 `src/coding-tools.mjs`，由 agent-worker.mjs 条件引入。
- ADR-0004 记录抽象决策。
- commit message 使用简洁英文。

## 6. 数据流全景

```
用户 → 管家对话 → dispatch_work(agentType='coding', repoUrl='https://...')
  → steward_research_operations(agent_type, repo_url)
  → create_frozen_research → createFromSteward
  → work_tasks(repo_url) + work_runs(agent_version_id)
  → outbox → queue-worker

queue-worker:
  1. 读取 agent_version → profile_id → 选择镜像+资源
  2. adapter.create(worker-coding profile) → 沙箱
  3. 预注入：git clone → writeFile 分批 → git init+commit
  4. POST /run { goal, model, agentType='coding', ... }

agent-worker:
  1. 收到 agentType='coding' → 注册 research + coding 工具
  2. 使用 coding system prompt
  3. shell/read_file/write_file → 沙箱本地 fs/child_process
  4. submit_artifact(kind='test_log') → 写 /tmp/agentanywhere-output/
  5. submit_artifact(kind='patch') → 写 /tmp/agentanywhere-output/
  6. submit_artifact(kind='report') → 写 /tmp/agentanywhere-output/
  7. run.finished

queue-worker:
  persistArtifacts() → 读取 manifest → 按 kind 持久化 work_artifacts
  adapter.destroy() → 沙箱回收
```
