import { execFile } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { Type } from 'typebox'

const execFileAsync = promisify(execFile)

export function createCodingTools(workdir) {
  const resolved = resolve(workdir)

  function safePath(userPath) {
    const target = resolve(resolved, userPath)
    if (!target.startsWith(resolved + sep) && target !== resolved) throw new Error('Path outside workspace')
    return target
  }

  return [
    {
      name: 'shell', label: 'Shell', description: 'Execute a shell command in the workspace.',
      parameters: Type.Object({ command: Type.String(), cwd: Type.Optional(Type.String()) }),
      execute: async (_id, params, signal) => {
        if (signal?.aborted) throw new Error('Run cancelled')
        const cwd = params.cwd ? safePath(params.cwd) : resolved
        let stdout = '', stderr = '', code = 0
        try {
          const result = await execFileAsync('/bin/sh', ['-c', params.command], { cwd, timeout: 120_000, maxBuffer: 64 * 1024 })
          stdout = result.stdout
          stderr = result.stderr
        } catch (error) {
          code = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 1 : (typeof error.code === 'number' ? error.code : 1)
          stdout = error.stdout || ''
          stderr = error.stderr || ''
          if (error.killed) stderr += '\n[process killed: timeout]'
        }
        return { content: [{ type: 'text', text: `Exit code: ${code}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}` }], details: {} }
      },
    },
    {
      name: 'read_file', label: 'Read file', description: 'Read a file from the workspace as UTF-8 text (1 MB limit).',
      parameters: Type.Object({ path: Type.String() }),
      execute: async (_id, params, signal) => {
        if (signal?.aborted) throw new Error('Run cancelled')
        const target = safePath(params.path)
        const content = await readFile(target, 'utf-8')
        if (Buffer.byteLength(content, 'utf-8') > 1_000_000) throw new Error('File exceeds 1 MB limit')
        return { content: [{ type: 'text', text: content }], details: {} }
      },
    },
    {
      name: 'write_file', label: 'Write file', description: 'Write content to a file in the workspace, creating parent directories if needed.',
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id, params, signal) => {
        if (signal?.aborted) throw new Error('Run cancelled')
        const target = safePath(params.path)
        await mkdir(resolve(target, '..'), { recursive: true })
        await writeFile(target, params.content)
        return { content: [{ type: 'text', text: `Written: ${params.path}` }], details: {} }
      },
    },
    {
      name: 'git_diff', label: 'Git diff', description: 'Show the git diff in the workspace. Use staged=true for staged changes.',
      parameters: Type.Object({ staged: Type.Optional(Type.Boolean()) }),
      execute: async (_id, params, signal) => {
        if (signal?.aborted) throw new Error('Run cancelled')
        const args = ['diff']
        if (params.staged) args.push('--staged')
        try {
          const result = await execFileAsync('git', args, { cwd: resolved, timeout: 30_000, maxBuffer: 64 * 1024 })
          return { content: [{ type: 'text', text: result.stdout || '(no diff)' }], details: {} }
        } catch (error) {
          return { content: [{ type: 'text', text: `Exit code: ${error.code || 1}\n\n${error.stdout || ''}\n${error.stderr || ''}` }], details: {} }
        }
      },
    },
  ]
}
