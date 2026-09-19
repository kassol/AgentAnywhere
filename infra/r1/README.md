# R1 执行链路

`compose.yaml` 只管理 R1 的 Web、PostgreSQL 和 queue；`sandbox.compose.yaml` 继续管理 OpenSandbox。镜像版本固定为 Bun 1.4.2、Node 24.21、Pi 0.85.1、pg-boss 12.26.3、OpenSandbox SDK 0.1.11。`Dockerfile.agent` 将沙箱内运行程序与 Pi 依赖装入非 root 镜像。模型长期凭证只保存在 Web 的受限 `data/model-connection.json`；可信 queue 持有数据库与 OpenSandbox 管理凭证并生成每次 Run 的短 token。沙箱只持短 token，通过 Web 内部模型代理调用快照固定的模型与协议。

正式文件统一位于 `/opt/agentanywhere`：`runtime/` 保存运行配置和持久文件，`releases/<完整 SHA>/` 保存发布源码，`backups/` 保存私有备份，`checks/<完整 SHA>/` 保存隔离验收临时文件。目标仅为 `cc-la`。Compose 项目名继续使用 `agentanywhere-r1`，正式卷和三个网络名称保持不变。正式 Web、queue、agent 和隔离测试的模型 fixture 镜像都使用同一个完整 Git commit SHA 作为标签；不要复写运行中或回退所需的镜像标签。先在本地已提交且干净的发布工作树中，将固定提交导出到主机：

```sh
release=$(git rev-parse HEAD)
test -z "$(git status --porcelain)"
git archive "$release" | ssh cc-la "mkdir -p /opt/agentanywhere/releases/$release && tar -x -C /opt/agentanywhere/releases/$release"
ssh cc-la "source=/opt/agentanywhere/releases/$release; for component in web queue agent; do
  if docker image inspect agentanywhere-r1-\${component}:$release >/dev/null 2>&1; then
    echo 'Release image tag already exists' >&2; exit 1
  fi
  docker build -t agentanywhere-r1-\${component}:$release -f \$source/infra/r1/Dockerfile.\$component \$source || exit
done
if docker image inspect agentanywhere-r1-model-fixture:$release >/dev/null 2>&1; then
  echo 'Release fixture image tag already exists' >&2; exit 1
fi
docker build -t agentanywhere-r1-model-fixture:$release -f \$source/infra/r1/Dockerfile.fixture \$source"
```

`database.env` 需为 0600，含 `DATABASE_URL=postgresql://agentanywhere_app:<URL编码密码>@postgres:5432/agentanywhere`；`service.env` 保留登录与 HTTPS origin，`opensandbox.env` 保留 OpenSandbox 管理凭证。每次发布前确认对应的私有数据库、成果和配置备份完整，再把发布提交的 `infra/r1/compose.yaml`、`deploy.sh` 复制到部署目录，执行 `ssh cc-la "sh /opt/agentanywhere/runtime/deploy.sh /opt/agentanywhere/runtime $release"`。脚本先校验 SHA、三个镜像、PostgreSQL 健康及 Compose 配置，读取 PostgreSQL 在 `agentanywhere-r1_default` 网络的当前 IP，为 gVisor Web 写入容器级 `/etc/hosts` 映射，等 Web 建表并健康后启动 queue。PostgreSQL 容器重建后须重新部署，以更新 IP 映射。不要将管理凭证传入沙箱。

`artifacts/` 是 Web 只读、queue 可写的持久成果目录。部署脚本创建该目录并交给非 root queue 用户。成果版本记录在 PostgreSQL；文件先从沙箱复制、核验大小及 SHA-256，成功后才登记版本并回收沙箱。保存失败会保留沙箱并在工作详情提供重试；回收失败也可从同一入口重试。备份需同时包含数据库与 `artifacts/`，并保存 `data/` 中的模型连接。

## 旧目录一次性迁移

