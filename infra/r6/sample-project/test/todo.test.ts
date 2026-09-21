import { describe, it, expect, beforeEach } from 'vitest'
import { createTodo, toggleTodo, filterByStatus, removeTodo, countByStatus, type Todo } from '../src/todo'

describe('todo', () => {
  let todos: Todo[]

  beforeEach(() => {
    todos = [
      createTodo('Buy groceries'),
      createTodo('Write tests'),
      createTodo('Deploy app'),
    ]
    todos[1] = toggleTodo(todos[1]) // mark "Write tests" as done
  })

  it('creates a todo with unique id', () => {
    const a = createTodo('A')
    const b = createTodo('B')
    expect(a.id).not.toBe(b.id)
    expect(a.done).toBe(false)
  })

  it('toggles done status', () => {
    const original = createTodo('Task')
    const toggled = toggleTodo(original)
    expect(toggled.done).toBe(true)
    expect(toggleTodo(toggled).done).toBe(false)
  })

  it('filters by done status', () => {
    const done = filterByStatus(todos, true)
    expect(done).toHaveLength(1)
    expect(done[0].title).toBe('Write tests')

    const pending = filterByStatus(todos, false)
    expect(pending).toHaveLength(2)
  })

  it('removes a todo by id', () => {
    const idToRemove = todos[0].id
    const remaining = removeTodo(todos, idToRemove)
    expect(remaining).toHaveLength(2)
    expect(remaining.find(t => t.id === idToRemove)).toBeUndefined()
  })

  it('counts done and pending', () => {
    const counts = countByStatus(todos)
    expect(counts.done).toBe(1)
    expect(counts.pending).toBe(2)
  })
})
