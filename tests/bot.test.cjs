/* 机器人指令解析与回复的单元测试（无外部依赖）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, handleCommand, normalize } = require('../bot/commands.cjs');

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

test('handleCommand /绑定 与 /报名 不假装已完成', async () => {
  const deps = { reader: { listOpenQuests: async () => [] }, siteUrl: 'https://example.com/' };
  assert.match((await handleCommand('绑定 123456', deps, '')).reply, /还没开放/);
  assert.match((await handleCommand('报名', deps, '')).reply, /需要身份系统/);
});
