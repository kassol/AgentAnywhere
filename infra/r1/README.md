# R1 执行链路

`compose.yaml` 只管理 R1 的 Web、PostgreSQL 和 queue；`sandbox.compose.yaml` 继续管理 OpenSandbox。镜像版本固定为 Bun 1.3.10、Node 24.21、Pi 0.85.1、pg-boss 12.26.3、OpenSandbox SDK 0.1.11。`Dockerfile.agent` 将沙箱内运行程序与 Pi 依赖装入非 root 镜像。模型长期凭证只保存在 Web 的受限 `data/model-connection.json`；可信 queue 持有数据库与 OpenSandbox 管理凭证并生成每次 Run 的短 token。沙箱只持短 token，通过 Web 内部模型代理调用快照固定的模型与协议。

部署目录为 `/opt/agentanywhere-r1`。将仓库工作树复制到部署目录的 `build-r1-05`，从本目录复制 `compose.yaml` 和 `deploy.sh` 到部署目录。构建正式镜像：

```sh
docker build -t agentanywhere-r1-web:r1-05 -f build-r1-05/infra/r1/Dockerfile.web build-r1-05
docker build -t agentanywhere-r1-queue:r1-05 -f build-r1-05/infra/r1/Dockerfile.queue build-r1-05
docker build -t agentanywhere-r1-agent:r1-05 -f build-r1-05/infra/r1/Dockerfile.agent build-r1-05
```

`database.env` 需为 0600，含 `DATABASE_URL=postgresql://agentanywhere_app:<URL编码密码>@postgres:5432/agentanywhere`；`service.env` 保留登录与 HTTPS origin，`opensandbox.env` 保留 OpenSandbox 管理凭证。执行 `sh /opt/agentanywhere-r1/deploy.sh`：脚本读取现有 R1 PostgreSQL 在 `agentanywhere-r1_default` 网络的当前 IP，为 gVisor Web 写入容器级 `/etc/hosts` 映射，等 Web 建表并健康后启动 queue。PostgreSQL 容器重建后须重新执行脚本，以更新 IP 映射。不要将管理凭证传入沙箱。

隔离回归使用 `test.compose.yaml`、独立 schema/数据目录和 `model-fixture.mjs`。隔离 Compose 的 Agent 与 fixture 镜像使用 `r1-06` 标签；将当前仓库工作树放在 `build-r1-06` 后构建：

```sh
docker build -t agentanywhere-r1-agent:r1-06 -f build-r1-06/infra/r1/Dockerfile.agent build-r1-06
docker build -t agentanywhere-r1-model-fixture:r1-06 -f build-r1-06/infra/r1/Dockerfile.fixture build-r1-06
```

将 `test-run.mjs` 放在远程构建目录对应位置，`TEST_PASSWORD_FILE` 指向隔离 Web 的 0600 密码文件；运行 `node infra/r1/test-run.mjs`。脚本通过公开 API 创建串行 Run，核查 Pi 工具参数和真实观察结果、流式消息、事件去重、已知/未知用量，以及 OpenSandbox SDK 按 Run ID 查不到存活沙箱。模型 HTTP fixture 是唯一可控边界；数据库、pg-boss、Pi 与 OpenSandbox 均使用真实服务。默认隔离端口为 Web `127.0.0.1:19112`、fixture `127.0.0.1:19113`。测试完删除隔离 Compose、schema、数据和本地临时镜像。

Chat Completions 与 Responses 的最小 echo 工具链路已通过隔离回归；真实 sub2api 的双协议连接测试和 Pi 工具往返分别见 [R1-05](../../docs/evidence/r1-05.md) 与 [R1-06](../../docs/evidence/r1-06.md)。搜索、报告、追加/取消和正式浏览器接管由后续票实现。