旧根 `/opt/agentanywhere-r1` 迁移到新根时使用人工清单。不要把这段流程做成常驻迁移器。先记录当前和上一健康版本，并确认两版的源码、三个镜像均存在。正式 Web 使用的系统 runtime 仍由 `/etc/docker/daemon.json` 指向 `/opt/agentanywhere-w0-runtime-release-20260914.0/runsc`；本次不移动该目录、不改 daemon 配置、不重启 Docker。

迁移前检查工作 Run 和管家轮次均无执行中、排队中或停止中记录：

```sh
active=$(docker exec agentanywhere-r1-postgres psql -U agentanywhere_admin -d agentanywhere -Atqc \
  "SELECT (SELECT count(*) FROM work_runs WHERE active OR status IN ('queued','provisioning','running','cancelling')) +
          (SELECT count(*) FROM steward_turns WHERE active OR status IN ('queued','running','stopping'))")
test "$active" = 0
```

先停止 Web 和 queue，随后再执行同一查询，关闭检查与停服之间的竞态。第二次结果不为 0 时立即从旧根恢复 Web/queue，停止迁移。第二次检查通过后，先创建 0700 的 `/opt/agentanywhere/backups`，再在 `<时间>-directory-migration/` 创建数据库、`artifacts/`、`data/`、运行配置的配对备份；使用 `pg_restore --list` 检查数据库归档，使用 `tar -tf` 检查文件归档，生成并执行 `sha256sum -c SHA256SUMS`。同时逐一执行旧备份目录已有的 `SHA256SUMS`、`final-SHA256SUMS` 和 `public-acceptance-SHA256SUMS`，任何失败都恢复旧服务并停止迁移。

备份通过后，创建 0700 的 `runtime/` 和 `releases/`。使用 `cp -a` 保留原所有者与权限：只复制当前和上一健康版本到 `releases/<SHA>/`，复制旧备份到 `backups/`，复制正式 env、密码文件、Compose、deploy、`data/`、`artifacts/`、`opensandbox-data/` 和 OpenSandbox/SearXNG 配置到 `runtime/`。停止并从旧 Compose 移除五个正式容器时不得使用 `-v`；从新根以相同 Compose 项目名重建 SearXNG、OpenSandbox、PostgreSQL，再执行 `deploy.sh /opt/agentanywhere/runtime <当前 SHA>`。公网代理端口仍为 `19110`。

核对容器 Compose 标签和 bind mount 均指向新 `runtime/`，再完成 HTTPS/WSS、登录、搜索、真实工作、成果下载和同机其他服务验收。完整验收前保留旧根和旧镜像。失败时从新根停容器且不加 `-v`，使用旧根和原 SHA 重建；继续使用原 PostgreSQL 卷，不自动恢复数据库。完整验收后，先将旧根移入新 `backups/legacy-layout-<日期>/` 作为短期回退，再清理无引用的中间源码和镜像；旧顶级备份目录须逐个历史备份子目录执行 `diff -qr <旧子目录> <新子目录>`，全部一致后再删除。

## 正式发布与回退

2026-09-18 已在 cc-la 建立 root:root、0700 的私有发布备份；目录迁移后保存于 `/opt/agentanywhere/backups/20260918-r1-release`。其中 `agentanywhere.dump` 经 `pg_restore --list` 检查通过；`r1/` 保存备份时的 Compose、deploy、0600 env、密码文件和 `data/`，并保留 Web/queue inspect；`w0/` 保存 Craft 配置、`craft.env`、`webui-password` 和容器 inspect；`proxy-root.conf` 保存当时的公网代理。备份时正式 `artifacts/` 尚不存在。保留该历史备份，不覆盖；后续发布另存数据库与 `artifacts/` 配对快照，并记录发布 SHA 与镜像 ID。TLS 私钥已由 root 改为 0600，OpenResty master/worker 均以 root 运行，修改后 `openresty -t` 实际通过，未 reload。

