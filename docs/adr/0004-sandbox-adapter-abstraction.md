# SandboxAdapter 中立抽象与首版 OpenSandbox 适配

R6 引入 SandboxAdapter 中立接口，将 queue-worker 与 OpenSandbox SDK 的直接调用解耦。首版只实现 OpenSandboxAdapter；Cloudflare 适配保留契约测试桩但不实现。

选择引入抽象层而非继续直接调用，是因为 MVP 已确定 Cloudflare 为后续部署目标，直接调用会让每个 Profile 的创建/销毁/文件操作都散布 OpenSandbox 专用逻辑，后续适配成本高于现在引入一层接口。但全套实现（含 renew、resolveEndpoint、capabilities）在 R6 范围内过度——编码任务不需要续租和服务端点解析。

R6 实现 8 个方法：create、inspect、startProcess、processStatus、stopProcess、readFile、writeFile、destroy。renew 和 resolveEndpoint 留给 R7（浏览器沙箱需要续租和端点解析）。capabilities 也留给 R7，由 fake Provider 契约测试驱动引入。
