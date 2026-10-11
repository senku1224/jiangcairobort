/* 指令解析与回复生成（纯逻辑，便于单测）。
 *
 * 只读：/帮助、/招募、/网站。
 * 需要身份（走 service key 写入）：/绑定、/报名、/取消、/我的。
 *
 * 身份信任链：网页端（自己的登录身份）生成一次性绑定码 → 用户在群里发给机器人 →
 * 机器人用「上报里的 QQ 号」（NapCat 从真实 QQ 会话取得，无法伪造）核销绑定码。
 * 未完成绑定前，写操作一律拒绝，不假装成功。
 */
'use strict';

const { formatQuestList, toBeijing } = require('./supabase-rest.cjs');

const DEFAULT_NICKNAME = '酱菜见习生';

const COMMANDS = {
  help: ['帮助', 'help', '?', '？', '菜单'],
  quests: ['招募', '列表', '开黑', '活动'],
  site: ['网站', '网址', '链接', 'site'],
  bind: ['绑定', 'bind'],
  join: ['报名', '参加'],
  leave: ['取消', '退出', '取消报名', 'leave', 'quit'],
  mine: ['我的', '我的招募', 'mylevel', '我的冒险']
};

const NEED_KEY = '这个功能需要写入密钥（service key）才能用。请管理员在 bot/.env 里配置 SUPABASE_SERVICE_KEY 后重启机器人。';

function normalize(text, prefix) {
  let value = String(text || '').trim();
  // 全角数字 / 全角斜杠 先归一化，避免「／绑定１２３４５６」这类输入失败
  value = value
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[／]/g, '/');
  if (prefix && value.startsWith(prefix)) value = value.slice(prefix.length).trim();
  if (value.startsWith('/')) value = value.slice(1).trim();
  return value;
}

// 中文指令允许不加空格，例如「绑定586203」「报名1」「取消报名1」。
// 为避免误伤普通聊天，只接受「中文别名 + 纯数字」这种紧挨着的写法。
function splitByAlias(head) {
  let best = null;
  for (const [key, aliases] of Object.entries(COMMANDS)) {
    for (const alias of aliases) {
      if (!/^[\u4e00-\u9fa5]+$/.test(alias) || alias.length < 2) continue;
      if (!head.startsWith(alias)) continue;
      const rest = head.slice(alias.length);
      if (!/^\d+$/.test(rest)) continue;
      if (!best || alias.length > best.alias.length) best = { name: key, alias, rest };
    }
  }
  return best ? { name: best.name, args: [best.rest] } : null;
}

function parseCommand(text, prefix) {
  const value = normalize(text, prefix);
  if (!value) return null;
  const [head, ...rest] = value.split(/\s+/);
  const name = head.toLowerCase();
  for (const [key, aliases] of Object.entries(COMMANDS)) {
    if (aliases.some(alias => alias.toLowerCase() === name)) {
      return { name: key, args: rest, raw: value };
    }
  }
  const merged = splitByAlias(head);
  if (merged) return { name: merged.name, args: [...merged.args, ...rest], raw: value };
  return { name: 'unknown', args: [], raw: value };
}

// 用户只 @了机器人、后面直接跟 6 位绑定码时，也当成 /绑定
function looksLikeCode(value) {
  return /^\d{6}$/.test(String(value || '').trim());
}

function helpText(siteUrl) {
  return [
    '酱菜冒险者公会 · 机器人指令',
    '· /招募 —— 查看当前开放中的招募',
    '· /报名 <序号> —— 报名第 N 份委托（先看 /招募 的序号）',
    '· /取消 <序号> —— 取消自己的报名',
    '· /我的 —— 查看我发布的和我报名的',
    '· /绑定 <码> —— 用网站「冒险者名片」里生成的 6 位码绑定 QQ',
    '· /网站 —— 打开招募网站',
    '· /帮助 —— 显示这份说明',
    `网站 👉 ${siteUrl}`
  ].join('\n');
}

// 解析出绑定的身份；未绑定返回 { error }，调用方直接回 error
async function requireUser(deps, context) {
  if (!deps.writer) return { error: NEED_KEY };
  if (!context || !context.qq) return { error: '请在 QQ 群里使用这个指令。' };
  const profile = await deps.writer.resolveByQq(context.qq);
  if (!profile) {
    return { error: '你还没有绑定身份。先到网站「冒险者名片」生成 6 位绑定码，再发 /绑定 <码> 给我。' };
  }
  // 显示名以网站档案为准；未改过昵称时用群昵称更亲切
  const nickname = profile.nickname && profile.nickname !== DEFAULT_NICKNAME
    ? profile.nickname
    : (context.nickname || profile.nickname || DEFAULT_NICKNAME);
  return { uid: profile.uid, nickname };
}