首次回收 W0 前须最终归档完整用户数据卷。Craft 上游归档 `/opt/agentanywhere-w0/upstream/craft.tar.gz` 中的 `packages/shared/src/credentials/backends/secure-storage.ts:84-98,336-343` 先读取容器内两个 machine-id 路径；2026-09-18 以 Node `existsSync` 实测两者均不存在，当时身份回退到 `craftagents:/home/craftagents`，旧版密钥推导还使用容器 hostname。容器内 username、uid/gid、home、hostname 和两个存在性布尔值已保存到私有备份 `w0/identity.json`（0600）；无需复制宿主 SSH 或 TLS 私钥。最终归档先停止已不再承载公网流量的 Craft，保存 W0 工作目录和 `agentanywhere-w0_craft-data` 卷；归档失败时重新启动 Craft 并保留卷。以下命令只在最终回收窗口于 cc-la 执行：

```sh
set -eu
cd /
umask 077
backup=/opt/agentanywhere/backups/20260918-r1-release
test -f "$backup/w0/identity.json"
docker stop agentanywhere-w0-craft >/dev/null
trap 'docker start agentanywhere-w0-craft >/dev/null' 0 1 2 3 15
tar -cpf "$backup/w0-files-final.tar" opt/agentanywhere-w0
volume=$(docker volume inspect -f '{{.Mountpoint}}' agentanywhere-w0_craft-data)
tar -C "$volume" -cpf "$backup/w0-craft-data-final.tar" .
(cd "$backup" && sha256sum w0-files-final.tar w0-craft-data-final.tar > final-SHA256SUMS)
trap - 0 1 2 3 15
```

核对归档及 `final-SHA256SUMS` 后，方可回收 W0 卷。归档保存在主机独立的 root:root 0700 目录，文件为 0600；不得公开凭据内容。

今后正式环境出现成果时，数据库与 `artifacts/` 必须在无活跃执行窗口配对备份。发布代码只更新 Compose、部署脚本和三个正式镜像；保留现有 0600 env、PostgreSQL 卷、`data/`、`artifacts/`、OpenSandbox 与私有 SearXNG。复制发布文件并部署：

```sh
ssh cc-la "cp /opt/agentanywhere/releases/$release/infra/r1/compose.yaml /opt/agentanywhere/runtime/compose.yaml &&
  cp /opt/agentanywhere/releases/$release/infra/r1/deploy.sh /opt/agentanywhere/runtime/deploy.sh &&
  sh /opt/agentanywhere/runtime/deploy.sh /opt/agentanywhere/runtime $release"
```

脚本只部署正式 Web 与 queue，不修改公网代理。确认 `19110/login` 为 HTTP 200、Web 健康、queue 运行、Web/queue 分别只读/读写挂载 `artifacts/`，queue 加入 `agentanywhere-r1-search`，真实 SearXNG 查询成功。首次从 W0 切换公网入口时，cc-la 的站点文件 `/opt/1panel/www/conf.d/agent.riverflows.in.conf` 引入 `proxy/root.conf`；先核对代理仍指向 `19100` 且文件与私有旧代理备份一致，再只改代理目标并保留 Host、X-Forwarded-Proto 与 WebSocket Upgrade。后续发布如已指向 `19110`，无需修改代理：

```sh
set -eu
backup=/opt/agentanywhere/backups/20260918-r1-release
proxy=/opt/1panel/www/sites/agent.riverflows.in/proxy/root.conf
if grep -Fq 'proxy_pass http://127.0.0.1:19110;' "$proxy"; then
  test "$(grep -Fc 'proxy_pass http://127.0.0.1:19110;' "$proxy")" -eq 1
  test "$(grep -Fc 'proxy_pass http://127.0.0.1:19100;' "$proxy")" -eq 0
else
  test "$(grep -Fc 'proxy_pass http://127.0.0.1:19100;' "$proxy")" -eq 1
  cmp "$proxy" "$backup/proxy-root.conf"
  sed -i 's@proxy_pass http://127.0.0.1:19100;@proxy_pass http://127.0.0.1:19110;@' "$proxy"
  docker exec 1Panel-openresty-T6pp openresty -t
  docker exec 1Panel-openresty-T6pp openresty -s reload
fi
```

从公网验证 HTTPS 登录、匿名拒绝、WSS、两种真实模型协议、搜索、成果与浏览器完整路径；检查 cc-la 其他服务正常。

