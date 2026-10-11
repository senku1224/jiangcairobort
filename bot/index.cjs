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
const { startEventServer, reply, replyPrivate, extractText, isMentioned, stripPlainMention, log } = require('./onebot.cjs');
const { createReader, createWriter } = require('./supabase-rest.cjs');
const { handleCommand, parseCommand, looksLikeCode } = require('./commands.cjs');

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
  const raw = extractText(event);
  if (!raw) return;
  // 手机端可能把「@昵称」当普通文本发出，这里先去掉，便于按指令解析
  const text = stripPlainMention(raw);
  if (!text) return;

  const isGroup = event.message_type === 'group';
  const mentioned = isMentioned(event, event.self_id) || /^@/.test(raw);
  const slashy = /^[\/／]/.test(text) || (config.commandPrefix && text.startsWith(config.commandPrefix));
  // 有些情况拿不到 @ 消息段：手打的「@昵称」、或 @ 到了群里另一个机器人。
  // 只要文本本身就是「明确要机器人做事」的指令（带参数的绑定/报名/取消，或一个 6 位绑定码），
  // 也照常响应，避免指令被静默丢掉、群里像没反应一样。
  const peek = parseCommand(text, config.commandPrefix);
  const bareCode = looksLikeCode(stripTriggers(text));
  const explicit = bareCode || !!(peek && ['bind', 'join', 'leave'].includes(peek.name) && peek.args.length > 0);
  if (isGroup) {
    if (!isGroupAllowed(event.group_id)) return;
    if (!mentioned && !slashy && !explicit) return;
  }
  // 私聊：允许直接发「招募」「绑定 123456」这类松散写法；
  // 认不出的内容不会回复（下面的提示只在被 @ 或带 / 时触发）。

  const content = stripTriggers(text);
  const context = {
    scopeId: isGroup ? String(event.group_id) : `private-${event.user_id}`,
    qq: event.user_id ? String(event.user_id) : '',
    nickname: (event.sender && (event.sender.card || event.sender.nickname)) || '',
    isGroup,
    mentioned,
    bareCode
  };
  log(`收到 ${isGroup ? `群 ${event.group_id}` : `私聊 ${event.user_id}`}｜QQ ${context.qq || '?'}：${raw}`);
  const result = await handleCommand(content, deps, config.commandPrefix, context);
  let answer = result.handled ? result.reply : '';
  if (!answer && result.unknown && (mentioned || slashy)) {
    answer = [
      '没认出这条指令，发 /帮助 看看我能做什么。',
      '常用：/招募 看列表 · /报名 <序号> · /我的 · /网站',
      '绑定身份：到网站「冒险者名片」点「生成绑定码」，再发 /绑定 <6位码>。'
    ].join('\n');
  }
  if (!answer) return;

  try {
    if (isGroup) {
      await reply({ api: config.onebotApi, token: config.onebotToken }, event.group_id, answer);
      log(`群 ${event.group_id} 回复「${content}」`);
    } else {
      await replyPrivate({ api: config.onebotApi, token: config.onebotToken }, event.user_id, answer);
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
