import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsSelectRow } from './SettingsSelect'

test('settings select row exposes its visible label and description to the combobox', () => {
  const markup = renderToStaticMarkup(createElement(SettingsSelectRow, {
    label: '管家协议',
    description: '按模型连接实际支持的协议选择。',
    value: 'responses',
    onValueChange: () => {},
    options: [{ value: 'responses', label: 'Responses' }],
  }))

  const labelId = markup.match(/<label[^>]*id="([^"]+)"/)?.[1]
  const descriptionId = markup.match(/<p id="([^"]+)"/)?.[1]
  expect(labelId).toBeTruthy()
  expect(descriptionId).toBeTruthy()
  expect(markup).toContain('role="combobox"')
  expect(markup).toContain(`aria-labelledby="${labelId}"`)
  expect(markup).toContain(`aria-describedby="${descriptionId}"`)
})
