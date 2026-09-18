# W0 执行证据

日期：2026-09-18。环境：指定主机 `cc-la`，Ubuntu 24.04 x86_64。范围为独立上游基线验证，产品集成仍待后续任务。

## 结果

| 验证项 | 结果 | 证据与限制 |
| --- | --- | --- |
| gVisor 注册与基础容器 | 通过 | [runtime-result.json](runtime-result.json)；reload 后原有 9 个容器及 Docker PID 未变 |
| OpenSandbox 生命周期 | 通过 | [探针结果](sandbox-probe-result.json)、[运行日志](sandbox-lifecycle.log)；创建、命令、文件、状态、销毁及成果保留均通过 |
| OpenSandbox 清理 | 通过 | [sandbox-cleanup.json](sandbox-cleanup.json)；控制容器、沙箱、网络、SDK 环境及测试数据库已移除 |
| Craft 构建与启动 | 通过 | [craft-result.json](craft-result.json)；固定源码在 gVisor 下以非 root 运行 |
| Craft 登录与实时连接鉴权 | 通过 | [可执行检查](../../../infra/w0/check-craft-auth.ts)；匿名 API 401、主页跳转登录、错误密码 401、成功登录 Cookie 含 HttpOnly/SameSite=Strict/Secure；匿名 RPC 握手关闭码 4005，登录后握手成功 |
| Craft 真实浏览器登录 | 通过 | [登录后截图](craft-onboarding.png)；通过公网 HTTPS 登录，进入 provider 配置页 |
| 公网 HTTPS / WebSocket 反代 | 通过 | `https://agent.riverflows.in` 登录成功；匿名 config 401，登录后 config 200，浏览器 WSS 握手成功 |
| Pi / sub2api 连接测试 | 通过 | 所有者手动填入新 Key；`https://sub.riverflows.in/v1`、`gpt-6-astra` 的真实 mini completion 在 6102ms 成功。会话验证结果见下行 |
| Pi 真实会话 | 通过 | [事件与用量](pi-session-result.json)、[页面截图](pi-session.png)；7 段流式输出、Bash `pwd`、取消响应与 19k token 展示通过；费用核对未覆盖 |
| Chromium / noVNC | 通过 | [结果](browser-result.json)、[sandbox 状态](sandbox.txt)、[公开页截图](example.png)、[接管截图](takeover.png)、[下载文件](download.txt)；非 root、namespace/seccomp、截图、下载与同实例输入全部通过 |

## 固定版本与最小修改

- Craft v0.13.3：`e8963854c3679edcceb105a42537a06749e6cb64`，Bun 1.3.10。上游 Dockerfile 引用四个开源快照中缺失的目录；仅删除其 COPY。CLI 的 `@types/bun: latest` 使 frozen install 尝试更新锁文件，将该声明固定为锁内现有 1.4.1 后构建通过，resolved 依赖未改变。
- gVisor：`release-20260914.0`，独立 runtime `agentanywhere-w0-runsc`；保持系统默认 runtime。
- OpenSandbox server/v0.2.3：`c39b814f36ded4c61d5ac6f9332ee4dfbab86c00`，SDK 0.1.16、execd 1.0.22；仅将三处端口绑定改为 loopback，实际 HostConfig 已验证。镜像 digest 见探针结果。
- 浏览器镜像和探针见 [browser](../../../infra/w0/browser/README.md)。

实测同一专用 bridge 上 runc 可经 Docker `127.0.0.11` 解析域名，runsc 失败；Craft 的 Bun 同样超时。W0 容器只读挂载独立 `resolv.conf`，使用该主机已配置的上游 DNS 后，Craft 域名解析及公开 HTTPS 请求返回 200。该调整仅作用于 W0 容器，宿主 DNS 保持原样。

