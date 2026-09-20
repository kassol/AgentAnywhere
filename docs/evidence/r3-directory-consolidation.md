# R3：cc-la 部署目录收敛

2026-09-20 已完成目录迁移及独立验收。迁移期间应用保持 R2 健康版本 `6787b70a47a96c8ab9b20056d1d67e3fb0efbbed`；后续 R3 应用发布另行记录。

## 当前布局

- `/opt/agentanywhere/runtime/`：Compose、私有 env、密码文件、模型配置、成果及 OpenSandbox 状态。
- `/opt/agentanywhere/releases/<完整 SHA>/`：当前与可回退源码、对应构建日志。
- `/opt/agentanywhere/backups/`：两份历史归档、迁移前配对快照和旧布局压缩归档。
- `/opt/agentanywhere/checks/<完整 SHA>/`：后续隔离验收临时文件，完成后删除。

五个正式容器的 Compose 工作目录及应用 bind mount 均指向新 runtime。Compose 项目名、PostgreSQL 卷、三个网络及 SearXNG 两个匿名卷的身份保留。OpenSandbox 的允许挂载目录同步改为新 `runtime/sandbox-data`，权限范围未扩大。

Docker 仍引用 `/opt/agentanywhere-w0-runtime-release-20260914.0/runsc`。该目录是系统 gVisor 依赖，保留原路径；没有修改 daemon 配置或重启 Docker。

## 数据保护与执行结果

停 Web/queue 前后均检查无活跃工作及管家轮次。私有 `/opt/agentanywhere/backups/20260920-r3-directory-migration-final/` 含数据库自定义格式 dump、成果、模型配置及运行文件的配对快照；`pg_restore --list`、tar 读取与 SHA-256 校验通过。历史备份复制时逐文件核对内容和权限，已有清单校验通过。

首次尝试的匿名卷校验误将返回顺序变化判为卷变化，自动回退到旧根，Web 恢复健康。确认卷名与挂载点一致后，改为集合比较，第二次迁移完成。回退过程未恢复或改写数据库。

完整验收后，旧根归档至 `backups/20260920-legacy-layout/runtime-and-intermediate-builds.tar.gz`，执行 tar 内容比较及 SHA-256 校验。原 `/opt/agentanywhere-r1`、`/opt/agentanywhere-backups` 已删除；只删除经容器引用核对的 13 个早期项目镜像标签。保留健康版本与回退版本三类镜像、正式卷和系统依赖，未执行全局 prune。

## 验收

- 公网 HTTPS 登录、匿名拒绝、Secure/HttpOnly/SameSite Cookie、WSS、跨 Origin 拒绝及旧隐藏路由负例通过。
- 原有 2 项工作、2 份报告的版本和下载 SHA-256 一致；原管家消息与模型连接完整一致。
- 新建真实工作 `0775cb3d-47b6-4b6d-a201-a822fcc69cb7` 成功，Run `d0ff9152-4829-4564-9829-570de9075eda` 沙箱回收为 `cleaned`；报告 `c4451704-314f-4b9e-8e2f-70f5fa4ce705` 下载哈希为 `3c09fdb750a8f399ecdbfbd7126a7a7ab8a1e4e51b6c271129e2019403b3416a`。
- queue 到私有 SearXNG 返回 HTTP 200、29 项真实搜索结果。
- 同机 9 个无关容器的 ID、启动时间、运行状态和重启次数均未变化。

迁移与回退流程见 [运行文档](../../infra/r1/README.md)。R3 整体验收及发布由 #40 单独完成。
