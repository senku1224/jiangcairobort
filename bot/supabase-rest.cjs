/* 通过 Supabase REST 读写招募数据（只用 Node 内置模块）。
 *
 * 网络注意：本机直连 Supabase(Cloudflare) 可能被重置，需经代理才能稳定访问。
 * 因此这里支持「经 HTTP 代理的 CONNECT 隧道」并在网络抖动时自动重试。
 *
 * 读取用公开的 publishable key（受 RLS 约束）；写入（绑定/报名/取消）用 service_role key，
 * 只在提供了 SUPABASE_SERVICE_KEY 时才启用，见下方 createWriter。
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

/* 服务端写入：用 service_role key 绕过 RLS，代表「已在机器人里验证过 QQ 的用户」写库。
 *
 * 信任来源：OneBot 上报里的 user_id 就是 QQ 号，由 NapCat 从真实登录的 QQ 会话取得，
 * 用户无法伪造。绑定码又只能在网页端（自己的登录身份下）生成，两者结合即可确认归属。
 *
 * 注意：service_role 会绕过 RLS，所以这里的每一步都必须自己判断"是谁、能不能做"，
 * 不能把用户传来的身份当成可信。
 */
function createWriter(supabaseUrl, serviceKey, settings = {}) {
  const base = supabaseUrl.replace(/\/$/, '');
  const baseHeaders = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };

  async function rest(pathname, options = {}) {
    const { method = 'GET', body, prefer } = options;
    const headers = { ...baseHeaders };
    if (prefer) headers.prefer = prefer;
    const response = await withRetry(
      `${base}/rest/v1/${pathname}`,
      { method, headers, body: body ? JSON.stringify(body) : undefined },
      settings
    );
    if (response.status < 200 || response.status >= 300) {
      let detail = response.text.slice(0, 200);
      try { const parsed = JSON.parse(response.text); if (parsed.message) detail = parsed.message; } catch { /* 保持原文 */ }
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    return response.text ? JSON.parse(response.text) : null;
  }

  // QQ 号 → 该 QQ 绑定的身份（未绑定返回 null）
  async function resolveByQq(qq) {
    const rows = await rest(`profiles?qq_number=eq.${encodeURIComponent(qq)}&select=id,nickname&limit=1`);
    if (!rows.length) return null;
    return { uid: rows[0].id, nickname: rows[0].nickname };
  }

  // 用一次性绑定码把 QQ 号写到自己那一行 profile 上
  async function bindByCode(code, qq) {
    const now = new Date().toISOString();
    const codes = await rest(
      `link_codes?code=eq.${encodeURIComponent(code)}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=code,user_id&limit=1`
    );
    if (!codes.length) return { ok: false, reason: '绑定码无效、已过期或已被使用，请到网站「冒险者名片」重新生成。' };
    const uid = codes[0].user_id;

    // 该 QQ 若曾绑到别的身份，先释放（换浏览器/换号重绑的情况）
    const existing = await rest(`profiles?qq_number=eq.${encodeURIComponent(qq)}&select=id&limit=1`);
    if (existing.length && existing[0].id !== uid) {
      await rest(`profiles?id=eq.${existing[0].id}`, { method: 'PATCH', body: { qq_number: null, bound_at: null } });
    }

    // upsert：匿名用户可能还没有 profile 行
    const rows = await rest('profiles?on_conflict=id', {
      method: 'POST',
      body: { id: uid, qq_number: qq, bound_at: now },
      prefer: 'resolution=merge-duplicates,return=representation'
    });

    await rest(`link_codes?code=eq.${encodeURIComponent(code)}`, { method: 'PATCH', body: { consumed_at: now, consumed_qq: qq } });

    return { ok: true, nickname: rows && rows[0] ? rows[0].nickname : undefined };
  }

  // 以某个身份报名（容量/截止由数据库触发器兜底）
  async function joinQuest(questId, uid, nickname) {
    try {
      const rows = await rest('quest_members', {
        method: 'POST',
        body: { quest_id: questId, user_id: uid, nickname },
        prefer: 'return=representation'
      });
      return { ok: true, row: rows && rows[0] };
    } catch (error) {
      if (error.status === 409 || /duplicate key/i.test(error.message)) {
        return { ok: false, reason: '你已经报名过这份委托了。' };
      }
      return { ok: false, reason: error.message };
    }
  }

  async function leaveQuest(questId, uid) {
    const rows = await rest(
      `quest_members?quest_id=eq.${encodeURIComponent(questId)}&user_id=eq.${uid}`,
      { method: 'DELETE', prefer: 'return=representation' }
    );
    return { ok: true, removed: (rows || []).length };
  }

  async function myQuests(uid) {
    const joinedRows = await rest(`quest_members?user_id=eq.${uid}&select=quest_id`);
    const owned = await rest(`quests?owner_id=eq.${uid}&select=id,game,start_at,state,capacity&order=start_at.asc`);
    let joined = [];
    const ids = joinedRows.map(row => row.quest_id);
    if (ids.length) {
      const list = ids.map(id => `"${id}"`).join(',');
      joined = await rest(`quests?id=in.(${list})&select=id,game,start_at,state,capacity&order=start_at.asc`);
    }
    return { joined, owned };
  }

  return { resolveByQq, bindByCode, joinQuest, leaveQuest, myQuests };
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

module.exports = { createReader, createWriter, toBeijing, formatQuestList };
