/* Supabase 共享数据服务。
 *
 * 与 js/data.js 的 GuildData.createService 返回完全相同的异步接口：
 *   init / snapshot / updateNickname / createQuest / joinQuest / leaveQuest /
 *   finishQuest / clearDemo / exportData
 * 界面层因此不需要改动，只是把 localStorage 换成了共享数据库。
 *
 * 身份：仍然存放在浏览器 localStorage（键 jiangcai.guild.identity.v1），
 * 因为当前尚未接入登录。它是「同一浏览器内的稳定标识」，不是经过验证的账号，
 * 因此任何人都可以伪造它；真正的权限最终只能靠 RLS + 未来的身份认证来保证。
 */
(function (root) {
  'use strict';

  const IDENTITY_KEY = 'jiangcai.guild.identity.v1';
  const COLUMNS = 'id,game,owner_id,owner_nickname,start_at,created_at,capacity,voice,note,state,is_demo,quest_members(user_id,nickname,created_at)';

  function newId() {
    return root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function textField(value, label, max, required = true) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (required && !result) throw new Error(`请填写${label}`);
    if (result.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
    return result;
  }

  function mapError(error) {
    const message = error?.message || '共享服务器返回了未知错误。';
    if (/duplicate key/i.test(message)) return new Error('你已经在这支队伍里啦。');
    if (/does not exist|schema cache|PGRST205/i.test(message)) {
      return new Error('共享数据表尚未创建，请先在 Supabase 运行 supabase/schema.sql。');
    }
    return new Error(message);
  }

  function fromRow(row) {
    const members = (row.quest_members || [])
      .slice()
      .sort((first, second) => String(first.created_at).localeCompare(String(second.created_at)))
      .map(member => ({ id: member.user_id, nickname: member.nickname }));
    return {
      id: row.id,
      game: row.game,
      owner: { id: row.owner_id, nickname: row.owner_nickname },
      startAt: row.start_at,
      createdAt: row.created_at,
      capacity: row.capacity,
      voice: row.voice,
      note: row.note,
      state: row.state,
      isDemo: row.is_demo,
      members
    };
  }

  function createSupabaseService(client, storage, clock = () => Date.now()) {
    const helpers = root.GuildData;
    let identity = null;

    function loadIdentity() {
      if (identity) return identity;
      let raw = null;
      try { raw = storage.getItem(IDENTITY_KEY); } catch { /* 存储被禁用时退化为每次新身份 */ }
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.id === 'string' && parsed.id && typeof parsed.nickname === 'string' && parsed.nickname) {
            identity = { id: parsed.id, nickname: parsed.nickname };
            return identity;
          }
        } catch { /* 忽略损坏的身份，重建一个 */ }
      }
      identity = { id: newId(), nickname: '酱菜见习生' };
      persistIdentity();
      return identity;
    }

    function persistIdentity() {
      try { storage.setItem(IDENTITY_KEY, JSON.stringify(identity)); } catch { /* 无法持久化时仅本次会话有效 */ }
    }

    async function fetchQuests() {
      const { data, error } = await client.from('quests').select(COLUMNS).order('created_at', { ascending: false });
      if (error) throw mapError(error);
      return (data || []).map(fromRow);
    }

    async function fetchQuest(questId) {
      const { data, error } = await client.from('quests').select(COLUMNS).eq('id', questId).maybeSingle();
      if (error) throw mapError(error);
      if (!data) throw new Error('这份委托已不存在，请刷新列表。');
      return fromRow(data);
    }

    function decorate(quest) {
      return { ...quest, status: helpers.statusOf(quest, clock()), ...helpers.beijingParts(quest.startAt) };
    }

    function assertOpen(quest) {
      if (['ended', 'cancelled'].includes(helpers.statusOf(quest, clock()))) {
        throw new Error('这份委托已截止，不能再修改报名。');
      }
    }

    async function syncNickname(nickname) {
      const me = loadIdentity();
      if (me.nickname === nickname) return;
      me.nickname = nickname;
      persistIdentity();
      const [quests, members] = await Promise.all([
        client.from('quests').update({ owner_nickname: nickname }).eq('owner_id', me.id),
        client.from('quest_members').update({ nickname }).eq('user_id', me.id)
      ]);
      if (quests.error) throw mapError(quests.error);
      if (members.error) throw mapError(members.error);
    }

    return {
      mode: 'supabase',

      async init() {
        loadIdentity();
        await fetchQuests(); // 探活并确认数据表存在，失败时由上层决定是否回退
        return this.snapshot();
      },

      async snapshot() {
        const me = loadIdentity();
        const quests = await fetchQuests();
        return { user: { ...me }, quests: quests.map(decorate) };
      },

      async updateNickname(nickname) {
        const name = textField(nickname, '冒险者昵称', 20);
        await syncNickname(name);
        return { ...loadIdentity() };
      },

      async createQuest(input) {
        const game = textField(input.game, '游戏名称', 40);
        const nickname = textField(input.nickname, '发布者昵称', 20);
        const note = textField(input.note, '招募备注', 500, false);
        const capacity = Number(input.capacity);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32) throw new Error('队伍总人数必须为 1–32 的整数。');
        if (!Object.hasOwn(helpers.VOICE_LABELS, input.voice)) throw new Error('请选择有效的语音要求。');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || '')) throw new Error('请填写完整、有效的开黑日期和时间。');
        const timestamp = Date.parse(`${input.date}T${input.time}:00+08:00`);
        if (!Number.isFinite(timestamp) || helpers.beijingParts(timestamp).date !== input.date) throw new Error('开黑日期无效。');
        if (timestamp <= clock()) throw new Error('开黑时间必须晚于现在（北京时间）。');

        await syncNickname(nickname);
        const me = loadIdentity();
        const row = {
          id: newId(), game, owner_id: me.id, owner_nickname: me.nickname,
          start_at: new Date(timestamp).toISOString(), created_at: new Date(clock()).toISOString(),
          capacity, voice: input.voice, note, state: 'open', is_demo: false
        };
        const { error } = await client.from('quests').insert(row);
        if (error) throw mapError(error);
        const members = [];
        if (input.includeCreator) {
          const { error: memberError } = await client.from('quest_members')
            .insert({ quest_id: row.id, user_id: me.id, nickname: me.nickname });
          if (memberError) {
            await client.from('quests').delete().eq('id', row.id); // 回滚，避免留下没有队长的空委托
            throw mapError(memberError);
          }
          members.push({ user_id: me.id, nickname: me.nickname, created_at: row.created_at });
        }
        return fromRow({ ...row, quest_members: members });
      },

      async joinQuest(questId) {
        const me = loadIdentity();
        const quest = await fetchQuest(questId);
        assertOpen(quest);
        if (quest.members.some(member => member.id === me.id)) throw new Error('你已经在这支队伍里啦。');
        if (quest.members.length >= quest.capacity) throw new Error('队伍已满员，看看其他委托吧。');
        const { error } = await client.from('quest_members').insert({ quest_id: questId, user_id: me.id, nickname: me.nickname });
        if (error) throw mapError(error);
      },

      async leaveQuest(questId) {
        const me = loadIdentity();
        const quest = await fetchQuest(questId);
        assertOpen(quest);
        const { error, count } = await client.from('quest_members')
          .delete({ count: 'exact' }).eq('quest_id', questId).eq('user_id', me.id);
        if (error) throw mapError(error);
        if (!count) throw new Error('你还没有报名这份委托。');
      },

      async finishQuest(questId, nextState) {
        if (!['ended', 'cancelled'].includes(nextState)) throw new Error('无效的委托状态。');
        const me = loadIdentity();
        const quest = await fetchQuest(questId);
        if (quest.owner.id !== me.id) throw new Error('只有发布者可以管理这份委托。');
        assertOpen(quest);
        const { error } = await client.from('quests')
          .update({ state: nextState }).eq('id', questId).eq('owner_id', me.id);
        if (error) throw mapError(error);
      },

      async clearDemo() {
        const { error } = await client.from('quests').delete().eq('is_demo', true);
        if (error) throw mapError(error);
      },

      async exportData() {
        const quests = await fetchQuests();
        return JSON.stringify({ version: 1, user: { ...loadIdentity() }, exportedAt: new Date(clock()).toISOString(), quests }, null, 2);
      }
    };
  }

  const api = { createSupabaseService, IDENTITY_KEY };
  root.GuildSupabase = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
