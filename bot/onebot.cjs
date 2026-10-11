/* 与 NapCat（OneBot v11）通信的最小封装，只用 Node 内置 http。
 *
 * 采用「HTTP 上报 + HTTP API」这一对最省事、零依赖的模式：
 *   - NapCat 把群/私聊事件 POST 到我们监听的地址（默认 http://127.0.0.1:8790/onebot）；
 *   - 我们调用 NapCat 的 HTTP API（默认 http://127.0.0.1:3000）来发消息。
 * 不需要 WebSocket，也不引入任何 npm 依赖。
 */
'use strict';

const http = require('node:http');

function startEventServer(options, onEvent) {
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || !request.url.startsWith(options.path)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 1_000_000) request.destroy(); });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      let event;
      try { event = JSON.parse(body); } catch { return; }
      Promise.resolve(onEvent(event)).catch(error => console.error('[onEvent]', error.message));
    });
  });
  return new Promise(resolve => server.listen(options.port, '127.0.0.1', () => resolve(server)));
}

async function callApi(options, action, params) {
  // NapCat 的 HTTP 接口地址为 /<action>，请求体直接是参数对象（不带 {action, params} 信封）。
  const response = await fetch(`${options.api.replace(/\/$/, '')}/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: JSON.stringify(params || {})
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`OneBot API ${action} 失败：HTTP ${response.status} ${text.slice(0, 200)}`);
  // OneBot 在业务失败时仍可能返回 HTTP 200，需要看 retcode
  if (data && typeof data.retcode === 'number' && data.retcode !== 0) {
    const detail = data.message || data.wording || data.msg || '';
    throw new Error(`OneBot API ${action} 失败：retcode ${data.retcode}${detail ? ' ' + detail : ''}`);
  }
  return data;
}

const reply = (options, groupId, message) =>
  callApi(options, 'send_group_msg', { group_id: Number(groupId), message });

const replyPrivate = (options, userId, message) =>
  callApi(options, 'send_private_msg', { user_id: Number(userId), message });

// 从 OneBot 消息段数组里取出纯文本（去掉 @ 机器人等）
function extractText(event) {
  const segments = Array.isArray(event.message) ? event.message : [];
  return segments
    .filter(segment => segment.type === 'text')
    .map(segment => segment.data?.text || '')
    .join('')
    .trim();
}

const isMentioned = (event, selfId) =>
  (Array.isArray(event.message) ? event.message : [])
    .some(segment => segment.type === 'at' && String(segment.data?.qq) === String(selfId));

function log(message) {
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  console.log(`[${stamp}] ${message}`);
}

module.exports = { startEventServer, callApi, reply, replyPrivate, extractText, isMentioned, log };
