import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelSelect, ReportMarkdown } from './Work'

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

test('model select ignores BubbleSelect empty changes and forwards a listed user selection', () => {
  let selected = 'unchanged'
  const empty = ModelSelect({ value: '', models: [], onValueChange: value => { selected = value } })
  expect(empty.props.value).toBe('')

  const loaded = ModelSelect({
    value: 'gpt-6-astra',
    models: [{ id: 'gpt-6-astra', protocol: 'chat-completions' }, { id: 'other', protocol: 'responses' }],
    onValueChange: value => { selected = value },
  })
  expect(loaded.props.value).toBe('gpt-6-astra')
  loaded.props.onValueChange('')
  expect(selected).toBe('unchanged')
  loaded.props.onValueChange('other')
  expect(selected).toBe('other')
})
