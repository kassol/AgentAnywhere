import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReportMarkdown } from './Work'

test('report renders a GFM table without unsafe links, HTML or images', () => {
  const markdown = '| 参数 | 用途 |\n|---|---|\n| `q` | 搜索词 |\n\n[safe](https://example.com/) [unsafe](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![image](https://example.com/image.png)'
  const html = renderToStaticMarkup(<ReportMarkdown markdown={markdown} />)
  expect(html).toContain('<table>')
  expect(html).toContain('<th>参数</th>')
  expect(html).toContain('<td><code>q</code></td>')
  expect(html).toContain('href="https://example.com/"')
  expect(html).not.toContain('href="javascript:')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('<img')
})

test('report keeps markdown renderer identities stable across renders', () => {
  const first = ReportMarkdown({ markdown: '[report](https://example.com/) ![image](https://example.com/image.png)' })
  const second = ReportMarkdown({ markdown: '[report](https://example.com/) ![image](https://example.com/image.png)' })

  expect(first.props.components.a).toBe(second.props.components.a)
  expect(first.props.components.img).toBe(second.props.components.img)
})
