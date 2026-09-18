# R1 执行链路

`compose.yaml` 只管理 R1 的 Web、PostgreSQL 和 queue；`sandbox.compose.yaml` 继续管理 OpenSandbox。镜像版本固定为 Bun 1.3.10、Node 24.21、Pi 0.85.1、pg-boss 12.26.3、OpenSandbox SDK 0.1.11。`Dockerfile.agent` 将沙箱内运行程序与 Pi 依赖装入非 root 镜像。模型长期凭证只保存在 Web 的受限 `data/model-connection.json`；可信 queue 持有数据库与 OpenSandbox 管理凭证并生成每次 Run 的短 token。沙箱只持短 token，通过 Web 内部模型代理调用快照固定的模型与协议。

部署目录为 `/opt/agentanywhere-r1`。将仓库工作树复制到部署目录的 `build-r1-05`，从本目录复制 `compose.yaml` 和 `deploy.sh` 到部署目录。构建正式镜像：

```sh
docker build -t agentanywhere-r1-web:r1-05 -f build-r1-05/infra/r1/Dockerfile.web build-r1-05
docker build -t agentanywhere-r1-queue:r1-05 -f build-r1-05/infra/r1/Dockerfile.queue build-r1-05
docker build -t agentanywhere-r1-agent:r1-05 -f build-r1-05/infra/r1/Dockerfile.agent build-r1-05
```

`database.env` 需为 0600，含 `DATABASE_URL=postgresql://agentanywhere_app:<URL编码密码>@postgres:5432/agentanywhere`；`service.env` 保留登录与 HTTPS origin，`opensandbox.env` 保留 OpenSandbox 管理凭证。执行 `sh /opt/agentanywhere-r1/deploy.sh`：脚本读取现有 R1 PostgreSQL 在 `agentanywhere-r1_default` 网络的当前 IP，为 gVisor Web 写入容器级 `/etc/hosts` 映射，等 Web 建表并健康后启动 queue。PostgreSQL 容器重建后须重新执行脚本，以更新 IP 映射。不要将管理凭证传入沙箱。

`artifacts/` 是 Web 只读、queue 可写的持久成果目录。部署脚本创建该目录并交给非 root queue 用户。成果版本记录在 PostgreSQL；文件先从沙箱复制、核验大小及 SHA-256，成功后才登记版本并回收沙箱。保存失败会保留沙箱并在工作详情提供重试；回收失败也可从同一入口重试。备份需同时包含数据库与 `artifacts/`。

隔离回归使用 `test.compose.yaml`、独立 schema/数据目录、可由 queue 用户写入的 `test-artifacts/` 和 `model-fixture.mjs`。测试镜像另用 `Dockerfile.fixture` 构建。将 `test-run.mjs` 放在远程构建目录对应位置，`TEST_PASSWORD_FILE` 指向隔离 Web 的 0600 密码文件；运行 `node infra/r1/test-run.mjs`。脚本通过公开 API 创建串行 Run，核查 Pi 工具参数、报告与附件 SHA-256、保存失败与重试、Web 重启后读取，以及 OpenSandbox SDK 按 Run ID 查不到存活沙箱。测试期间脚本会短暂将隔离成果目录设为只读并重启隔离 Web。模型 HTTP fixture 是唯一可控响应边界；数据库、pg-boss、Pi 与 OpenSandbox 均使用真实服务。默认隔离端口为 Web `127.0.0.1:19112`、fixture `127.0.0.1:19113`。测试完删除隔离 Compose、schema、数据和本地临时镜像。

真实 sub2api 的双协议连接测试和 Pi 工具往返分别见 [R1-05](../../docs/evidence/r1-05.md) 与 [R1-06](../../docs/evidence/r1-06.md)。`submit_report` 在沙箱内写报告与文本附件；同一 Run 的修订报告先写新 generation，再原子更新 manifest 指针，queue 按该指针校验并提交 Artifact/Version。执行中追加要求通过 `POST /api/runs/:id/messages` 保存，并由当前 epoch 的 Pi 在下一模型步骤接收；隔离流式回归运行 `node infra/r1/test-steering.mjs`，结果见 [R1-09](../../docs/evidence/r1-09.md)。取消隔离回归使用 `node infra/r1/test-cancel.mjs`；正式浏览器接管待后续票验收。

R1-08 的 queue 同时连接 `agentanywhere-r1-search` 专用网络，从固定 `http://agentanywhere-r1-searxng:8080` 查询 JSON；沙箱仅凭本次 Run 短 token 调用 queue 的 `search_web` 与 `open_public_page` 工具入口。queue 从 `service.env` 读取 `AGENTANYWHERE_PUBLIC_ORIGIN`，以主机名和实时解析地址拒绝控制面 URL。公开网页逐跳校验 DNS 解析地址并固定连接目标，仅提取 HTTP 文本；搜索结果包含部分失败的引擎。测试环境将 `SEARCH_ORIGIN` 指向同网络的模型/搜索 HTTP fixture；`node infra/r1/test-research.mjs` 从公开 API 验证主题、指定 URL、私网与控制面公网 IP 拒绝，并通过 `/waiting-search`、`/release-search` 控制真实工具执行中的搜索响应。该脚本需要 `TEST_PASSWORD_FILE`、与 queue 环境一致的 `TEST_CONTROL_PLANE_ORIGIN` 和固定的 19112/19113 隔离端口。
完成后继续工作通过 `POST /api/tasks/:id/runs` 在原 Task/Thread 创建新 Run；新执行读取并校验前次已交付报告，保留旧版本。隔离回归脚本为 `node infra/r1/test-continuation.mjs`，覆盖新旧报告、失败保留、Web 重启和沙箱回收；执行结果记录在 [R1-13](../../docs/evidence/r1-13.md)。
