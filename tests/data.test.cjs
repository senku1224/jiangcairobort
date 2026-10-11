const { test } = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/data.js');
const UI = require('../js/ui.js');

function fixture() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let now = Date.parse('2026-10-11T08:00:00Z');
  const service = Data.createService(storage, () => now);
  return { service, storage, advance: minutes => { now += minutes * 60000; } };
}
const input = overrides => ({ game: '星露谷物语', date: '2026-10-12', time: '20:00', capacity: 4, voice: 'any', nickname: '种田法师', note: '一起收南瓜', includeCreator: true, ...overrides });

test('首次初始化生成示例；重新初始化保留数据和稳定身份', async () => {
  const { service } = fixture();
  const first = await service.init();
  assert.equal(first.quests.length, 7);
  assert.ok(first.quests.every(quest => quest.isDemo));
  const second = await service.init();
  assert.deepEqual(second, first);
});

test('自定义游戏创建、北京时间转换与发布者不占位', async () => {
  const { service } = fixture();
  await service.init();
  const quest = await service.createQuest(input({ includeCreator: false, game: ' 任意自定义游戏 ' }));
  assert.equal(quest.game, '任意自定义游戏');
  assert.equal(quest.members.length, 0);
  assert.equal(quest.startAt, '2026-10-12T12:00:00.000Z');
  assert.equal(quest.isDemo, false);
});

test('报名、满员、拒绝重复或超员、取消后重新开放', async () => {
  const { service } = fixture();
  await service.init();
  await service.joinQuest('demo-2');
  let quest = (await service.snapshot()).quests.find(item => item.id === 'demo-2');
  assert.equal(quest.status, 'full');
  assert.equal(quest.members.length, 4);
  await assert.rejects(service.joinQuest('demo-2'), /已经/);
  await assert.rejects(service.joinQuest('demo-4'), /满员/);
  await service.leaveQuest('demo-2');
  quest = (await service.snapshot()).quests.find(item => item.id === 'demo-2');
  assert.equal(quest.status, 'recruiting');
  assert.equal(quest.members.length, 3);
  await assert.rejects(service.leaveQuest('demo-2'), /没有报名/);
});

test('创建满员委托时直接显示满员；发布者也可退出报名', async () => {
  const { service } = fixture();
  await service.init();
  const quest = await service.createQuest(input({ capacity: 1 }));
  assert.equal((await service.snapshot()).quests[0].status, 'full');
  await service.leaveQuest(quest.id);
  assert.equal((await service.snapshot()).quests[0].status, 'recruiting');
  await service.joinQuest(quest.id);
  assert.equal((await service.snapshot()).quests[0].status, 'full');
});

test('重名昵称不能冒充示例发布者或示例成员', async () => {
  const { service } = fixture();
  await service.init();
  await service.updateNickname('山顶见');
  await assert.rejects(service.finishQuest('demo-0', 'cancelled'), /只有发布者/);
  await service.joinQuest('demo-0');
  const quest = (await service.snapshot()).quests.find(item => item.id === 'demo-0');
  assert.equal(quest.members.filter(member => member.nickname === '山顶见').length, 2);
  assert.equal(new Set(quest.members.map(member => member.id)).size, 3);
});

test('修改昵称保持 ID、所有发布权和报名记录', async () => {
  const { service } = fixture();
  const initial = await service.init();
  const quest = await service.createQuest(input());
  await service.joinQuest('demo-0');
  await service.updateNickname('新的名字');
  const state = await service.snapshot();
  assert.equal(state.user.id, initial.user.id);
  assert.equal(state.quests[0].owner.nickname, '新的名字');
  assert.equal(state.quests[0].members[0].nickname, '新的名字');
  assert.equal(state.quests.find(item => item.id === 'demo-0').members.at(-1).nickname, '新的名字');
  await service.finishQuest(quest.id, 'ended');
  assert.equal((await service.snapshot()).quests[0].status, 'ended');
});

test('自动即将开始、到点截止，结束或取消后无法报名', async () => {
  const { service, advance } = fixture();
  await service.init();
  assert.equal((await service.snapshot()).quests[0].status, 'soon');
  advance(41);
  assert.equal((await service.snapshot()).quests[0].status, 'ended');
  await assert.rejects(service.joinQuest('demo-0'), /截止/);
  const quest = await service.createQuest(input());
  await service.finishQuest(quest.id, 'cancelled');
  await assert.rejects(service.joinQuest(quest.id), /截止/);
  await assert.rejects(service.leaveQuest(quest.id), /截止/);
  await assert.rejects(service.finishQuest(quest.id, 'ended'), /截止/);
});

