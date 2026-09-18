# R1 正式发布运行证据

2026-09-19，在指定主机 cc-la 复核。正式版本为提交 `6880ab06a83bbabcf8355745ffe59d5608cb5b21`。以下只记录已完成的隔离运行和发布后的只读检查；公网浏览器完整调研及测试资源清理尚在进行。

## 真实 sub2api 与 SearXNG

独立 `19114` 栈使用 `f9a0f7b5ec29b6f8fbb40463de26e69e6e239fa8` 构建、独立 PostgreSQL schema `r114_live/r114_live_boss`、可写的隔离模型配置副本。运行 `TEST_ISOLATED_MODEL_CONFIG_FILE=/opt/agentanywhere-r1/live-data/model-connection.json TEST_PASSWORD_FILE=/opt/agentanywhere-r1/test-password node infra/r1/test-all.mjs live`，退出码 0。脚本经公开 API 创建工作，并通过真实 PostgreSQL、pg-boss、Pi、OpenSandbox、sub2api 与 SearXNG。正式 `data/model-connection.json` 未写入；隔离副本在测试后恢复为唯一 `gpt-6-astra/chat-completions`。

| 场景 | Task / Run | 已验证结果 |
| --- | --- | --- |
| Chat 成功 | `be2e12f7-5302-464a-9395-3f814c430700` / `b21f2bae-cc52-40d8-a1f5-cbf70cf3574a` | 连接成功；14 个流式 `message.delta`；`echo_observation` 参数及结果往返；报告保存；`succeeded/cleaned` |
| Chat 流中取消 | `844be448-5591-4603-a562-19b375aae76c` / `736a4c9d-0ce5-414e-ac70-01dd321f18f9` | 见到流式片段后取消；`cancelled/cleaned`，无 `run.finished` |
| Chat 错误 | `d266b1aa-c5dd-4d0c-a89e-fae2fd94c002` / `71510be1-a88a-41db-bf74-5f58b1a1399d` | 明确不存在的模型：连接测试 HTTP 502、上游 404；Run `failed/cleaned` |
| Responses 成功 | `4d19d05d-a9ea-4fb5-a430-93df0bb04b17` / `5df15198-2046-41a5-838d-3a15bec562f3` | 连接成功；37 个流式片段；工具往返；报告保存；`succeeded/cleaned` |
| Responses 流中取消 | `b7b2ae8c-1dc0-4387-b87c-ca5c5bfdb8a4` / `3f72bf97-e23c-4ede-9e40-992e408af60f` | 见到流式片段后取消；`cancelled/cleaned`，无 `run.finished` |
| Responses 错误 | `9abe87f9-5703-4ac9-adba-4e2f6e78884a` / `581e22ff-2df2-4757-b7e5-1dc0f822e197` | 明确不存在的模型：连接测试 HTTP 502、上游 404；Run `failed/cleaned` |
| SearXNG 主题 | `475ce36e-b5b4-44d8-9432-23ffe12151c8` / `11390319-4fab-4647-b25a-b59d10e9d929` | 真实搜索返回 10 项，失败引擎 0；报告保存 |
| 指定 URL | `0704b8ae-7511-4ce5-9799-22faa2e72974` / `f2712741-de7c-4579-be11-53fb48589537` | 读取 `https://example.com/` 正文 144 字符；报告保存 |

公开事件按 `callId` 取最后一条 `usage`：Chat 三次模型调用输入/输出依次为 686/21、722/67、810/18 token，合计 **2218/106**；Responses 为 4800/40、4855/69、4945/30，合计 **14600/139**。取消及错误调用缺少最终用量，保持“未知”。初版脚本把每次调用的初始空事件也纳入统计，误报成功 Run 用量未知；统计修复为 `ad528d3`，从已完成 Run 的公开 API 只读复核，没有重跑工作。OpenSandbox SDK 按上述八个 Run ID 查询，均无存活沙箱。原始日志保存在 cc-la 权限 0600 的 `/tmp/agentanywhere-r1-live-acceptance.log`。

## 正式部署与隔离

正式 Web 和 queue 容器的镜像标签均为完整发布 SHA，运行中；Web 健康。三镜像的完整 Docker image ID：

| 镜像 | Image ID |
| --- | --- |
| `agentanywhere-r1-web:6880ab06a83bbabcf8355745ffe59d5608cb5b21` | `sha256:35977384fe142a97b33eb046522a7e9bb7efe2b77eea32f480e02f74dcc8b9ba` |
| `agentanywhere-r1-queue:6880ab06a83bbabcf8355745ffe59d5608cb5b21` | `sha256:a3eb87776176268dacfa3d6d01c6457c13114f2896c627ef9df2dceb7cec46a4` |
| `agentanywhere-r1-agent:6880ab06a83bbabcf8355745ffe59d5608cb5b21` | `sha256:fbef7dc10a5f9fad34e04ed4aa5471ddf817e8817a0a0b7b736b23518ef108a9` |

`docker inspect` 实测：Web 使用 `agentanywhere-w0-runsc`，仅把 3000 端口绑定宿主 `127.0.0.1:19110`，持久模型目录可写、成果目录只读；queue 使用 `runc`，成果目录可写、无宿主端口，连接应用、Sandbox 和搜索三个网络。两者均为非特权、只读根文件系统、丢弃全部 capabilities、`no-new-privileges`，限制 128 PID、512 MiB、1 CPU。queue 运行配置将 Agent 镜像固定为上述发布 SHA，模型代理指向 `agentanywhere-r1-web:3000`，工具入口指向 `agentanywhere-r1-queue:3003`。OpenSandbox 管理端口仅绑定 `127.0.0.1:19510`；独立 SearXNG 没有宿主端口。四个正式配置文件 `service.env`、`database.env`、`opensandbox.env`、`data/model-connection.json` 均为 0600。

正式 `http://127.0.0.1:19110/login` 返回 HTTP 200；OpenResty 站点代理配置实测转发至 `127.0.0.1:19110`，保留 Host、Upgrade 和 HTTP/1.1。主会话报告发布后 `test-all.mjs public` 通过；本文件未重复运行该脚本。与 `/tmp/agentanywhere-r1-services-before.txt` 比较，除 W0 外九个既有服务的容器 ID、`StartedAt`、`RestartCount` 全部不变；Docker `MainPID=1173` 不变。

公网浏览器的完整调研路径、正式 Run 成果复核与测试栈/W0 清理不在本记录的已完成范围。
