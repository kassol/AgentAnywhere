# R1 私有搜索服务

仅在指定主机 `cc-la` 部署。配置来自 2026-09-18 实际运行的独立实例：SearXNG `2026.9.18-1f7711ef1`（revision `1f7711ef1f16c80b24c093e0d39c34f22731424e`），官方镜像固定为 Compose 中的 digest。实例使用 `agentanywhere-r1-search` bridge 网络、容器名 `agentanywhere-r1-searxng`，没有宿主端口映射。Compose 未指定 `user`；实测容器进程以 root 运行。已有 `searxng-core` 保持独立，其用途未在本次确认。

在仓库根目录执行部署准备命令，目标目录已存在时只覆盖本服务的 Compose 和 settings 文件。首次创建密钥文件使用排他创建，不读取或打印密钥：

```sh
ssh cc-la 'test -d /opt/agentanywhere-r1'
scp infra/r1/search/searxng.compose.yaml infra/r1/search/searxng-settings.yml cc-la:/opt/agentanywhere-r1/
ssh cc-la 'python3 -' <<'PY'
import os
import secrets

path = "/opt/agentanywhere-r1/searxng.env"
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    stream.write("SEARXNG_SECRET=" + secrets.token_hex(32) + "\n")
PY
ssh cc-la 'docker compose -f /opt/agentanywhere-r1/searxng.compose.yaml config --quiet && docker compose -f /opt/agentanywhere-r1/searxng.compose.yaml up -d --no-build'
```

现有部署已有 `searxng.env`，再次更新时保留该文件；跳过密钥创建步骤。更新镜像先修改 Compose 中的固定 digest，重新复制两个配置文件后执行：

```sh
ssh cc-la 'docker compose -f /opt/agentanywhere-r1/searxng.compose.yaml pull searxng && docker compose -f /opt/agentanywhere-r1/searxng.compose.yaml up -d --no-build'
```

Compose 只管理本搜索服务和专用网络，不操作其他项目。镜像声明 `/etc/searxng` 与 `/var/cache/searxng` 匿名卷；settings 文件另以只读方式挂载。

未来 Queue Worker 须在自身 Compose 中将 `agentanywhere-r1-search` 声明为 external 网络，并让队列容器加入该网络。受控搜索入口使用 `http://agentanywhere-r1-searxng:8080/search?format=json`；不要为 SearXNG 增加公网反向代理或宿主端口。SearXNG 需要出站访问搜索引擎，因此这个 bridge 网络不是 Docker 的 internal 网络。

2026-09-18 从专用网络内的临时容器查询“`SearXNG 开源 搜索 引擎`”：JSON HTTP 200、40 条结果，本次 `unresponsive_engines` 为空。随后在服务容器内用相同中文关键词复查，HTTP 200、37 条结果，`unresponsive_engines` 包含 `duckduckgo` 的 `CAPTCHA`。结果提供标题、URL、摘要；`publishedDate` 可以为 `null`。调用方须保留部分结果与失败引擎信息。

以下命令从同一 Docker 网络的临时容器查询，只输出结果数量和失败引擎；临时容器退出后自动移除：

```sh
ssh cc-la 'docker run --rm -i --network agentanywhere-r1-search --entrypoint python3 docker.io/searxng/searxng@sha256:6f04bb0211859d0c7ebc3deeb39531c038d876dbccc70ea0388c0dae09f9b5f3 -' <<'PY'
import json
from urllib.parse import urlencode
from urllib.request import urlopen

url = "http://agentanywhere-r1-searxng:8080/search?" + urlencode(
    {"q": "SearXNG 开源 搜索 引擎", "format": "json", "language": "zh-CN"}
)
with urlopen(url, timeout=30) as response:
    data = json.load(response)
print("count:", len(data.get("results", [])))
print("unresponsive_engines:", data.get("unresponsive_engines", []))
PY
```

结束使用本独立服务时，在确认队列容器已脱离专用网络后执行 `docker compose -f /opt/agentanywhere-r1/searxng.compose.yaml down -v`；该命令移除本 Compose 创建的容器、网络和匿名卷。按需仅删除 `/opt/agentanywhere-r1/` 下的 `searxng.compose.yaml`、`searxng-settings.yml`、`searxng.env`，保留同目录其他服务。官方依据：[容器部署](https://docs.searxng.org/admin/installation-docker.html)、[搜索 API](https://docs.searxng.org/dev/search_api.html)。
