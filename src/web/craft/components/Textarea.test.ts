import { expect, test } from 'bun:test'
import * as React from 'react'
import { Textarea } from './Textarea'

test('forwards its ref through React 18 to the native textarea', () => {
  const ref = React.createRef<HTMLTextAreaElement>()
  const component = Textarea as unknown as {
    render: (props: React.ComponentPropsWithoutRef<'textarea'>, ref: React.Ref<HTMLTextAreaElement>) => React.ReactElement
  }
  const element = component.render({ rows: 3 }, ref)

  expect(element.type).toBe('textarea')
  expect((element as unknown as { ref: React.Ref<HTMLTextAreaElement> }).ref).toBe(ref)
})
