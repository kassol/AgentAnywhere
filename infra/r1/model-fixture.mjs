import http from 'node:http'

const calls = []
const waitingSearch = []
const send = (response, data) => response.write(`data: ${JSON.stringify(data)}\n\n`)
const report = '# Fixture report\n\nSource: [Example](https://example.com/source).\n\n<script>window.reportXss = true</script>\n\n[Unsafe](javascript:alert(1))\n'
const reportArgs = JSON.stringify({ markdown: report, attachments: [{ name: 'notes.txt', content: 'fixture attachment\n' }] })
const emptyAttachmentArgs = JSON.stringify({ markdown: report, attachments: [{ name: 'empty.txt', content: '' }] })
const duplicateNameArgs = JSON.stringify({ markdown: report, attachments: [{ name: 'report.md', content: 'duplicate' }] })

http.createServer(async (request, response) => {
  if (request.url?.startsWith('/search?')) {
    const query = new URL(request.url, 'http://fixture').searchParams.get('q')
    if (query === 'fixture-blocked') {
      await new Promise(resolve => {
        waitingSearch.push(resolve)
        response.on('close', () => {
          const index = waitingSearch.indexOf(resolve)
          if (index !== -1) waitingSearch.splice(index, 1)
          resolve()
        })
      })
      if (response.destroyed) return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({ results: [{ title: 'Example Domain', url: 'https://example.com/', content: 'Example source excerpt', publishedDate: null }], unresponsive_engines: [['duckduckgo', 'CAPTCHA']] }))
  }
  if (request.url === '/release-search' && request.method === 'POST') {
    for (const release of waitingSearch.splice(0)) release()
    response.writeHead(200, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({ released: true }))
  }
  if (request.url === '/waiting-search') {
    response.writeHead(200, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({ count: waitingSearch.length }))
  }
  if (request.url === '/calls') {
    response.writeHead(200, { 'content-type': 'application/json' })
    return response.end(JSON.stringify(calls))
  }
  const responses = request.url?.endsWith('/v1/responses')
  if ((!responses && !request.url?.endsWith('/v1/chat/completions')) || request.method !== 'POST') { response.writeHead(404); return response.end() }
  let raw = ''
  request.setEncoding('utf8')
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw)
  if (responses) {
    const observation = Array.isArray(body.input) ? body.input.filter(item => item.type === 'function_call_output').map(item => item.output) : []
    const echoed = observation.some(item => item.includes('fixture observation'))
    const submitted = observation.some(item => item.includes('报告已保存'))
    const toolResult = observation.length > 0
    calls.push({ model: body.model, protocol: 'responses', toolResult, observation, stream: body.stream, chatMessages: 'messages' in body })
    if (body.model === 'fixture-responses-error') {
      response.writeHead(400, { 'content-type': 'application/json' })
      return response.end(JSON.stringify({ error: { message: 'fixture protocol rejected', type: 'invalid_request_error', code: 'unsupported_protocol' } }))
    }
    if (!body.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      return response.end(JSON.stringify({ id: `resp_${calls.length}`, status: 'completed', output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }))
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
    const responseId = `resp_${calls.length}`
    if (body.model === 'fixture-responses-stream-error') {
      send(response, { type: 'response.failed', response: { id: responseId, status: 'failed', error: { code: 'fixture_stream_failure', message: 'fixture streamed failure' } } })
      return response.end()
    }
    const usage = body.model === 'fixture-responses-missing' && !toolResult ? undefined : { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    if (!submitted) {
      const item = echoed
        ? { id: 'fc_report', type: 'function_call', call_id: 'call_report', name: 'submit_report', arguments: reportArgs }
        : { id: 'fc_echo', type: 'function_call', call_id: 'call_echo', name: 'echo_observation', arguments: '{"text":"fixture observation"}' }
      send(response, { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } })
      send(response, { type: 'response.function_call_arguments.delta', output_index: 0, delta: item.arguments })
      send(response, { type: 'response.function_call_arguments.done', output_index: 0, arguments: item.arguments })
      send(response, { type: 'response.output_item.done', output_index: 0, item })
      send(response, { type: 'response.completed', response: { id: responseId, status: 'completed', output: [item], ...(usage ? { usage } : {}) } })
    } else {
      const item = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'The fixture observation was returned.', annotations: [] }] }
      send(response, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })
      for (const delta of ['The fixture ', 'observation was ', 'returned.']) {
        send(response, { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta })
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      send(response, { type: 'response.output_item.done', output_index: 0, item })
      send(response, { type: 'response.completed', response: { id: responseId, status: 'completed', output: [item], ...(usage ? { usage } : {}) } })
    }
    return response.end()
  }
  const observation = body.messages.filter(message => message.role === 'tool').flatMap(message => typeof message.content === 'string' ? [message.content] : message.content?.filter?.(part => part.type === 'text').map(part => part.text) || [])
  if (['fixture-research', 'fixture-url', 'fixture-rejected', 'fixture-control-ip'].includes(body.model)) {
    const searched = observation.some(item => item.includes('search_snippet'))
    const opened = body.messages.some(item => item.role === 'assistant' && item.tool_calls?.some(call => call.function?.name === 'open_public_page'))
    const name = opened ? 'submit_report' : body.model !== 'fixture-research' || searched ? 'open_public_page' : 'search_web'
    const firstUser = body.messages.find(item => item.role === 'user')?.content
    const userText = typeof firstUser === 'string' ? firstUser : firstUser?.filter?.(item => item.type === 'text').map(item => item.text).join('') || ''
    const specified = userText.match(/指定来源：(\S+)/)?.[1]
    const userMessages = body.messages.filter(item => item.role === 'user').map(item => typeof item.content === 'string' ? item.content : item.content?.filter?.(part => part.type === 'text').map(part => part.text).join('') || '')
    const marker = userMessages.some(message => message.includes('STEERING_MARKER_12')) ? '\n\nSTEERING_MARKER_12' : ''
    const args = opened ? JSON.stringify({ markdown: `# Research fixture\n\n搜索摘要：Example source excerpt。\n\n正文来源：[Example Domain](https://example.com/)。\n\n部分引擎失败：duckduckgo CAPTCHA。${marker}` }) : name === 'open_public_page' ? JSON.stringify({ url: body.model === 'fixture-rejected' ? 'http://169.254.169.254/latest/meta-data/' : body.model === 'fixture-control-ip' ? specified : 'https://example.com/' }) : JSON.stringify({ query: 'fixture-blocked' })
    calls.push({ model: body.model, observation, name, userMessages, stream: body.stream })
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
    const common = { id: `fixture-${calls.length}`, object: 'chat.completion.chunk', created: 1, model: body.model }
    if (observation.some(item => item.includes('报告已保存'))) {
      send(response, { ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'Research report submitted.' }, finish_reason: null }] })
      send(response, { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    } else {
      send(response, { ...common, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }] })
      send(response, { ...common, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] })
      send(response, { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    }
    return response.end('data: [DONE]\n\n')
  }
  const echoed = observation.some(item => item.includes('fixture observation'))
  const submitted = observation.some(item => item.includes('报告已保存'))
  const submissions = observation.filter(item => item.includes('报告已保存')).length
  const toolResult = observation.length > 0
  const userMessages = body.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string'
    ? message.content : message.content?.filter?.(part => part.type === 'text').map(part => part.text).join('') || '')
  const steered = body.model === 'fixture-slow' && userMessages.some(message => message.includes('STEERING_MARKER_12'))
  calls.push({ model: body.model, toolResult, observation, userMessages, stream: body.stream })
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  const common = { id: `fixture-${calls.length}`, object: 'chat.completion.chunk', created: 1, model: body.model }
  if (body.model === 'fixture-empty-attachment' || body.model === 'fixture-duplicate-name') {
    if (!submitted) {
      const invalid = body.model === 'fixture-duplicate-name' && !observation.some(item => item.includes('附件名称重复'))
      const args = body.model === 'fixture-empty-attachment' ? emptyAttachmentArgs : invalid ? duplicateNameArgs : reportArgs
      send(response, { ...common, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: invalid ? 'call_invalid_report' : 'call_report', type: 'function', function: { name: 'submit_report', arguments: '' } }] }, finish_reason: null }] })
      send(response, { ...common, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] })
      send(response, { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    } else {
      send(response, { ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'Report submitted.' }, finish_reason: null }] })
      send(response, { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    }
    send(response, { ...common, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    return response.end('data: [DONE]\n\n')
  }
  if (!submitted || (steered && submissions === 1)) {
    const name = steered && submitted ? 'submit_report' : echoed ? 'submit_report' : 'echo_observation'
    const args = steered && submitted ? JSON.stringify({ markdown: `${report}\nSTEERING_MARKER_12\n` }) : echoed ? reportArgs : '{"text":"fixture observation"}'
    const callId = steered && submitted ? 'call_report_revision' : echoed ? 'call_report' : 'call_echo'
    send(response, { ...common, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: callId, type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }] })
    send(response, { ...common, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] })
    send(response, { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
  } else {
    if (body.model === 'fixture-slow') {
      for (const part of ['The fixture ', 'observation was ', 'returned.']) {
        send(response, { ...common, choices: [{ index: 0, delta: { role: 'assistant', content: part }, finish_reason: null }] })
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    } else send(response, { ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'The fixture observation was returned.' }, finish_reason: null }] })
    send(response, { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  }
  if (body.model !== 'fixture-mixed' || toolResult) {
    const metering = { ...common, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
    if (body.model === 'fixture-split') {
      response.write(`data: ${JSON.stringify(metering)}\r`)
      return setTimeout(() => response.end('\n\r\ndata: [DONE]\r\n\r\n'), 20)
    }
    send(response, metering)
  }
  response.end('data: [DONE]\n\n')
}).listen(3002, '0.0.0.0')