首次切换后的公网验收失败、且 W0 容器仍在 `19100` 运行时，确认 W0 健康，再从私有备份恢复原代理文件：

```sh
set -eu
backup=/opt/agentanywhere/backups/20260918-r1-release
cp -p "$backup/proxy-root.conf" /opt/1panel/www/sites/agent.riverflows.in/proxy/root.conf
docker exec 1Panel-openresty-T6pp openresty -t
docker exec 1Panel-openresty-T6pp openresty -s reload
```

正式 R1 部署失败时，使用此前记录的健康版本完整 SHA，恢复该提交的 Compose 与部署脚本；旧镜像标签须仍可用：

```sh
set -eu
: "${previous_release:?set the previous healthy 40-character commit SHA}"
cp "/opt/agentanywhere/releases/$previous_release/infra/r1/compose.yaml" /opt/agentanywhere/runtime/compose.yaml
cp "/opt/agentanywhere/releases/$previous_release/infra/r1/deploy.sh" /opt/agentanywhere/runtime/deploy.sh
sh /opt/agentanywhere/runtime/deploy.sh /opt/agentanywhere/runtime "$previous_release"
```

首次发布尚无健康的完整 SHA 版本时，2026-09-18 私有备份中的 `r1/compose.yaml`、`r1/deploy.sh` 可恢复备份时的服务配置；先核对旧镜像仍在，并按备份脚本自身用法执行。W0 容器或数据卷回收后，不能直接把公网代理切回 `19100`。确需回到 W0 时，先从私有归档恢复 W0 工作目录、数据卷、凭证和原容器身份，确认 `19100` 可用，再恢复旧代理；通常优先按上面的完整 SHA 回退到前一个健康 R1。不要自动回滚数据库：还原数据库和 `artifacts/` 会丢弃快照之后的工作，应单独确认范围再执行。

待正式入口稳定、W0 最终私有归档和 SHA-256 校验完成后，执行 `docker compose -f /opt/agentanywhere-w0/compose.yaml down --volumes` 回收 W0 Craft 容器、`agentanywhere-w0_craft-data` 卷和 W0 Compose 网络，执行 `! docker volume inspect agentanywhere-w0_craft-data >/dev/null 2>&1` 核对卷已删除。可随后清理 W0 专用镜像 `agentanywhere-w0-craft:e896385-pi1` 与 `/opt/agentanywhere-w0/` 工作目录；保留站点 TLS 证书、gVisor runtime、OpenSandbox 和正式 R1 资源。记录回收证据后关闭 W0 Issue #1。

测试资源单独清理。先用 `docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' agentanywhere-r1-test-web-1` 确认清理时的隔离 Compose 路径及项目名；停用该 Compose 时不加 `-v`。核对测试 schema 的实际所有者和 `test.env` 引用，再只删除对应 schema、`checks/<release>/`、fixture 容器与无引用的测试镜像；其中 `test_compose` 必须先设为刚核对的路径。`19114` 真实模型隔离栈按自身 Compose 路径另行核对。正式 PostgreSQL 卷 `agentanywhere-r1-postgres-data`、`runtime/data/`、`runtime/artifacts/`、搜索服务和 Sandbox 网络始终保留。

隔离回归使用 `test.compose.yaml`、独立 schema/数据目录、可由 queue 用户写入的 `test-artifacts/` 和 `model-fixture.mjs`。上文已按同一 SHA 构建 Web、queue、agent、fixture 四镜像；`TEST_RELEASE` 必须设为该完整 SHA。先在真实 PostgreSQL 的 `agentanywhere` 库为本次发布建立独立应用 schema 和 pg-boss schema，授权 `agentanywhere_app`。例如在 cc-la 的部署目录执行以下命令；已有同名 schema 时先核对归属，不能复用别的测试数据：

```sh
test_schema="r1test_$(printf '%.12s' "$release")"
boss_schema="${test_schema}_boss"
docker exec agentanywhere-r1-postgres psql -U agentanywhere_admin -d agentanywhere -v ON_ERROR_STOP=1 \
  -c "CREATE SCHEMA \"$test_schema\" AUTHORIZATION agentanywhere_app" \
  -c "CREATE SCHEMA \"$boss_schema\" AUTHORIZATION agentanywhere_app"
```

