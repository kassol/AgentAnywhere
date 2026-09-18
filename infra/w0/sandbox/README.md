# W0 OpenSandbox 准备方案

状态：已在 cc-la 完成 gVisor 注册与 OpenSandbox 生命周期验证；结果见 [W0 证据](../../../docs/evidence/w0/)。本轮控制容器、沙箱、网络及 SDK 环境已清理；runtime 和镜像保留供后续浏览器验证。

## 固定来源

- gVisor：`release-20260914.0`，Linux x86_64；[官方发布](https://github.com/google/gvisor/releases/tag/release-20260914.0)。`install-runtime.py` 内嵌官方 SHA512，本地下载的 158 MiB tar 包已核对摘要与布局。
- OpenSandbox：`server/v0.2.3`，commit `c39b814f36ded4c61d5ac6f9332ee4dfbab86c00`；保留上游 Apache-2.0 LICENSE 与文件头。
- Python SDK：`opensandbox==0.1.16`。
- execd：`opensandbox/execd:v1.0.22`，与该服务版本的 `examples/example.config.toml` 一致；执行时记录镜像 digest。
- 测试镜像：执行时拉取 `ubuntu:24.04`，将实际 RepoDigest 传给 `W0_SANDBOX_IMAGE`。构建基础镜像也记录 digest；当前未声称构建达到字节级可复现。

## 已核查源码

固定版本目录：[`server/opensandbox_server/`](https://github.com/alibaba/OpenSandbox/tree/c39b814f36ded4c61d5ac6f9332ee4dfbab86c00/server/opensandbox_server)。

- `config.py` 定义 `SANDBOX_CONFIG_PATH`、`OPENSANDBOX_SERVER_API_KEY`；`DockerConfig.network_mode` 接受独立网络名。`host_ip` 只用于返回 endpoint URL。
- `services/runtime_resolver.py:169` 核对 Docker 登记的 runtime；`services/docker/container_ops.py:377` 将指定 runtime 注入 HostConfig。
- `services/docker/port_allocator.py:25,96` 默认绑定所有接口；`services/docker/networking.py:426` 的 egress sidecar 另有两个相同绑定。`patch-loopback.py` 精确替换这三处，先校验提交及干净工作区。其余源码保持原样。
- SDK `sandbox.py:397` 的 `destroy()` 先 kill 再 close。context manager 仅 close；探针显式 destroy，并检查容器消失及成果仍可读取。

## 后续执行顺序（仅 cc-la）

1. 复核 `/opt/agentanywhere-w0` 路径、`19310` 和 `19320–19420` 端口未占用；记录现有容器 ID、StartedAt、RestartCount 及 Docker PID。
2. 审阅并执行 `sudo python3 install-runtime.py --apply`。脚本校验下载摘要，仅新增 `agentanywhere-w0-runsc` 条目，runtime 放在新建的 `/opt/agentanywhere-w0-runtime-release-20260914.0`（755，允许降权后重新执行）；现有 W0 目录保持 700。保留现有配置与默认 runtime，先运行 `dockerd --validate` 校验候选配置，再备份原配置、写入并运行 `systemctl reload docker`。禁止 restart；失败保留现场及备份，先读日志再处理。再次比对原容器状态与 Docker PID，并单独验证 hello-world。
3. 在独立目录检出上述 OpenSandbox commit，执行 `python3 patch-loopback.py <checkout>`。在 `server/` 使用上游 Dockerfile 与 uv.lock 构建，传 `--build-arg SETUPTOOLS_SCM_PRETEND_VERSION=0.2.3`，记录镜像 ID。
4. 创建名为 `agentanywhere-w0-sandbox` 的独立 bridge 网络；已存在时核对归属，不复用未知网络。将 `server.toml` 放到 W0 配置目录。独立控制容器使用 host 网络，使 server 的 `127.0.0.1:19310` 可访问宿主机回环映射。只给可信控制服务挂 Docker socket，沙箱不挂。
5. 用权限 `0600` 的独立 env 文件传入随机 `OPENSANDBOX_SERVER_API_KEY`；不写仓库、不打印密钥。挂载配置只读，SQLite 指向 W0 专属目录。启动参数为 `opensandbox-server --config <config-path>`。服务不得对公网暴露。
6. 独立 Python 环境安装固定 SDK。在 cc-la 设置同值的 `OPEN_SANDBOX_API_KEY` 及测试镜像 `W0_SANDBOX_IMAGE=ubuntu@sha256:…`，执行 `lifecycle.py`。输出包含 sandbox ID，便于失败时精确回收；不依赖全局 prune。
7. 保存脱敏日志、镜像 digest 和配置补丁。核对沙箱 HostConfig.Runtime、所有发布端口的 HostIp；探针通过后停止并清理本轮控制容器、独立网络及测试数据。保留导出的成果证据。runtime 条目与二进制按最终 W0 清理决定处理；回退只移除本任务条目并 reload，避免覆盖其他人的后续配置。

官方 [gVisor 安装流程](https://gvisor.dev/docs/user_guide/install/) 与 [Docker runtime 配置](https://docs.docker.com/reference/cli/dockerd/#configure-runtimes-using-daemonjson)支持 reload。cc-la 已只读确认 Docker 29.6.0、CanReload=yes、ExecReload=HUP。实际 reload、hello-world 和 OpenSandbox 生命周期已验证；既有 9 个容器及 Docker 进程未重启。

## 本地检查

```sh
PYTHONDONTWRITEBYTECODE=1 python3 infra/w0/sandbox/check.py
```

已通过配置合并保留既有选项、冲突保护和补丁漂移保护检查。另用固定上游 `AppConfig.model_validate` 验证 `server.toml` 通过。已对 `/tmp/agentanywhere-w0/opensandbox` 的固定提交实际应用补丁；安装、服务启动与生命周期探针已通过；浏览器/noVNC 接管另行验证。
