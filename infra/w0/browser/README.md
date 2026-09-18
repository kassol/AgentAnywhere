# W0 浏览器探针

仅验证 Chromium / Playwright / 显示服务组合，不实现 W6 的 Broker、控制租约或完整网络隔离。

- Playwright 固定 `1.63.0`，基础镜像固定其 Noble amd64 manifest digest，浏览器使用镜像自带版本。
- 使用镜像内 `pwuser`，显式 `chromiumSandbox: true`。探针检查 `chrome://sandbox` 的 namespace 与 seccomp 状态，失败立即停止。
- Xvfb、x11vnc 和 headed Chromium 使用同一 DISPLAY；无公开 CDP。x11vnc 仅监听容器 loopback，且必须读取 `/run/secrets/vnc-auth` 密码文件。W0 使用 `--disable-gpu` 软件渲染；GPU 页面能力未验证。
- noVNC 6080 仅允许绑定宿主机 `127.0.0.1`，通过受控 SSH 隧道验证。不得直接公开该 HTTP/WS 端点；上线需独立 HTTPS 与入口鉴权。
- `/evidence` 必须对 UID 1001 可写。挂载的密码文件必须对该 UID 可读。镜像内 `id pwuser` 已确认 UID/GID 均为 1001；禁止使用 `--no-sandbox`、privileged、SYS_ADMIN、host IPC/network。
- 探针保存 sandbox 状态、公开测试页截图、下载文件；进入 noVNC 后输入 `human-w0`，验证 Playwright 读取到同一实例的输入。等待期间只观察，300 秒未输入则失败。该检查不证明业务控制租约成立。

构建：`docker build -t agentanywhere-w0-browser:1.63.0 infra/w0/browser`。启动前记录本地镜像 ID，以该 ID 固定本次验证。

本次在 `cc-la` 运行的命令如下。预先创建专用 bridge 网络，并为证据目录设置 UID/GID 1001。`vnc-auth` 为 `x11vnc -storepasswd` 生成的密码文件，权限 0400、所有者 1001；明文密码保存在远程 W0 私有目录，权限 0600。秘密不得进入仓库。

```sh
docker run -d --name agentanywhere-w0-browser-probe \
  --runtime agentanywhere-w0-runsc --init \
  --cpus 2 --memory 2560m --shm-size 256m --pids-limit 512 \
  --network agentanywhere-w0-browser-probe \
  -p 127.0.0.1:19200:6080 \
  -v /opt/agentanywhere-w0/resolv.conf:/etc/resolv.conf:ro \
  -v /opt/agentanywhere-w0/browser-secrets/vnc-auth:/run/secrets/vnc-auth:ro \
  -v /opt/agentanywhere-w0/evidence/browser-probe:/evidence \
  "$(cat /opt/agentanywhere-w0/evidence/browser-image.txt)"
```

通过 SSH 将本地 19200 转发到 `cc-la` 的 `127.0.0.1:19200`，访问 `http://127.0.0.1:19200/vnc.html`。输入 VNC 密码后，在浏览器页面输入 `human-w0`。探针关闭浏览器后，保存日志；显示服务清理可能仍在等待，使用 `docker stop -t 5 agentanywhere-w0-browser-probe` 停止容器，再删除容器、专用网络与临时 VNC 密钥。

共用的 [`../resolv.conf`](../resolv.conf) 仅用于本次 `cc-la`：保留其现有上游 DNS 地址。实测该专用 bridge 上，runc 可访问 Docker 的 `127.0.0.11` DNS，runsc 返回 `ECONNREFUSED`；挂载此文件后 Node DNS 解析与 example.com HTTPS 返回 200。此处理只改变 W0 容器，不修改宿主 DNS。

2026-09-18 实测：GPU 初始化失败时截图报 `Unable to capture screenshot`；只加入 `--disable-gpu` 后通过截图、下载与同实例 noVNC 输入。`chrome://sandbox` 仍报告 Namespace、PID/network namespaces、Seccomp-BPF 均启用。`result.json` 的 `sameInstanceInput=true`、`screenshotErrors=[]`，截图可见输入 `human-w0` 和恢复文本；该输入来自浏览器中的 noVNC 客户端，探针未向输入框赋值。

来源：[Playwright Docker](https://playwright.dev/docs/docker)、[chromiumSandbox 参数](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox)。
已阅读 OpenSandbox `examples/playwright` 和 `examples/desktop`：其示例提供组件组合参考；前者版本未固定，且默认 launch 未显式开启 Chromium sandbox，因此本探针不直接复用该启动方式。
