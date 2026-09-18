import http from 'node:http'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()
for (const [range, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['168.63.129.16', 32], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(range, prefix, 'ipv4')
const publicV6 = new BlockList()
publicV6.addSubnet('2000::', 3, 'ipv6')
for (const [range, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2001:20::', 28], ['2002::', 16]]) blocked.addSubnet(range, prefix, 'ipv6')

function publicAddress(address) {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && publicV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}

async function publicTarget(input, forbiddenHost, signal) {
  signal?.throwIfAborted()
  let url
  try { url = new URL(input) } catch { throw new Error('公开链接无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname || url.href.length > 2048) throw new Error('仅支持公开 HTTP(S) 链接')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host.toLowerCase().replace(/\.+$/, '') === forbiddenHost?.toLowerCase().replace(/\.+$/, '')) throw new Error('链接指向控制面')
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await (async () => {
    let timer
    let onAbort
    try {
      return await Promise.race([
        lookup(host, { all: true, verbatim: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('域名解析超时')), 5_000) }),
        new Promise((_, reject) => { onAbort = () => reject(signal.reason); signal?.addEventListener('abort', onAbort, { once: true }) }),
      ])
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
  })()
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('链接指向非公开地址')
  return { url, ...addresses[0] }
}

function request(target, maxBytes, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const { url, address, family } = target
    const client = url.protocol === 'https:' ? https : http
    const req = client.get(url, { family, agent: false, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs), lookup: (_host, _options, callback) => callback(null, address, family), headers: { accept: 'text/html,text/plain,application/xhtml+xml,application/json', 'accept-encoding': 'identity', 'user-agent': 'AgentAnywhere/1.0' } }, response => {
      if (response.socket.remoteAddress !== address) { response.destroy(); reject(new Error('连接地址与校验地址不一致')); return }
      const chunks = []
      let bytes = 0
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > maxBytes) { response.destroy(); reject(new Error('网页超过大小限制')); return }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('网页读取超时')))
    req.on('error', reject)
  })
}

function plainText(html) {
  return html.replace(/<(script|style|noscript|svg|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|article|section|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, value => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[value])
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
}

export async function openPublicPage(input, forbiddenHost, signal) {
  let current = input
  for (let redirects = 0; redirects <= 4; redirects++) {
    const target = await publicTarget(current, forbiddenHost, signal)
    const response = await request(target, 1_000_000, 10_000, signal)
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
      current = new URL(response.headers.location, target.url).href
      continue
    }
    if (response.status === 401 || response.status === 403) throw new Error('页面需要登录或拒绝读取')
    if (response.status < 200 || response.status >= 300) throw new Error(`页面读取失败：HTTP ${response.status}`)
    if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new Error('页面编码不受支持')
    const type = String(response.headers['content-type'] || '').toLowerCase()
    if (!/^(text\/html|text\/plain|application\/xhtml\+xml)(;|$)/.test(type)) throw new Error('链接不是可读取的文本网页')
    const title = type.startsWith('text/html') ? plainText(response.body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') : ''
    const text = type.startsWith('text/plain') ? response.body.trim() : plainText(response.body)
    if (text.length < 40) throw new Error('页面正文为空或依赖 JavaScript 渲染')
    return { url: target.url.href, title, text: text.slice(0, 30_000), source: 'page_body', truncated: text.length > 30_000 }
  }
  throw new Error('页面重定向次数过多')
}

export async function searchWeb(query, origin, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('搜索词无效')
  const url = new URL('/search', origin)
  url.search = new URLSearchParams({ q: query, format: 'json', language: 'zh-CN' }).toString()
  const response = await fetch(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`搜索服务失败：HTTP ${response.status}`)
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.length
    if (bytes > 1_000_000) { await reader.cancel(); throw new Error('搜索结果超过大小限制') }
    chunks.push(value)
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const results = Array.isArray(data.results) ? data.results : []
  return { query, results: results.slice(0, 10).map(item => ({ title: String(item.title || '').slice(0, 200), url: String(item.url || '').slice(0, 2048), snippet: String(item.content || '').slice(0, 1000), publishedDate: item.publishedDate || null, source: 'search_snippet' })), unresponsiveEngines: Array.isArray(data.unresponsive_engines) ? data.unresponsive_engines.slice(0, 20) : [] }
}
