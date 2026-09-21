# Sample Project

A minimal TypeScript todo library used for AgentAnywhere R6 coding closure acceptance testing.

## Structure

- `src/todo.ts` — Todo CRUD functions (contains intentional bugs)
- `test/todo.test.ts` — 5 vitest test cases (2 will fail due to bugs)

## Commands

```
npm install
npm test
```

## Known bugs

The `filterByStatus` and `removeTodo` functions contain bugs that cause 2 test failures. The acceptance test asks a coding agent to fix these bugs and make all tests pass.
