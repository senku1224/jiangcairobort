/* Supabase 共享数据服务（阶段 1：已接入真实身份）。
 *
 * 与 js/data.js 的 GuildData.createService 返回相同的异步接口：
 *   init / snapshot / updateNickname / createQuest / joinQuest / leaveQuest /
 *   finishQuest / clearDemo / exportData
 * 另外新增身份相关接口：createLinkCode / bindingStatus。
 *
 * 身份：使用 Supabase Auth 的**匿名登录**（signInAnonymously），
 * 每个浏览器拿到一个真实的 auth.uid()，会话持久化在本地。
 * 它不是"账号"，但已足以让 RLS 用 auth.uid() 判断「这条记录是不是你的」。
 * 绑定 QQ 后，机器人才知道"网页上的谁 = 群里的哪个 QQ"。
 *
 * 界面层无需关心这些细节，仍然只调用上面那组方法。
 */
(function (root) {
  'use strict';

  const NICKNAME_KEY = 'jiangcai.guild.nickname.v1';
  const LEGACY_IDENTITY_KEY = 'jiangcai.guild.identity.v1'; // 旧版本地身份，仅用于迁移昵称
  const DEFAULT_NICKNAME = '酱菜见习生';
  const COLUMNS = 'id,game,owner_id,owner_nickname,start_at,created_at,capacity,voice,note,state,is_demo,quest_members(user_id,nickname,created_at)';

  function newQuestId() {
    return root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function randomCode() {
    if (root.crypto?.getRandomValues) {
      const buffer = new Uint32Array(1);
      root.crypto.getRandomValues(buffer);
      return String(buffer[0] % 1000000).padStart(6, '0');
    }
    return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  }

  function textField(value, label, max, required = true) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (required && !result) throw new Error(`请填写${label}`);
    if (result.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
    return result;
  }

  function isMissingTable(error) {
    return /does not exist|schema cache|PGRST205/i.test(error?.message || '');
  }

  function mapError(error) {
    const message = error?.message || '共享服务器返回了未知错误。';
    if (/duplicate key/i.test(message)) return new Error('你已经在这支队伍里啦。');
    if (/row-level security/i.test(message)) {
      return new Error('数据库拒绝了这次操作：只能修改你自己的委托或报名。请刷新页面后重试。');
    }
    if (/foreign key/i.test(message)) return new Error('关联的记录已不存在，请刷新列表后重试。');
    if (isMissingTable(error)) {
      return new Error('共享数据表尚未创建，请先在 Supabase 运行 supabase/phase1-identity.sql。');
    }
    return new Error(message);
  }

  function mapAuthError(error) {
    const message = error?.message || '登录失败。';
    if (/anonymous.*disabled/i.test(message)) {
      return new Error('共享公会尚未开启匿名登录：请在 Supabase 控制台打开 Authentication → Sign In / Providers → Anonymous sign-ins。');
    }
    if (/fetch|network|Failed to fetch/i.test(message)) {
      return new Error('无法连接共享公会数据库（网络不通或需要代理）。');
    }
    return new Error(`登录共享公会失败：${message}`);
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
    const me = { id: null, nickname: DEFAULT_NICKNAME, qqNumber: null, boundAt: null };
    let profilesReady = true;
    let ready = false;

    function storedNickname() {
      let name = null;
      try { name = storage.getItem(NICKNAME_KEY); } catch { /* 存储不可用 */ }
      if (!name) {
        // 从旧版随机身份里迁移一次昵称
        try {
          const legacy = storage.getItem(LEGACY_IDENTITY_KEY);
          if (legacy) {
            const parsed = JSON.parse(legacy);
            if (parsed && typeof parsed.nickname === 'string') name = parsed.nickname;
          }
        } catch { /* 忽略损坏数据 */ }
      }
      return (name || '').trim() ? name.trim().slice(0, 20) : DEFAULT_NICKNAME;
    }

    function persistNickname(nickname) {
      try { storage.setItem(NICKNAME_KEY, nickname); } catch { /* 无法持久化时仅本次会话有效 */ }
    }

    async function ensureSession() {
      const { data: existing } = await client.auth.getSession();
      if (existing?.session?.user?.id) return existing.session.user;
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw mapAuthError(error);
      if (!data?.user?.id) throw new Error('未能取得匿名身份，请刷新重试。');
      return data.user;
    }

    async function loadProfile() {
      const { data, error } = await client.from('profiles')
        .select('id,nickname,qq_number,bound_at').eq('id', me.id).maybeSingle();
      if (error) {
        if (isMissingTable(error)) { profilesReady = false; return null; }
        throw mapError(error);
      }
      return data || null;
    }

    async function createProfile(nickname) {
      if (!profilesReady) return;
      const { error } = await client.from('profiles').upsert({ id: me.id, nickname }, { onConflict: 'id' });
      if (error && !isMissingTable(error)) throw mapError(error);
    }

    function applyProfile(row) {
      if (!row) return;
      me.nickname = row.nickname || me.nickname;
      me.qqNumber = row.qq_number || null;
      me.boundAt = row.bound_at || null;
      persistNickname(me.nickname);
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
      if (me.nickname === nickname) return;
      const previous = me.nickname;
      me.nickname = nickname;
      persistNickname(nickname);
      const [quests, members] = await Promise.all([
        client.from('quests').update({ owner_nickname: nickname }).eq('owner_id', me.id),
        client.from('quest_members').update({ nickname }).eq('user_id', me.id)
      ]);
      if (quests.error) { me.nickname = previous; persistNickname(previous); throw mapError(quests.error); }
      if (members.error) throw mapError(members.error);
      if (profilesReady) {
        const { error } = await client.from('profiles').update({ nickname }).eq('id', me.id);
        if (error && !isMissingTable(error)) throw mapError(error);
      }
    }

    return {
      mode: 'supabase',

      async init() {
        const user = await ensureSession();
        me.id = user.id;
        const profile = await loadProfile();
        if (profile) {
          applyProfile(profile);
        } else {
          me.nickname = storedNickname();
          await createProfile(me.nickname);
        }
        await fetchQuests(); // 探活并确认数据表存在，失败时由上层决定是否回退
        ready = true;
        return this.snapshot();
      },

      async snapshot() {
        if (!ready) throw new Error('共享服务尚未初始化。');
        const quests = await fetchQuests();
        return {
          user: { id: me.id, nickname: me.nickname, qqNumber: me.qqNumber, boundAt: me.boundAt },
          quests: quests.map(decorate)
        };
      },

      async updateNickname(nickname) {
        const name = textField(nickname, '冒险者昵称', 20);
        await syncNickname(name);
        return { id: me.id, nickname: me.nickname, qqNumber: me.qqNumber, boundAt: me.boundAt };
      },

      /* ---------------------------------------------------- 阶段 1 · 身份绑定 */
      async createLinkCode() {
        if (!profilesReady) throw new Error('数据库尚未准备好（缺少 profiles 表），请先执行 supabase/phase1-identity.sql。');
        // 作废自己未使用的旧码，保证同时只有一个有效码
        await client.from('link_codes').delete().eq('user_id', me.id).is('consumed_at', null);
        for (let attempt = 0; attempt < 6; attempt++) {
          const code = randomCode();
          const { error } = await client.from('link_codes').insert({ code, user_id: me.id });
          if (!error) {
            return { code, expiresAt: new Date(clock() + 10 * 60000).toISOString() };
          }
          if (!/duplicate key/i.test(error.message)) throw mapError(error);
        }
        throw new Error('生成绑定码失败，请稍后重试。');
      },

      async bindingStatus() {
        if (!profilesReady) throw new Error('数据库尚未准备好（缺少 profiles 表），请先执行 supabase/phase1-identity.sql。');
        const { data: profile, error } = await client.from('profiles')
          .select('nickname,qq_number,bound_at').eq('id', me.id).maybeSingle();
        if (error) throw mapError(error);
        applyProfile(profile);
        const { data: codes, error: codeError } = await client.from('link_codes')
          .select('code,expires_at,consumed_at').eq('user_id', me.id).is('consumed_at', null)
          .gt('expires_at', new Date(clock()).toISOString())
          .order('created_at', { ascending: false }).limit(1);
        if (codeError) throw mapError(codeError);
        const pending = (codes || [])[0] || null;
        return {
          qqNumber: me.qqNumber,
          boundAt: me.boundAt,
          pendingCode: pending?.code || null,
          expiresAt: pending?.expires_at || null
        };
      },

      /* ------------------------------------------------------------- 委托业务 */
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
        const row = {
          id: newQuestId(), game, owner_id: me.id, owner_nickname: me.nickname,
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
        const quest = await fetchQuest(questId);
        assertOpen(quest);
        if (quest.members.some(member => member.id === me.id)) throw new Error('你已经在这支队伍里啦。');
        if (quest.members.length >= quest.capacity) throw new Error('队伍已满员，看看其他委托吧。');
        const { error } = await client.from('quest_members').insert({ quest_id: questId, user_id: me.id, nickname: me.nickname });
        if (error) throw mapError(error);
      },

      async leaveQuest(questId) {
        const quest = await fetchQuest(questId);
        assertOpen(quest);
        const { error, count } = await client.from('quest_members')
          .delete({ count: 'exact' }).eq('quest_id', questId).eq('user_id', me.id);
        if (error) throw mapError(error);
        if (!count) throw new Error('你还没有报名这份委托。');
      },

      async finishQuest(questId, nextState) {
        if (!['ended', 'cancelled'].includes(nextState)) throw new Error('无效的委托状态。');
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
        return JSON.stringify({
          version: 1,
          user: { id: me.id, nickname: me.nickname, qqNumber: me.qqNumber },
          exportedAt: new Date(clock()).toISOString(),
          quests
        }, null, 2);
      }
    };
  }

  const api = { createSupabaseService, NICKNAME_KEY };
  root.GuildSupabase = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
