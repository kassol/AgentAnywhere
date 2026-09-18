# W0 复现与运行

状态：验证进行中；此目录用于固定上游基线的独立探针，尚未完成产品集成。

## Craft 基线

- 源码：Craft v0.13.3，提交 `e8963854c3679edcceb105a42537a06749e6cb64`。
- Bun：与上游 CI 一致的 1.3.10；基础镜像 digest 见 `prepare-craft.py`。
- 上游来源：[Craft](https://github.com/craft-ai-agents/craft-agents-oss/tree/e8963854c3679edcceb105a42537a06749e6cb64)，Apache-2.0；源码与许可证保留在独立检出目录。
- `prepare-craft.py` 从原 Dockerfile 生成构建文件，移除指向开源快照中四个缺失目录的 COPY，并固定基础镜像；在独立源码目录将 CLI 的 `@types/bun: latest` 声明固定为锁文件现有的 `1.4.1`（manifest 与 lock workspace 各一处），全部 resolved 依赖保持不变。请对原始快照运行一次。

在独立检出目录之外生成 Dockerfile，然后构建：

```sh
python3 infra/w0/prepare-craft.py <upstream-directory> > /tmp/Dockerfile.craft
docker build -f /tmp/Dockerfile.craft -t agentanywhere-w0-craft:e896385 <upstream-directory>
```

## 部署与凭证

Compose 仅将 WebUI/RPC 发布到 `127.0.0.1:19100`；数据保存在独立命名卷。`/opt/agentanywhere-w0/craft.env` 为主机上的 0600 文件，由部署时生成，包含独立的 `CRAFT_SERVER_TOKEN`、`CRAFT_WEBUI_PASSWORD`，以及：

```text
CRAFT_WEBUI_SECURE_COOKIE=true
CRAFT_WEBUI_WS_URL=wss://<user-configured-host>
CRAFT_DISABLE_MESSAGING=true
CRAFT_VERSION=0.13.3-w0
HOME=/home/craftagents
```

将此目录的 `resolv.conf` 部署到 `/opt/agentanywhere-w0/resolv.conf`（0644）。cc-la 上 runsc 容器无法使用 Docker 的 `127.0.0.11` DNS，独立只读挂载改用该主机已有的上游 DNS；不修改宿主机 DNS。换主机时先验证 DNS，不直接沿用此配置。

公开域名由所有者配置。初始本机验证使用 loopback WebSocket 地址，正式反代验证前替换为真实 `wss://` 地址并重建本测试容器。OpenResty 须转发 WebSocket Upgrade，保留 Host，设置 X-Forwarded-Proto；使用 HTTPS。

上游启动日志会输出 server token；原始日志仅保留在主机，公开证据必须先脱敏。provider 与模型由所有者在登录后配置。

## 登录检查

```sh
docker exec -i agentanywhere-w0-craft sh -c \
  'cat > /tmp/craft-auth-probe.ts && bun /tmp/craft-auth-probe.ts' \
  < infra/w0/check-craft-auth.ts
```

此检查覆盖未登录 HTTP、错误密码、成功登录、Cookie 标志与 WebSocket 握手。反向代理与真实浏览器仍须单独验证。

## 清理

人工模型配置和验证期间保留测试服务。全部验证结束且成果保存后，在目标主机执行 `docker compose -f /opt/agentanywhere-w0/compose.yaml down --volumes`，只移除本项目资源。
