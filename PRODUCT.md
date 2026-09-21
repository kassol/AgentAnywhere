# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

个人开发者、技术研究者与独立创造者（如 Kassol），在需要委托 AI 智能体执行深度调研、自动化探索或工程任务时使用。用户需要将自身的认知精力从“实时监工操作员”解放为“结果裁决与目标设定者”，要求执行过程可验证、成果可长期留存。

## Product Purpose

自托管的个人委托工作台。用户通过管家对话提出目标，Agent 在受控隔离沙箱（gVisor/OpenSandbox）中自主执行，成果（结构化报告与事件轨迹）长期独立保存；沙箱销毁后仍可随时查看、追问、恢复、接管浏览器或进行原位批注改稿。产品的核心成功标准是“可验证、可恢复、受控执行”。

## Positioning

区别于传统即席对话式 AI（无法脱离对话生命周期独立保存成果）与黑盒托管平台（无法掌控沙箱与隐私）：
1. **沙箱物理隔离与自托管数据主权**：支持私有部署与容器沙箱隔离，执行完毕沙箱自动安全回收；
2. **真实双协议与模型池调度**：同时支持 Chat Completions 与 Responses 协议，支持管家统一统筹与人工调研模型池多并发派发；
3. **成果独立持久化与不可变版本**：沙箱销毁后报告依然独立保存在持久层，支持多版本演进与对比；
4. **同对话批注改稿闭环**：基于 DOM Range 的精确段落选区批注（Island 浮岛交互），批注直接形成下一次针对性改稿命令。

## Operating Context

- **工作台界面**：桌面端 A 三段工作台（252px 侧栏导航、800px 任务与对话阅读流、620px 待办区、独立全屏/按需侧滑报告预览层）。
- **运行环境**：Node.js / Bun 服务端，PostgreSQL 持久化，本地 Docker / gVisor 沙箱隔离环境，自建 SearXNG 受控搜索。
- **部署环境**：正式公网入口 `https://agent.riverflows.in`（OpenResty 终止 TLS，反代宿主机 `127.0.0.1:19100`）。
- **协作与规范**：以 GitHub Issues 为唯一需求管理入口，依托 `AGENTS.md`、`CONTEXT.md` 与 `docs/adr/` 进行规范治理。

## Capabilities and Constraints

- **核心功能**：独立 Web 鉴权、管家流式对话、长会话自动摘要、模型池多任务派发、执行中流式追加要求与取消、交互待办（Interaction）审批与回答、报告阅读与下载、原文段落批注与改稿。
- **前端架构约束**：
  - 前端界面与视觉规范**最大化复用 Craft Agents OSS v0.13.3**（commit `e8963854c3679edcceb105a42537a06749e6cb64`）的原组件与设计哲学；
  - 严禁将无关的 Electron 运行时、庞大状态机或复杂 i18n 整包引入，采用轻量化文件级适配与裁剪；
  - 业务状态、持久身份（Task/Run/Interaction/Artifact/Version）与幂等接口完全由 AgentAnywhere 拥有，UI 组件只承担渲染与交互组合；
  - 不启用全局 Tailwind preflight，保护现有 A 外壳布局不被破坏。

## Brand Commitments

- **名称**：AgentAnywhere。
- **视觉底座**：深度继承 **Craft Agents OSS (v0.13.3)** 的设计哲学与组件系统（精致、克制、高密度、专业工作台质感）。
- **排版字体**：自托管 Inter 字体（开启高级字形特性），搭配中文系统字体栈（PingFang SC, Microsoft YaHei 等）。
- **品牌性格**：沉稳、精确、克制、坚固可信赖（“消灭偶然复杂度，为人减熵”）。

## Evidence on Hand

- **版本验收记录**：R1 ~ R5 各阶段的端到端浏览器验收与网络证据均记录于 `docs/evidence/`（如 `r1-14.md`, `r2-12.md`, `r3-08.md`, `r4-08.md`, `r5-09.md`）。
- **Craft 源码与迁移清单**：严格记录在 `docs/r4-craft-source.md` 与 `docs/r5-craft-source.md`。
- **开源合规**：保留 Apache-2.0 许可证与 Craft 归属声明（`licenses/CRAFT-APACHE-2.0.txt`、`licenses/CRAFT-NOTICE.txt`）。

## Product Principles

1. **可验证、可恢复、受控执行（Verifiable, Resumable, Controlled Execution）**：所有交互与执行必须有完整审计轨迹、状态可恢复，绝不凭推测做假定。
2. **为人减熵，不替人承担本质复杂度（Reduce Entropy, Protect Human Attention）**：通过状态卡、待办与结构化决策解放用户的监工负担，人只做战略裁决与目标设定。
3. **成果独立与长久沉淀（Artifact Independence）**：沙箱与运行环境是暂态的，但产出的报告、版本与经验记忆是永久资产。
4. **复用经典设计，捍卫领域语义（Reuse Proven Craft, Retain Domain Semantics）**：设计底座全盘复用 Craft Agent 的优秀交互质感，同时严格捍卫 AgentAnywhere 的业务契约与持久层。

## Accessibility & Inclusion

- 完整支持浅色（Light）、深色（Dark）及跟随系统的主题无缝切换。
- 保证可访问性键盘导航（`focus-visible` 焦点环、IME 组合输入保护、Escape 退出覆盖层）。
- 保持各交互部件的语义化标签与明确的中文无障碍文本（`aria-label`）。
