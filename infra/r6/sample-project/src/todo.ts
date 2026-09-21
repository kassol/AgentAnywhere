export interface Todo {
  id: number
  title: string
  done: boolean
}

let nextId = 1

export function createTodo(title: string): Todo {
  return { id: nextId++, title, done: false }
}

export function toggleTodo(todo: Todo): Todo {
  return { ...todo, done: !todo.done }
}

export function filterByStatus(todos: Todo[], done: boolean): Todo[] {
  // BUG: returns all todos instead of filtering
  return todos
}

export function removeTodo(todos: Todo[], id: number): Todo[] {
  // BUG: uses wrong comparison operator, never removes
  return todos.filter(t => t.id !== undefined)
}

export function countByStatus(todos: Todo[]): { done: number; pending: number } {
  const done = todos.filter(t => t.done).length
  return { done, pending: todos.length - done }
}