// 按序号取一份仍开放的委托
async function pickOpenQuest(deps, args) {
  const index = Number(args[0]);
  if (!Number.isInteger(index) || index < 1) return { error: '请在指令后加上序号，例如：/报名 1（序号见 /招募 列表）。' };
  let quests;
  try {
    quests = await deps.reader.listOpenQuests();
  } catch (error) {
    return { error: `读取招募失败：${error.message}` };
  }
  const quest = quests[index - 1];
  if (!quest) return { error: `没有找到第 ${args[0]} 份委托，先发 /招募 看看当前列表吧。` };
  return { quest, index };
}

function formatMine(mine, siteUrl) {
  const line = (quest, tag) => {
    const state = quest.state === 'ended' ? '已结束' : quest.state === 'cancelled' ? '已取消' : '招募中';
    return `· [${tag}] ${quest.game}｜${toBeijing(quest.start_at)}｜${state}`;
  };
  const parts = [];
  parts.push('我发布的：');
  parts.push(mine.owned.length ? mine.owned.map(q => line(q, '发布')).join('\n') : '·（还没有发布过）');
  parts.push('');
  parts.push('我报名的：');
  parts.push(mine.joined.length ? mine.joined.map(q => line(q, '报名')).join('\n') : '·（还没有报名）');
  parts.push('');
  parts.push(`去网站管理 👉 ${siteUrl}`);
  return parts.join('\n');
}

// 只有被明确触发的指令才回复；普通聊天不打扰
async function handleCommand(text, deps, prefix, context = {}) {
  let parsed = parseCommand(text, prefix);
  // 只 @了机器人、后面直接跟 6 位码：也当成 /绑定（很多人会这么发）
  if (parsed && parsed.name === 'unknown' && context.mentioned && looksLikeCode(parsed.raw)) {
    parsed = { name: 'bind', args: [String(parsed.raw).trim()], raw: parsed.raw };
  }
  if (!parsed) return { handled: false };
  if (parsed.name === 'unknown') return { handled: false, unknown: true };
  const reply = message => ({ handled: true, reply: message });

  switch (parsed.name) {
    case 'help':
      return reply(helpText(deps.siteUrl));
    case 'site':
      return reply(`招募网站 👉 ${deps.siteUrl}`);
    case 'quests': {
      try {
        if (typeof deps.reader.listOpenQuestsSafe === 'function') {
          const { quests, stale, savedAt } = await deps.reader.listOpenQuestsSafe();
          return reply(formatQuestList(quests, deps.siteUrl, { stale, savedAt }));
        }
        const quests = await deps.reader.listOpenQuests();
        return reply(formatQuestList(quests, deps.siteUrl));
      } catch (error) {
        return reply(`读取招募失败：${error.message}`);
      }
    }
    case 'bind': {
      const code = String(parsed.args[0] || '').replace(/\D/g, '');
      if (!code) return reply('用法：/绑定 6位绑定码（在网站「冒险者名片」里点「生成绑定码」得到）。');
      if (!deps.writer) return reply(NEED_KEY);
      if (!context.qq) return reply('请在 QQ 群里使用 /绑定。');
      try {
        const result = await deps.writer.bindByCode(code, context.qq);
        if (!result.ok) return reply(`绑定失败：${result.reason}`);
        return reply(`绑定成功！以后群里的你 = QQ ${context.qq}${result.nickname ? `（${result.nickname}）` : ''}。现在可以用 /报名、/取消、/我的 了。`);
      } catch (error) {
        return reply(`绑定失败：${error.message}`);
      }
    }
    case 'join': {
      const user = await requireUser(deps, context);
      if (user.error) return reply(user.error);
      const picked = await pickOpenQuest(deps, parsed.args);
      if (picked.error) return reply(picked.error);
      try {
        const result = await deps.writer.joinQuest(picked.quest.id, user.uid, user.nickname);
        if (!result.ok) return reply(`报名失败：${result.reason}`);
        return reply(`报名成功！${picked.quest.game}｜${toBeijing(picked.quest.start_at)}。记得准时赴约，冒险者。`);
      } catch (error) {
        return reply(`报名失败：${error.message}`);
      }
    }
    case 'leave': {
      const user = await requireUser(deps, context);
      if (user.error) return reply(user.error);
      const picked = await pickOpenQuest(deps, parsed.args);
      if (picked.error) return reply(picked.error);
      try {
        const result = await deps.writer.leaveQuest(picked.quest.id, user.uid);
        if (!result.removed) return reply('你没有报名这份委托，无需取消。');
        return reply(`已取消报名：${picked.quest.game}。位置已重新开放给其他冒险者。`);
      } catch (error) {
        return reply(`取消失败：${error.message}`);
      }
    }
    case 'mine': {
      const user = await requireUser(deps, context);
      if (user.error) return reply(user.error);
      try {
        const mine = await deps.writer.myQuests(user.uid);
        return reply(formatMine(mine, deps.siteUrl));
      } catch (error) {
        return reply(`查询失败：${error.message}`);
      }
    }
    default:
      return { handled: false };
  }
}

module.exports = { parseCommand, handleCommand, helpText, normalize, looksLikeCode, COMMANDS, DEFAULT_NICKNAME };
