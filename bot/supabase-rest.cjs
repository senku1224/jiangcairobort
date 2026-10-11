/* 通过 Supabase REST 读取招募数据（只用 fetch，零依赖）。
 *
 * 当前阶段只用公开的 publishable key 做「只读」，不依赖 service key。
 */
'use strict';

function createReader(supabaseUrl, apiKey) {
  const base = supabaseUrl.replace(/\/$/, '');
  const headers = { apikey: apiKey, authorization: `Bearer ${apiKey}` };

  async function rest(path) {
    const response = await fetch(`${base}/rest/v1/${path}`, { headers });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase 读取失败：HTTP ${response.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : [];
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
