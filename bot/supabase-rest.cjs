/* 通过 Supabase REST 读取招募数据（只用 Node 内置模块）。
 *
 * 网络注意：本机直连 Supabase(Cloudflare) 可能被重置，需经代理才能稳定访问。
 * 因此这里支持「经 HTTP 代理的 CONNECT 隧道」并在网络抖动时自动重试。
 * 当前阶段只用公开的 publishable key 做只读，不依赖 service key。
 *
 * 缓存兜底：每次成功读取后会把结果落盘到本机（bot/data/，已被 gitignore）。
 * 网络不通时用「上次成功的数据」回复，并标注可能不是最新，避免群里只看到报错。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
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

function readCache(cachePath) {
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.quests)) return parsed;
  } catch { /* 无缓存或损坏：忽略 */ }
  return null;
}

function writeCache(cachePath, quests) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ savedAt: new Date().toISOString(), quests }, null, 2));
  } catch { /* 写缓存失败不影响主流程 */ }
}

function createReader(supabaseUrl, apiKey, settings = {}) {
  const base = supabaseUrl.replace(/\/$/, '');
  const headers = { apikey: apiKey, authorization: `Bearer ${apiKey}` };
  const cachePath = settings.cachePath || path.join(__dirname, 'data', 'quests-cache.json');

  async function rest(pathname) {
    const response = await withRetry(`${base}/rest/v1/${pathname}`, { headers }, settings);
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

  // 带缓存兜底：读取成功则更新缓存并返回 { quests, stale:false }；
  // 读取失败则回退到上次成功的缓存，返回 { quests, stale:true, savedAt, error }；
  // 完全无缓存时才抛错。
  async function listOpenQuestsSafe(limit = 10) {
    try {
      const quests = await listOpenQuests(limit);
      writeCache(cachePath, quests);
      return { quests, stale: false, savedAt: new Date().toISOString() };
    } catch (error) {
      const cached = readCache(cachePath);
      if (cached) return { quests: cached.quests, stale: true, savedAt: cached.savedAt, error: error.message };
      throw error;
    }
  }

  return { listOpenQuests, listOpenQuestsSafe };
}

function toBeijing(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatQuestList(quests, siteUrl, meta = {}) {
  const staleNote = meta.stale
    ? `\n⚠️ 当前网络读取失败，以下为缓存数据（${meta.savedAt ? toBeijing(meta.savedAt) : '较早'} 抓取），可能不是最新。`
    : '';
  if (!quests.length) {
    return (meta.stale
      ? '当前网络读取失败，且暂无可用缓存。稍后重试或直接到网站查看 👉 ' + siteUrl
      : '当前没有开放中的招募。去网站发布一份吧 👉 ' + siteUrl);
  }
  const lines = quests.slice(0, 8).map((quest, index) => {
    const seat = quest.remaining > 0 ? `剩 ${quest.remaining} 席` : '已满员';
    const note = quest.note ? `｜${String(quest.note).slice(0, 12)}` : '';
    return `${index + 1}. ${quest.game}｜${toBeijing(quest.start_at)}｜${seat}｜队长 ${quest.owner_nickname}${note}`;
  });
  return ['当前开放招募：', ...lines, `共 ${quests.length} 份 · 报名请到网站 👉 ${siteUrl}`].join('\n') + staleNote;
}

module.exports = { createReader, toBeijing, formatQuestList };