Chromium 初次运行出现 GPU 初始化退出和截图错误；增加 `--disable-gpu` 使用 CPU 渲染后截图通过，浏览器 sandbox 保持启用。noVNC 经 SSH 隧道与 VNC 密码登录，由主会话通过真实浏览器键盘操作远端输入框；Playwright 只观察值，读到 `human-w0` 后恢复并截图。该结果验证接管输入通道，未覆盖用户亲自操作体验、GPU 页面或正式控制租约。

源码与适用许可证保留在主机的独立上游目录。仓库只保存适配脚本和脱敏证据。原始构建日志位于 `/opt/agentanywhere-w0/evidence/`；Craft 原始启动日志可能含 token，不公开。

## 保留环境与下一步

浏览器探针容器、专用网络与临时 VNC 密钥已清理。保留 `agentanywhere-w0-craft`、独立数据卷及网络、gVisor runtime、固定镜像与上游源码，供所有者继续试用；provider 配置及模型验证已经完成，环境回收仍为开放事项。Craft 仅发布宿主机 `127.0.0.1:19100`；容器内 HTTP 使用上游 `--allow-insecure-bind`，HTTPS 由现有 OpenResty 终止。

WebUI 密码保存在主机 `/opt/agentanywhere-w0/webui-password`（0600）；登录页面虽显示 “Server Token”，实际接受独立 `CRAFT_WEBUI_PASSWORD`。凭证不写入 Issue 或仓库。

`craft.env` 的 `CRAFT_WEBUI_WS_URL` 已改为 `wss://agent.riverflows.in`，并仅重建本测试容器。所有者已将反代目标修正为宿主 19100；公网 HTTPS 登录、API 鉴权及 WSS 握手均通过。模型调用已完成；保留环境回收后才关闭 [W0 Issue #1](https://github.com/kassol/AgentAnywhere/issues/1)。

W0 结果不覆盖正式 Browser Broker 控制租约、完整网络策略、长期运行或完整安全验收。

## Pi 配置超时修复

最初的 Pi 子进程在 undici 初始化时调用 Bun 未提供的 `worker_threads.markAsUncloneable`，立即退出。ready Promise 未拒绝，后端等待 45 秒，前端先在 30 秒报 RPC 超时。该次故障发生在模型请求之前。

现部署 `e896385-pi1`：仅 Pi 使用 Node 24.21.0，并修正原 Dockerfile 的 CJS `.js` 输出为 Node ESM；控制服务继续使用 Bun。补丁及离线复现见 [infra/w0](../../../infra/w0/README.md)。真实早退/ENOENT 回归由红转绿，完整离线 Pi SSE 测试和部署后的登录鉴权均通过。

2026-09-18 09:08:18 UTC 开始的公网配置测试，服务端记录 `Elapsed: 6102ms, success=true`；随后保存连接并重新初始化认证，所有者确认已进入应用。旧 Key 已更换，诊断期间的临时凭证、候选容器和两个试验镜像均已清理。当前 RPC 的通用 30 秒期限与服务端模型测试 45 秒期限保持原样；本补丁修复启动崩溃和失败回传。

## 真实会话验收

所有者完成 provider 配置后，在独立 `W0 Validation` 工作区验证 `gpt-6-astra`。Explore 模式阻止 Bash；切换 Execute 后仅执行 `pwd`，返回该工作区路径。浏览器收到 `tool_start`、`tool_result`、7 个 `text_delta` 与 `complete`。

让模型逐行输出 1 至 1000，在收到流式内容后点击 Stop response；输出停在 4，收到 `interrupted` 和 `complete`，会话 `isProcessing=false`。此项验证模型响应取消，未测试正在运行的外部工具进程终止。

模型菜单显示 `19k tokens used`；服务端会话数据为 inputTokens=19016、outputTokens=43、cacheReadTokens=18816。该值是当前上下文/会话报告，不能作为累计账单；costUsd=0，未验证自定义模型费用定价。脱敏事件和截图已复制出环境。测试会话 `260918-steady-gem` 已删除并确认查询为空；保留空工作区与现有服务供继续试用。