将 `test.compose.yaml`、`live-test.compose.yaml`、`test.env`、`live-test.env`、`test-password`、测试数据和成果集中放在 `/opt/agentanywhere/checks/$release`。两份 env 和密码文件保持 0600；`test.env` 的 `DATABASE_URL` 使用 `-csearch_path=<test_schema>`，`QUEUE_SCHEMA` 使用 `<boss_schema>`。不要把正式 `runtime/data/` 或正式 schema 挂给测试栈。测试脚本仍支持 `TEST_PASSWORD_FILE` 和 `TEST_ISOLATED_MODEL_CONFIG_FILE` 覆盖；服务器验收必须显式传入本次 `checks/<release>` 路径。

在 cc-la 发布目录确认四个 SHA 标签、两个 schema、`test.env` 与 `test-password` 均已就绪，再执行：

```sh
check_root="/opt/agentanywhere/checks/$release"
install -d -m 0700 "$check_root"
cp "/opt/agentanywhere/releases/$release/infra/r1/test.compose.yaml" "$check_root/test.compose.yaml"
cp "/opt/agentanywhere/releases/$release/infra/r1/live-test.compose.yaml" "$check_root/live-test.compose.yaml"
cd "$check_root"
TEST_RELEASE="$release" docker compose -f test.compose.yaml config --quiet
TEST_RELEASE="$release" TEST_CONTROL_PLANE_ORIGIN=https://agent.riverflows.in docker compose -f test.compose.yaml up -d
TEST_PASSWORD_FILE="$check_root/test-password" \
TEST_CONTROL_PLANE_ORIGIN=https://agent.riverflows.in \
OPEN_SANDBOX_DOMAIN=127.0.0.1:19510 \
OPEN_SANDBOX_API_KEY="$(sed -n 's/^OPEN_SANDBOX_API_KEY=//p' test.env)" \
node "/opt/agentanywhere/releases/$release/infra/r1/test-all.mjs" isolated
```

首次启动与验收使用相同的 `TEST_CONTROL_PLANE_ORIGIN=https://agent.riverflows.in`，以验证公网控制面 IP 拒绝。isolated 与 live 共享 OpenSandbox 的宿主端口分配，须串行执行，避免并发创建沙箱时端口冲突。失败后可用 `test-all.mjs <模式> <检查名>` 从该项继续，输出会注明前项沿用已有结果；不得将续跑单独描述为全量通过。

该栈固定为 Web `127.0.0.1:19112`、fixture `127.0.0.1:19113`；`checks/$release/test-data/` 和 `test-artifacts/` 与正式数据分离。统一入口 `node infra/r1/test-all.mjs [isolated|live|public]` 默认 isolated；该模式重启隔离 fixture，先在 Web 镜像内使用真实数据库运行完整 Bun 测试，再顺序调用 R1 执行链路及 R2 管家查询、派发、控制、状态、回答、摘要、重试、改稿的 Web/API 测试。模型 HTTP fixture 是唯一可控响应边界；数据库、pg-boss、Pi 与 OpenSandbox 均使用真实服务。测试期间脚本会重启隔离 queue/Web 并临时修改隔离成果目录权限，勿与其他 19112/19113 验收并发。live 模式要求单独 19114 栈、`$check_root/live-data/model-connection.json` 私有模型连接副本和真实 SearXNG；执行 `TEST_ISOLATED_MODEL_CONFIG_FILE="$check_root/live-data/model-connection.json" TEST_PASSWORD_FILE="$check_root/test-password" node "/opt/agentanywhere/releases/$release/infra/r1/test-all.mjs" live`。public 模式在公网切换后执行 `TEST_PASSWORD_FILE=/opt/agentanywhere/backups/20260918-r1-release/w0/webui-password node "/opt/agentanywhere/releases/$release/infra/r1/test-all.mjs" public`，密码从原 W0 安全文件读取，不输出内容。测试完按上文精确清理隔离 Compose、schema、数据和无引用的测试镜像。

