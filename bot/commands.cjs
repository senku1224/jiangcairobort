/* 指令解析与回复生成（纯逻辑，便于单测）。
 *
 * 第一阶段只做「只读」：/帮助、/招募、/网站。
 * 涉及身份和写入的（/绑定、/报名、/我的）先占位，等接入身份后再实现，不假装已完成。
 */
'use strict';

const { formatQuestList } = require('./supabase-rest.cjs');

const COMMANDS = {
  help: ['帮助', 'help', '?', '？', '菜单'],
  quests: ['招募', '列表', '开黑', '活动'],
  site: ['网站', '网址', '链接', 'site'],
  bind: ['绑定', 'bind'],
  join: ['报名', '参加'],
  mine: ['我的', '我的招募', 'mylevel']
};

function normalize(text, prefix) {
  let value = String(text || '').trim();
  if (prefix && value.startsWith(prefix)) value = value.slice(prefix.length).trim();
  if (value.startsWith('/')) value = value.slice(1).trim();
  return value;
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
  return { name: 'unknown', args: [], raw: value };
}

function helpText(siteUrl) {
  return [
    '酱菜冒险者公会 · 机器人指令',
    '· /招募 —— 查看当前开放中的招募',
    '/网站 —— 打开招募网站',
    '/帮助 —— 显示这份说明',
    '（/绑定、/报名、/我的 需要身份系统，暂未开放）',
    `网站 👉 ${siteUrl}`
  ].join('\n');
}

// 只有被明确触发的指令才回复；普通聊天不打扰
async function handleCommand(text, deps, prefix) {
  const parsed = parseCommand(text, prefix);
  if (!parsed || parsed.name === 'unknown') return { handled: false };

  switch (parsed.name) {
    case 'help':
      return { handled: true, reply: helpText(deps.siteUrl) };
    case 'site':
      return { handled: true, reply: `招募网站 👉 ${deps.siteUrl}` };
    case 'quests': {
      try {
        // 优先用带缓存兜底的读取；不支持时回退到普通读取（便于测试替身）
        if (typeof deps.reader.listOpenQuestsSafe === 'function') {
          const { quests, stale, savedAt } = await deps.reader.listOpenQuestsSafe();
          return { handled: true, reply: formatQuestList(quests, deps.siteUrl, { stale, savedAt }) };
        }
        const quests = await deps.reader.listOpenQuests();
        return { handled: true, reply: formatQuestList(quests, deps.siteUrl) };
      } catch (error) {
        return { handled: true, reply: `读取招募失败：${error.message}` };
      }
    }
    case 'bind':
      return { handled: true, reply: '绑定功能还没开放——身份系统接入后，你会在网站上拿到绑定码，再发给我即可。' };
    case 'join':
    case 'mine':
      return { handled: true, reply: `这个指令需要身份系统，暂时请到网站操作 👉 ${deps.siteUrl}` };
    default:
      return { handled: false };
  }
}

module.exports = { parseCommand, handleCommand, helpText, normalize };
