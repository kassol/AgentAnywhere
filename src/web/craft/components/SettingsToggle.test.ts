import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsToggle } from './SettingsToggle'

test('settings toggle exposes its visible label and description to the switch', () => {
  const markup = renderToStaticMarkup(createElement(SettingsToggle, {
    label: '调研模型',
    description: '保存后校验',
    checked: true,
    onCheckedChange: () => {},
  }))

  const labelId = markup.match(/<label[^>]*id="([^"]+)"/)?.[1]
  const descriptionId = markup.match(/<div id="([^"]+)"/)?.[1]
  expect(labelId).toBeTruthy()
  expect(descriptionId).toBeTruthy()
  expect(markup).toContain('role="switch"')
  expect(markup).toContain(`aria-labelledby="${labelId}"`)
  expect(markup).toContain(`aria-describedby="${descriptionId}"`)
})
