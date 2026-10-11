/* 机器人指令解析与回复的单元测试（无外部依赖）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCommand, handleCommand, normalize, looksLikeCode } = require('../bot/commands.cjs');
const { createReader, formatQuestList } = require('../bot/supabase-rest.cjs');
const { stripPlainMention } = require('../bot/onebot.cjs');

test('normalize 去掉前缀与首尾空白', () => {
  assert.equal(normalize('  /招募  ', '/'), '招募');
  assert.equal(normalize('招募', '/'), '招募');
});

test('parseCommand 识别别名', () => {
  assert.equal(parseCommand('帮助', '').name, 'help');
  assert.equal(parseCommand('help', '').name, 'help');
  assert.equal(parseCommand('/招募', '').name, 'quests');
  assert.equal(parseCommand('列表', '').name, 'quests');
  assert.equal(parseCommand('网站', '').name, 'site');
});

test('parseCommand 对普通聊天不误触发', () => {
  assert.equal(parseCommand('今天谁上线', '').name, 'unknown');
  assert.equal(parseCommand('', ''), null);
});

test('handleCommand 普通聊天返回 handled=false', async () => {
  const deps = { reader: { listOpenQuests: async () => [] }, siteUrl: 'https://example.com/' };
  const result = await handleCommand('今晚吃啥', deps, '');
  assert.equal(result.handled, false);
});

test('handleCommand /招募 汇总招募列表', async () => {
  const deps = {
    reader: {
      listOpenQuests: async () => ([
        { id: 'a', game: '双人成行', owner_nickname: '阿七', start_at: '2026-12-01T12:00:00Z', capacity: 2, joined: 1, remaining: 1, note: '来新手' }
      ])
    },
    siteUrl: 'https://example.com/'
  };
  const result = await handleCommand('招募', deps, '');
  assert.equal(result.handled, true);
  assert.match(result.reply, /双人成行/);
  assert.match(result.reply, /剩 1 席/);
  assert.match(result.reply, /https:\/\/example\.com\//);
});

test('handleCommand 读取失败时给出明确提示', async () => {
  const deps = { reader: { listOpenQuests: async () => { throw new Error('boom'); } }, siteUrl: 'https://example.com/' };
  const result = await handleCommand('招募', deps, '');
  assert.equal(result.handled, true);
  assert.match(result.reply, /读取招募失败/);
});

test('未配置写入密钥时 /绑定 /报名 明确说明未启用（不假装成功）', async () => {
  const deps = { reader: { listOpenQuests: async () => [] }, writer: null, siteUrl: 'https://example.com/' };
  assert.match((await handleCommand('绑定 123456', deps, '', { qq: '10001' })).reply, /写入密钥/);
  assert.match((await handleCommand('报名 1', deps, '', { qq: '10001' })).reply, /写入密钥/);
});

test('/绑定 无参数时给出用法', async () => {
  const deps = { reader: {}, writer: {}, siteUrl: 'https://example.com/' };
  assert.match((await handleCommand('绑定', deps, '', { qq: '10001' })).reply, /用法/);
});

test('/绑定 成功时确认绑定到该 QQ', async () => {
  const deps = {
    reader: {}, siteUrl: 'https://example.com/',
    writer: { bindByCode: async () => ({ ok: true, nickname: '阿七' }) }
  };
  const result = await handleCommand('绑定 123456', deps, '', { qq: '10001' });
  assert.match(result.reply, /绑定成功/);
  assert.match(result.reply, /10001/);
});

test('/绑定 失败时回传原因', async () => {
  const deps = {
    reader: {}, siteUrl: '',
    writer: { bindByCode: async () => ({ ok: false, reason: '绑定码无效、已过期或已被使用' }) }
  };
  assert.match((await handleCommand('绑定 000000', deps, '', { qq: '1' })).reply, /绑定码无效/);
});

test('/报名 未绑定时提示先绑定', async () => {
  const deps = {
    reader: { listOpenQuests: async () => [] }, siteUrl: '',
    writer: { resolveByQq: async () => null }
  };
  assert.match((await handleCommand('报名 1', deps, '', { qq: '10001' })).reply, /还没有绑定/);
});

test('/报名 按序号报名成功并带上身份与昵称', async () => {
  let joined = null;
  const deps = {
    reader: { listOpenQuests: async () => ([{ id: 'q1', game: '双人成行', start_at: '2026-12-01T12:00:00Z', capacity: 2, remaining: 1 }]) },
    siteUrl: '',
    writer: {
      resolveByQq: async () => ({ uid: 'u1', nickname: '阿七' }),
      joinQuest: async (id, uid, nickname) => { joined = { id, uid, nickname }; return { ok: true }; }
    }
  };
  const result = await handleCommand('报名 1', deps, '', { qq: '10001' });
  assert.match(result.reply, /报名成功/);
  assert.deepEqual(joined, { id: 'q1', uid: 'u1', nickname: '阿七' });
});

test('/报名 序号越界时提示先看列表', async () => {
  const deps = {
    reader: { listOpenQuests: async () => [] }, siteUrl: '',
    writer: { resolveByQq: async () => ({ uid: 'u1', nickname: '阿七' }) }
  };
  assert.match((await handleCommand('报名 9', deps, '', { qq: '1' })).reply, /没有找到第 9/);
});

test('/取消 未报名时提示无需取消', async () => {
  const deps = {
    reader: { listOpenQuests: async () => ([{ id: 'q1', game: '胡闹厨房', start_at: '2026-12-01T12:00:00Z' }]) },
    siteUrl: '',
    writer: {
      resolveByQq: async () => ({ uid: 'u1', nickname: '阿七' }),
      leaveQuest: async () => ({ ok: true, removed: 0 })
    }
  };
  assert.match((await handleCommand('取消 1', deps, '', { qq: '1' })).reply, /无需取消/);
});

test('/我的 汇总发布与报名', async () => {
  const deps = {
    reader: {}, siteUrl: 'https://example.com/',
    writer: {
      resolveByQq: async () => ({ uid: 'u1', nickname: '阿七' }),
      myQuests: async () => ({
        owned: [{ id: 'q1', game: '我发布的', start_at: '2026-12-01T12:00:00Z', state: 'open' }],
        joined: [{ id: 'q2', game: '我报名的', start_at: '2026-12-02T12:00:00Z', state: 'open' }]
      })
    }
  };
  const result = await handleCommand('我的', deps, '', { qq: '1' });
  assert.match(result.reply, /我发布的/);
  assert.match(result.reply, /我报名的/);
  assert.match(result.reply, /https:\/\/example\.com\//);
});

test('handleCommand /招募 在缓存兜底时标注数据可能不是最新', async () => {
  const deps = {
    reader: {
      listOpenQuestsSafe: async () => ({
        quests: [{ id: 'a', game: '胡闹厨房', owner_nickname: '阿七', start_at: '2026-12-01T12:00:00Z', capacity: 4, joined: 1, remaining: 3, note: '' }],
        stale: true,
        savedAt: '2026-10-11T10:00:00Z'
      })
    },
    siteUrl: 'https://example.com/'
  };
  const result = await handleCommand('招募', deps, '');
  assert.equal(result.handled, true);
  assert.match(result.reply, /胡闹厨房/);
  assert.match(result.reply, /缓存/);
});

test('formatQuestList 无缓存且读取失败时提示稍后重试', () => {
  const reply = formatQuestList([], 'https://example.com/', { stale: true });
  assert.match(reply, /网络读取失败/);
  assert.match(reply, /https:\/\/example\.com\//);
});

test('listOpenQuestsSafe 网络失败时回退到本机缓存', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-cache-'));
  const cachePath = path.join(dir, 'quests-cache.json');
  fs.writeFileSync(cachePath, JSON.stringify({
    savedAt: '2026-10-11T10:00:00Z',
    quests: [{ id: 'x', game: '缓存游戏', owner_nickname: '队长', start_at: '2026-12-01T12:00:00Z', capacity: 2, joined: 0, remaining: 2, note: '' }]
  }));

  // 指向一个必定连不上的地址，强制走失败分支
  const reader = createReader('https://127.0.0.1:9/', 'test-key', { cachePath, retries: 1 });
  const result = await reader.listOpenQuestsSafe();
  assert.equal(result.stale, true);
  assert.equal(result.quests.length, 1);
  assert.equal(result.quests[0].game, '缓存游戏');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listOpenQuestsSafe 无缓存且网络失败时抛错（不假装成功）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-cache-'));
  const reader = createReader('https://127.0.0.1:9/', 'test-key', { cachePath: path.join(dir, 'none.json'), retries: 1 });
  await assert.rejects(() => reader.listOpenQuestsSafe());
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── 手滑也要能用：@机器人 发码 / 不加空格 / 全角 ───────────── */

