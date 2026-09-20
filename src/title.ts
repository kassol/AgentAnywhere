export class TitleInputError extends Error {}

export function parseTitle(body: unknown) {
  const title = body && typeof body === 'object' && !Array.isArray(body) && typeof (body as Record<string, unknown>).title === 'string'
    ? (body as Record<string, string>).title.trim() : ''
  if (!title || /[\r\n\u2028\u2029]/u.test(title) || Array.from(title).length > 80) throw new TitleInputError('标题须为 1–80 个字符的单行文本')
  return title
}

export function titleSummary(...candidates: (string | null | undefined)[]) {
  const title = candidates.find(Boolean)?.replace(/\s+/gu, ' ').trim() || '新工作'
  return Array.from(title).slice(0, 80).join('')
}
