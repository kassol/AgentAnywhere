import assert from 'node:assert/strict'
import test from 'node:test'
import { openPublicPage } from './research-tools.mjs'

test('public page reader rejects private and control plane targets before connecting', async () => {
  for (const url of [
    'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/', 'http://[::1]/', 'http://[::ffff:169.254.169.254]/',
    'file:///etc/passwd', 'https://user:pass@example.com/',
  ]) await assert.rejects(openPublicPage(url, 'app.example.com'))
  await assert.rejects(openPublicPage('https://app.example.com/', 'app.example.com'), /控制面/)
})
