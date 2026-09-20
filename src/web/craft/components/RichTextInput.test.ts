import { describe, expect, test } from 'bun:test'
import { limitTextChange } from './RichTextInput'

describe('contenteditable length guard', () => {
  test('rejects an insertion into a full draft without deleting the original suffix', () => {
    const previous = `${'甲'.repeat(15_999)}终`
    const result = limitTextChange(previous, `新${previous}`, 1, 16_000)

    expect(result).toEqual({ text: previous, cursorPosition: 0, constrained: true })
    expect(result.text.endsWith('终')).toBe(true)
  })

  test('keeps the unchanged suffix when only part of an insertion fits', () => {
    const result = limitTextChange('开头结尾', '开头新增内容结尾', 6, 6)

    expect(result).toEqual({ text: '开头新增结尾', cursorPosition: 4, constrained: true })
  })

  test('allows replacement text to use the space released by the selection', () => {
    const result = limitTextChange('甲乙丙丁', '甲新增丁', 3, 4)

    expect(result).toEqual({ text: '甲新增丁', cursorPosition: 3, constrained: false })
  })
})