test('normalize 归一化全角数字与全角斜杠', () => {
  assert.equal(normalize('／绑定１２３４５６', ''), '绑定123456');
});

test('parseCommand 支持中文指令不加空格', () => {
  assert.equal(parseCommand('绑定586203', '').name, 'bind');
  assert.deepEqual(parseCommand('绑定586203', '').args, ['586203']);
  assert.equal(parseCommand('/报名1', '').name, 'join');
  assert.deepEqual(parseCommand('/报名1', '').args, ['1']);
  assert.deepEqual(parseCommand('取消报名1', '').args, ['1']);
});

test('stripPlainMention 去掉手机端当文本发出的 @昵称', () => {
  assert.equal(stripPlainMention('@臼井 /绑定586203'), '/绑定586203');
  assert.equal(stripPlainMention('@臼井 586203'), '586203');
  assert.equal(stripPlainMention('/招募'), '/招募');
});

test('looksLikeCode 只认 6 位数字', () => {
  assert.equal(looksLikeCode('586203'), true);
  assert.equal(looksLikeCode('58620'), false);
  assert.equal(looksLikeCode('58 6203'), false);
});

test('只 @机器人 + 6 位码 视为绑定', async () => {
  let used = null;
  const deps = {
    reader: {}, siteUrl: '',
    writer: { bindByCode: async (code, qq) => { used = { code, qq }; return { ok: true }; } }
  };
  const result = await handleCommand('586203', deps, '', { qq: '10001', mentioned: true });
  assert.equal(result.handled, true);
  assert.deepEqual(used, { code: '586203', qq: '10001' });
});

test('没被 @ 时单纯发数字不触发绑定（避免误伤普通聊天）', async () => {
  const deps = { reader: {}, writer: { bindByCode: async () => ({ ok: true }) }, siteUrl: '' };
  const result = await handleCommand('586203', deps, '', { qq: '10001', mentioned: false });
  assert.equal(result.handled, false);
});

test('认不出的指令返回 unknown，交给上层决定是否提示', async () => {
  const deps = { reader: {}, writer: {}, siteUrl: '' };
  const result = await handleCommand('随便说点什么', deps, '', { qq: '1', mentioned: true });
  assert.equal(result.handled, false);
  assert.equal(result.unknown, true);
});
