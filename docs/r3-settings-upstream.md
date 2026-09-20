# R3 模型设置上游审计

## 固定基线

- 项目：Craft Agents OSS `v0.13.3`
- commit：`e8963854c3679edcceb105a42537a06749e6cb64`
- 本地只读源码：`/tmp/agentanywhere-r3/craft-upstream`
- 许可：Apache License 2.0；上游 `LICENSE` 与 `NOTICE` 已核对。本轮只提取设置页的信息层级和交互模式，没有复制组件源码或样式字面量。

## 实际读取与采用范围

| 上游路径 | 实际行为 | AgentAnywhere 采用内容 |
| --- | --- | --- |
| `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` | 默认模型设置位于连接管理之前；连接以紧凑行显示状态和动作；设置按区段组织 | 日常管家模型与调研模型池优先展示；连接、发现和能力配置进入详情区 |
| `apps/electron/src/renderer/components/settings/SettingsSection.tsx` | 标题和说明先于区段内容 | 每个模型设置区段保留清晰标题和一句用途说明 |
| `apps/electron/src/renderer/components/settings/SettingsCard.tsx` | 相关设置放入带内部分隔线的分组卡片 | 管家模型、协议和刷新动作按组展示 |
| `apps/electron/src/renderer/components/settings/SettingsRow.tsx` | 左侧标签与说明，右侧紧凑控件 | 日常选择与刷新状态使用同一行结构；移动端改为纵向排列 |
| `apps/electron/src/renderer/pages/settings/SettingsNavigator.tsx` | 列表显示名称和单行说明，选择后进入详情 | 使用原生 `details` 展开连接和逐模型详情，保留键盘访问 |
| `apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx` | 密钥用密码输入；端点与协议属于连接配置 | 保留服务端凭证、不回显和留空保留语义；协议置于模型详情 |

## 本地边界

AgentAnywhere 继续使用既有单连接 API、模型发现、手填模型、目录显式映射、两种协议、能力来源、人工覆盖、连接测试和完整模型选择提交。日常保存仍提交未编辑的协议、映射和覆盖值，避免折叠详情导致字段丢失；刷新连接或目录时保留尚未保存的模型选择。网关发现结果不会自动进入人工调研模型池。

未引入 Craft 的 Electron 路由、新窗口、工作区覆盖、多连接管理、OAuth、Jotai、Tailwind、Radix、Lucide、Motion 或国际化依赖。实现只使用项目现有 React、原生表单控件、`details` 和主题变量。