test('输入验证拒绝过去时间、无效日期、人数和空昵称，不写入失败数据', async () => {
  const { service } = fixture();
  const initial = await service.init();
  const cases = [
    { date: '2026-10-10' }, { date: '2027-02-30' }, { time: '24:00' },
    { capacity: 0 }, { capacity: 33 }, { capacity: 2.5 }, { capacity: 'bad' },
    { nickname: '  ' }, { nickname: '字'.repeat(21) }, { game: ' ' },
    { game: '字'.repeat(41) }, { note: '字'.repeat(501) }, { voice: 'invalid' }
  ];
  for (const invalid of cases) await assert.rejects(service.createQuest(input(invalid)));
  assert.deepEqual(await service.snapshot(), initial);
});

test('清除示例保留自建委托；刷新不重新生成示例', async () => {
  const { service, storage } = fixture();
  await service.init();
  const quest = await service.createQuest(input());
  await service.clearDemo();
  assert.equal((await service.snapshot()).quests.length, 1);
  const reloaded = Data.createService(storage, () => Date.parse('2026-10-11T08:00:00Z'));
  assert.equal((await reloaded.init()).quests[0].id, quest.id);
  const empty = fixture();
  await empty.service.init();
  await empty.service.clearDemo();
  assert.equal((await empty.service.init()).quests.length, 0);
});

test('组合筛选、自定义游戏搜索、日期和我的管理列表', async () => {
  const { service } = fixture();
  await service.init();
  const quest = await service.createQuest(input({ game: 'Custom Game' }));
  const state = await service.snapshot();
  const filters = { page: 'mine', mine: 'published', search: 'custom', game: 'Custom Game', date: '2026-10-12', status: 'active', slots: true, sort: 'newest' };
  assert.deepEqual(UI.filterQuests(state.quests, filters, state.user).map(item => item.id), [quest.id]);
  assert.equal(UI.filterQuests(state.quests, { ...filters, date: '2026-10-13' }, state.user).length, 0);
  await service.finishQuest(quest.id, 'ended');
  assert.equal(UI.filterQuests((await service.snapshot()).quests, { ...filters, status: 'all', slots: false, mine: 'manageable' }, state.user).length, 0);
});

test('不信任用户内容，卡片、详情、属性统一转义', async () => {
  const { service } = fixture();
  await service.init();
  await service.createQuest(input({ game: '<img src=x onerror=alert(1)>', nickname: '<svg/onload=1>', note: '<script>alert(1)</script>"\'&' }));
  const state = await service.snapshot();
  const html = UI.card(state.quests[0], state.user) + UI.detail(state.quests[0], state.user);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(UI.escape('"\'&<>'), '&quot;&#39;&amp;&lt;&gt;');
});

test('存储损坏时保留原数据，不静默覆盖；写入失败时显式报错', async () => {
  const { service, storage } = fixture();
  storage.setItem(Data.STORAGE_KEY, '{broken');
  await assert.rejects(service.init(), /原数据已保留/);
  assert.equal(storage.getItem(Data.STORAGE_KEY), '{broken');
  const blocked = Data.createService({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  await assert.rejects(blocked.init(), /保存失败/);
});

test('同一存储中的顺序修改读取最新队伍人数，不超员', async () => {
  const { service, storage } = fixture();
  await service.init();
  const secondTab = Data.createService(storage, () => Date.parse('2026-10-11T08:00:00Z'));
  const results = await Promise.allSettled([service.joinQuest('demo-2'), secondTab.joinQuest('demo-2')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await service.snapshot()).quests.find(quest => quest.id === 'demo-2').members.length, 4);
});

test('北京时间跨日期转换与导出数据格式', async () => {
  assert.deepEqual(Data.beijingParts('2026-10-11T17:30:00Z'), { date: '2026-10-12', time: '01:30' });
  const { service } = fixture();
  await service.init();
  const backup = JSON.parse(await service.exportData());
  assert.equal(backup.version, 1);
  assert.equal(backup.quests.length, 7);
});
