# R5 页面体验原型

状态：2026-09-20 产品所有者已选择 A，作为 R5 规格、实现和页面验收基准。依据 [ADR-0003](adr/0003-craft-page-experience.md)。

## 要回答的问题

在保留 Craft 原组件、字体和 AgentAnywhere 业务身份的前提下，哪种页面组织能让“对话委托 → 查看进度 → 介入 → 阅读与修改成果”更连贯，并减少长指令、重复工作卡和执行详情对阅读的干扰？

原型位于 `prototype/r5-craft-experience` 分支，基于 `14dd57e`；正式 `main` 与公网应用不包含原型。后续规格和实施 Issue 应引用此分支及最终选择，禁止将原型演示当作业务实现证据。

## 启动与比较

```sh
git switch prototype/r5-craft-experience
bun install --frozen-lockfile
bun run prototype:r5
```

打开 `http://127.0.0.1:5175/?variant=A`。同一路径支持 `variant=B` 和 `variant=C`，底部悬浮条切换方案、主题和场景。方向键在编辑控件以外切换方案；刷新保留 URL 中的方案，其余演示状态只在内存中保存。

| 方案 | 组织方式 | 比较重点 |
| --- | --- | --- |
| A | 独立导航、会话列表、对话主区，报告按需打开 | 历史会话切换与阅读成果能否兼顾 |
| B | 紧凑侧栏、对话主区、常驻工作概览 | 多项工作的当前进度和待介入事项是否更容易找到 |
| C | 精简导航，对话与成果切换到焦点页 | 宽阔阅读空间是否值得付出切换上下文的成本 |

三者保持相同字体、颜色及业务样本，结构差异作为主要比较对象。页面范围包括管家、工作、待办、报告、设置和登录，覆盖浅深主题、小屏、长内容、执行中、等待回答和失败状态。

## 上游与复用边界

固定上游 Craft Agents OSS `v0.13.3`，提交 `e8963854c3679edcceb105a42537a06749e6cb64`。源文件 `apps/electron/src/renderer/components/app-shell/AppShell.tsx:483-550` 明确三段布局，侧栏默认 220px，会话列表默认 300px、范围 240–480px；`PanelHeader.tsx:4-12` 定义 50px 面板头。方案 A 以这些页面组织事实为参照；B/C 探索同一视觉体系内的替代布局。

原型直接导入本项目已迁入的 Craft 组件，来源、许可及适配基线见 [R4 清单](r4-craft-source.md)。原型的页面组合与演示状态是本地临时代码，不声称复制了 Craft 整套页面或业务状态机。入口为 `src/web/r5-prototype-entry.tsx`，页面位于相邻的 `r5-prototype.tsx` 和 `r5-prototype.css`；专用 Vite serve 模式在现有页面路径替换入口，常规生产构建保持原入口。

## 演示边界

全部业务交互使用明确标识的内存样本，无真实 API 请求、模型调用、登录验证或设置保存。报告下载来自当前演示内容。自动标题、执行进度、失败重试、批注和改稿用于检查交互与信息组织；正式实现仍须按规格完成数据兼容和行为回归。

## 选择记录

2026-09-20，产品所有者在比较可运行原型后明确选择 A（三段工作台）。确认基线为 `412e7d0` 中的 A：独立导航、会话列表、对话主区，以及按需打开的报告面板；辅助页面、浅深主题与小屏使用 A 对应样本。B/C 保留用于历史比较。下一阶段转为 R5 规格；原型中的模拟执行、共用样本和简化设置不构成新增业务约定。

## 验证记录

2026-09-20 使用 ego-browser 在本机原型服务验证；以下结果仅证明演示交互。

- A/B/C：1440×1000 桌面截图、390×844 小屏截图、独立报告打开与关闭；小屏页面宽度均为 390，无页面横向溢出。
- 回答范围问题后待办清空；失败工作经重试进入执行中，再由演示按钮生成结果。
- 报告 v2 添加批注，切到 v1 无该批注；返回 v2 汇总到输入框，发送后模拟产生 v3。下载包含当前正文末尾与 Markdown 标题。
- 会话搜索、切换标题、新建空对话、Enter 发送可操作；编辑区方向键保持当前方案，非编辑区方向键切换方案。
- 模型池开关修改与保存、登录短密码提示及演示成功状态、小屏导航、深色主题已验证。
- `bun run typecheck`、`bun run build`、`git diff --check` 通过。生产构建仍有已有的大于 500 kB chunk 提示。
- 浏览器读取的字体栈为 `Inter, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif`。三种方案的资源记录均无 `/api/` 请求。

截图：[A](evidence/r5-prototype/a-desktop.png)、[B](evidence/r5-prototype/b-desktop.png)、[C](evidence/r5-prototype/c-desktop.png)、[A 小屏](evidence/r5-prototype/a-mobile.png)、[B 小屏](evidence/r5-prototype/b-mobile.png)、[C 小屏](evidence/r5-prototype/c-mobile.png)、[深色](evidence/r5-prototype/a-dark.png)。报告与辅助页面截图见同目录。

演示简化：历史对话共用样本正文；三项工作的报告共用正文与版本集合，批注按工作及版本区分。改稿仅切换预置内容，登录仅检查演示密码长度。设置只比较布局和编辑反馈，未覆盖真实凭据、连接探测或完整模型管理。正式行为以现有业务契约及后续规格为准。