真实 sub2api 的双协议连接测试和 Pi 工具往返分别见 [R1-05](../../docs/evidence/r1-05.md) 与 [R1-06](../../docs/evidence/r1-06.md)。`submit_report` 在沙箱内写报告与文本附件；同一 Run 的修订报告先写新 generation，再原子更新 manifest 指针，queue 按该指针校验并提交 Artifact/Version。执行中追加要求通过 `POST /api/runs/:id/messages` 保存，并由当前 epoch 的 Pi 在下一模型步骤接收；隔离流式回归运行 `node infra/r1/test-steering.mjs`，结果见 [R1-09](../../docs/evidence/r1-09.md)。取消隔离回归使用 `node infra/r1/test-cancel.mjs`，结果见 [R1-11](../../docs/evidence/r1-11.md)。

R1-08 的 queue 同时连接 `agentanywhere-r1-search` 专用网络，从固定 `http://agentanywhere-r1-searxng:8080` 查询 JSON；沙箱仅凭本次 Run 短 token 调用 queue 的 `search_web` 与 `open_public_page` 工具入口。queue 从 `service.env` 读取 `AGENTANYWHERE_PUBLIC_ORIGIN`，以主机名和实时解析地址拒绝控制面 URL。公开网页逐跳校验 DNS 解析地址并固定连接目标，仅提取 HTTP 文本；搜索结果包含部分失败的引擎。测试环境将 `SEARCH_ORIGIN` 指向同网络的模型/搜索 HTTP fixture；`node infra/r1/test-research.mjs` 从公开 API 验证主题、指定 URL、私网与控制面公网 IP 拒绝，并通过 `/waiting-search`、`/release-search` 控制真实工具执行中的搜索响应。该脚本需要 `TEST_PASSWORD_FILE`、与 queue 环境一致的 `TEST_CONTROL_PLANE_ORIGIN` 和固定的 19112/19113 隔离端口。
故障恢复与执行上限的隔离回归使用 `node infra/r1/test-recovery.mjs`，覆盖模型短暂故障、持续失败后的检查点与手动新 Run、queue 中断清理、40 次模型调用后明确继续。脚本使用独立测试环境的 19112/19113 端口，会重启测试 queue 容器。45 分钟边界在 `src/work.test.ts` 中通过服务端注入的测试时钟和真实 PostgreSQL 检查；生产 API 不接受限额或时钟覆盖。每次继续增加 45 分钟与 40 次模型调用额度，决定及前后额度保存在 Run 事件中。
完成后继续工作通过 `POST /api/tasks/:id/runs` 在原 Task/Thread 创建新 Run；新执行读取并校验前次已交付报告，保留旧版本。隔离回归脚本为 `node infra/r1/test-continuation.mjs`，覆盖新旧报告、失败保留、Web 重启和沙箱回收；执行结果记录在 [R1-13](../../docs/evidence/r1-13.md)。

真实模型与搜索验收使用另一个隔离 schema 和 `19114` 端口。Web 将独立 `live-data/` 目录可写挂载到 `/data`，其中的模型连接是正式配置的私有副本；queue 连接 `agentanywhere-r1-search`。运行上述 `test-all.mjs live` 覆盖双协议真实 Run、取消、模型错误和搜索；脚本从公开 API 核查工具结果、报告引用及沙箱回收。证据见 [R1-08](../../docs/evidence/r1-08.md) 与 [R1-14](../../docs/evidence/r1-14.md)。

2026-09-19 R2 已发布，应用 SHA 为 `6787b70a47a96c8ab9b20056d1d67e3fb0efbbed`；配对备份迁移后位于 `/opt/agentanywhere/backups/20260919-r2-release`。前一健康版本 `ac7f88d8ed0ce6dbf12f704026c68cb25aa48e26` 的构建及正式镜像保留，可按上文流程回退。R2 三阶段验收、旧数据兼容、浏览器和清理结果见 [R2-12](../../docs/evidence/r2-12.md)。
