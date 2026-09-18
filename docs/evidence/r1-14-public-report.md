# SearXNG Search API 简报

## 查阅方式与来源

按指定来源优先读取要求，先打开[官方 Search API 正文](https://docs.searxng.org/dev/search_api.html)，再搜索官方资料（`site:docs.searxng.org/dev/search_api.html SearXNG Search API format json parameters`）。以下接口说明均依据已读取的正文，而非搜索摘要。

## JSON 查询方式（正文事实）

支持 `/` 和 `/search` 两个端点，均可使用 GET 或 POST：GET 通过 URL 查询参数传参；POST 使用 `application/x-www-form-urlencoded` 表单，**不是 JSON 请求体**。设置 `format=json` 获取 JSON 输出。

```sh
# GET（文档示例）
curl 'https://searx.example.org/search?q=searxng&format=json'

# POST（按文档规则整理）
curl 'https://searx.example.org/search' \
  -d 'q=searxng&format=json'
```

示例域名需替换为实际实例；这里未执行 API 请求。

## 关键参数（正文事实）

| 参数 | 用途及默认值/范围 |
|---|---|
| `q` | 必填，搜索词；会传给外部搜索服务。 |
| `format` | 可选：`json`、`csv`、`rss`；对应格式须在实例配置中启用。 |
| `categories` | 可选，逗号分隔的搜索分类列表。 |
| `language` | 语言代码；默认来自 `search:` 配置。 |
| `pageno` | 页码，默认 `1`。 |
| `time_range` | 可选：`day`、`month`、`year`；仅对支持时间过滤的引擎有效。 |
| `safesearch` | `0`、`1`、`2`；默认来自 `search:` 配置，仅对支持安全搜索的引擎有效。 |
| `theme` | 默认 `simple`；实际可用主题由实例决定。 |

## 使用限制（正文事实）

- 输出格式由 `settings.yml` 的 `search:` 部分控制；请求未启用的格式会返回 **403 Forbidden**。许多公共实例禁用了这些格式，不能假定任意实例都支持 JSON。
- 查询语法取决于上游搜索服务。例如 `site:github.com SearXNG` 可用于 Google，但其他引擎不一定理解相同过滤语法。
- 时间过滤和安全搜索不是所有引擎都支持；正文建议在实例偏好设置页确认。
- 可用主题也可能被实例管理员删除、新增或改名。

## 搜索摘要与核查边界

- 搜索返回[同一官方页面](https://docs.searxng.org/dev/search_api.html)及[带高亮参数的页面](https://docs.searxng.org/dev/search_api.html?highlight=format)，摘要展示了 cURL 示例与 `q` 的说明，仅作为检索线索。带高亮参数的 URL 未另行打开，不作为独立正文证据。
- 搜索引擎**部分失败**：工具报告 DuckDuckGo `unexpected crash`；仍返回了上述结果，不代表所有引擎搜索成功。
- 指定页面正文读取成功、未截断；本次没有已尝试读取但不可读的页面。摘要所示文档版本与打开正文的版本不同，以实际读取正文为依据。
- 该页未给出统一请求配额、速率限制数值或 JSON 响应字段规范；本次未核查其他配置文档及具体实例策略，也未实测服务可用性，不推断“无限制”或“必定可用”。

**主要来源：** https://docs.searxng.org/dev/search_api.html
