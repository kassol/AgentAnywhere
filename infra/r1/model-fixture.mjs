import http from 'node:http'

const calls = []
const send = (response, data) => response.write(`data: ${JSON.stringify(data)}\n\n`)

http.createServer(async (request, response) => {
  if (request.url === '/calls') {
    response.writeHead(200, { 'content-type': 'application/json' })
    return response.end(JSON.stringify(calls))
  }
  if (!request.url?.endsWith('/v1/chat/completions') || request.method !== 'POST') { response.writeHead(404); return response.end() }
  let raw = ''
  request.setEncoding('utf8')
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw)
  const observation = body.messages.filter(message => message.role === 'tool').flatMap(message => typeof message.content === 'string' ? [message.content] : message.content?.filter?.(part => part.type === 'text').map(part => part.text) || [])
  const toolResult = observation.length > 0
  calls.push({ model: body.model, toolResult, observation, stream: body.stream })
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  const common = { id: `fixture-${calls.length}`, object: 'chat.completion.chunk', created: 1, model: body.model }
  if (!toolResult) {
    send(response, { ...common, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_echo', type: 'function', function: { name: 'echo_observation', arguments: '' } }] }, finish_reason: null }] })
    send(response, { ...common, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"text":"fixture observation"}' } }] }, finish_reason: null }] })
    send(response, { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
  } else {
    if (body.model === 'fixture-slow') {
      for (const part of ['The fixture ', 'observation was ', 'returned.']) {
        send(response, { ...common, choices: [{ index: 0, delta: { role: 'assistant', content: part }, finish_reason: null }] })
        await new Promise(resolve => setTimeout(resolve, 500))
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
