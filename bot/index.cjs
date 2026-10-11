/* 酱菜冒险者公会 · QQ 机器人后端（本机运行）。
 *
 * 角色：接收 NapCat 的 OneBot v11 HTTP 上报 → 解析指令 → 调用 NapCat HTTP API 回复。
 * 只读（/招募、/网站、/帮助）用公开 key；写入（/绑定、/报名、/取消、/我的）在配置了
 * SUPABASE_SERVICE_KEY 后启用，未配置时这些指令会明确说明"未启用"，不会假装成功。
 *
 * 启动：node bot/index.cjs
 */
'use strict';

const { config, isGroupAllowed } = require('./config.cjs');
const { startEventServer, reply, replyPrivate, extractText, isMentioned, log } = require('./onebot.cjs');
const { createReader, createWriter } = require('./supabase-rest.cjs');
const { handleCommand } = require('./commands.cjs');

const reader = createReader(config.supabaseUrl, config.supabaseKey, { proxy: config.httpProxy, retries: 4 });
const writer = config.supabaseServiceKey
  ? createWriter(config.supabaseUrl, config.supabaseServiceKey, { proxy: config.httpProxy, retries: 4 })
  : null;
const deps = { reader, writer, siteUrl: config.siteUrl };

function stripTriggers(text) {
  let value = String(text || '').trim();
  if (config.commandPrefix && value.startsWith(config.commandPrefix)) value = value.slice(config.commandPrefix.length).trim();
  if (value.startsWith('/')) value = value.slice(1).trim();
  return value;
}

async function onEvent(event) {
  if (!event || event.post_type !== 'message') return;
  const text = extractText(event);
  if (!text) return;

  const isGroup = event.message_type === 'group';
  if (isGroup) {
    if (!isGroupAllowed(event.group_id)) return;
    const triggered = isMentioned(event, event.self_id) || text.startsWith('/') || (config.commandPrefix && text.startsWith(config.commandPrefix));
    if (!triggered) return;
  }

  const content = stripTriggers(text);
  const context = {
    scopeId: isGroup ? String(event.group_id) : `private-${event.user_id}`,
    qq: event.user_id ? String(event.user_id) : '',
    nickname: (event.sender && (event.sender.card || event.sender.nickname)) || '',
    isGroup
  };
  const result = await handleCommand(content, deps, config.commandPrefix, context);
  if (!result.handled || !result.reply) return;

  try {
    if (isGroup) {
      await reply({ api: config.onebotApi, token: config.onebotToken }, event.group_id, result.reply);
      log(`群 ${event.group_id} 回复「${content}」`);
    } else {
      await replyPrivate({ api: config.onebotApi, token: config.onebotToken }, event.user_id, result.reply);
      log(`私聊 ${event.user_id} 回复「${content}」`);
    }
  } catch (error) {
    log(`发送失败：${error.message}`);
  }
}

(async () => {
  await startEventServer({ port: config.listenPort, path: config.listenPath }, onEvent);
  log('机器人后端已启动（本机）');
  log(`监听上报：http://127.0.0.1:${config.listenPort}${config.listenPath}`);
  log(`NapCat API：${config.onebotApi}`);
  log(`响应群：${config.allowedGroups.length ? config.allowedGroups.join(', ') : '全部'}`);
  log(`写入密钥：${config.supabaseServiceKey ? '已配置（/绑定 /报名 /取消 可用）' : '未配置（只读：/招募 /网站 /帮助）'}`);
  log('在 NapCat 里把「HTTP 上报」指向上面的监听地址，并开启「HTTP 服务器」即可。');
})().catch(error => {
  console.error('启动失败：', error.message);
  process.exit(1);
});
