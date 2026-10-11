/* 通过 Supabase REST 读取招募数据（只用 Node 内置模块）。
 *
 * 网络注意：本机直连 Supabase(Cloudflare) 可能被重置，需经代理才能稳定访问。
 * 因此这里支持「经 HTTP 代理的 CONNECT 隧道」并在网络抖动时自动重试。
 * 当前阶段只用公开的 publishable key 做只读，不依赖 service key。
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

function once(url, options, proxy) {
  const { method = 'GET', headers = {}, body } = options || {};
  const target = new URL(url);

  // 无代理，或目标不是 https：直接用内置 fetch
  if (!proxy || target.protocol !== 'https:') {
    return fetch(url, { method, headers, body }).then(async response => ({
      status: response.status,
      text: await response.text()
    }));
  }

  // 经 HTTP 代理建立 CONNECT 隧道后再发 https 请求
  return new Promise((resolve, reject) => {
    let proxyUrl;
    try { proxyUrl = new URL(proxy); } catch { reject(new Error(`代理地址无效：${proxy}`)); return; }
    const authority = `${target.hostname}:${target.port || 443}`;
    const connect = http.request({
      host: proxyUrl.hostname,
      port: proxyUrl.port || 80,
      method: 'CONNECT',
      path: authority,
      headers: { host: authority }
    });
    connect.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败：HTTP ${response.statusCode}`));
        return;
      }
      const request = https.request({
        socket,
        servername: target.hostname,
        method,
        path: target.pathname + target.search,
        headers: { host: target.host, ...headers }
      }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, text: data }));
      });
      request.on('error', reject);
      if (body) request.write(body);
      request.end();
    });
    connect.on('error', reject);
    connect.end();
  });
}

async function withRetry(url, options, settings) {
  const retries = settings.retries || 3;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await once(url, options, settings.proxy);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastError;
}

function createReader(supabaseUrl, apiKey, settings = {}) {
  const base = supabaseUrl.replace(/\/$/, '');
  const headers = { apikey: apiKey, authorization: `Bearer ${apiKey}` };

  async function rest(path) {
    const response = await withRetry(`${base}/rest/v1/${path}`, { headers }, settings);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Supabase 读取失败：HTTP ${response.status} ${response.text.slice(0, 200)}`);
    }
    return response.text ? JSON.parse(response.text) : [];
  }

  // 未开始、仍开放招募的委托，按开始时间升序
  async function listOpenQuests(limit = 10) {
    const now = new Date().toISOString();
    const quests = await rest(
      `quests?select=id,game,owner_nickname,start_at,capacity,voice,note,state&state=eq.open&start_at=gt.${encodeURIComponent(now)}&order=start_at.asc&limit=${limit}`
    );
    if (!quests.length) return [];
    const ids = quests.map(quest => quest.id).map(id => `"${id}"`).join(',');
    const members = await rest(`quest_members?select=quest_id&quest_id=in.(${ids})`);
    const taken = new Map();
    for (const member of members) taken.set(member.quest_id, (taken.get(member.quest_id) || 0) + 1);
    return quests.map(quest => ({
      ...quest,
      joined: taken.get(quest.id) || 0,
      remaining: Math.max(0, (quest.capacity || 0) - (taken.get(quest.id) || 0))
    }));
  }

  return { listOpenQuests };
}

function toBeijing(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatQuestList(quests, siteUrl) {
  if (!quests.length) return '当前没有开放中的招募。去网站发布一份吧 👉 ' + siteUrl;
  const lines = quests.slice(0, 8).map((quest, index) => {
    const seat = quest.remaining > 0 ? `剩 ${quest.remaining} 席` : '已满员';
    const note = quest.note ? `｜${String(quest.note).slice(0, 12)}` : '';
    return `${index + 1}. ${quest.game}｜${toBeijing(quest.start_at)}｜${seat}｜队长 ${quest.owner_nickname}${note}`;
  });
  return ['当前开放招募：', ...lines, `共 ${quests.length} 份 · 报名请到网站 👉 ${siteUrl}`].join('\n');
}

module.exports = { createReader, toBeijing, formatQuestList };
