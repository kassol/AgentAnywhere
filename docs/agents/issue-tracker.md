# Issue tracker: GitHub

任务与 spec 存放于 [kassol/AgentAnywhere 的 GitHub Issues](https://github.com/kassol/AgentAnywhere/issues)，使用 `gh` CLI 操作。执行前通过 `git remote -v` 核对目标仓库。

## 常用操作

- 创建：`gh issue create --title "标题" --body-file <正文文件>`。
- 读取：`gh issue view <number> --comments`；需要结构化字段时使用 `--json`。
- 查询：`gh issue list --state open --json number,title,labels,assignees`，按需添加标签筛选。
- 评论：`gh issue comment <number> --body-file <正文文件>`。
- 标签：`gh issue edit <number> --add-label <label>` 或 `--remove-label <label>`。
- 关闭：记录验收证据或决策结果后执行 `gh issue close <number>`。

多行正文通过文件传递。技能要求“发布到 tracker”时创建 GitHub Issue；要求读取任务时同时读取正文、标签与评论。任务拆分使用原生阻塞关系，按依赖顺序实施。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

仅在使用 wayfinder 时采用以下约定，标签按需创建。

- Map：一个带 `wayfinder:map` 标签的 Issue，保存目的、已决策索引与待探索范围。
- 子任务：通过 GitHub sub-issues 关联到 Map，使用 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task`。不支持 sub-issues 时，Map 使用任务列表，子任务正文标记 `Part of #<map>`。
- 阻塞：使用 GitHub 原生 Issue dependencies。先用 `gh api repos/kassol/AgentAnywhere/issues/<blocker> --jq .id` 取得阻塞任务的数据库 ID，再执行 `gh api --method POST repos/kassol/AgentAnywhere/issues/<child>/dependencies/blocked_by -F issue_id=<database-id>`。数据库 ID 与 Issue 编号不同。不支持该能力时，正文使用 `Blocked by: #<number>` 并说明降级原因。
- 待领取任务：查询 Map 下开放、未分配且无开放阻塞项的子任务；原生依赖的 `issue_dependencies_summary.blocked_by` 用于判断开放阻塞数。
- 领取：工作前执行 `gh issue edit <number> --add-assignee @me`。
- 完成：评论记录 resolution，关闭 Issue，再向 Map 的 Decisions-so-far 添加结果摘要与链接。
