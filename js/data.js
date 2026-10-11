/* 数据适配层：界面只调用异步方法，未来可替换为经过身份认证的后端服务。 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'jiangcai.guild.v1';
  const PRESET_GAMES = ['逃生：试炼', '离开后室', 'PEAK', 'R.E.P.O.', '猛兽派对', '渔力全开', '恐鬼症', '机械狂欢', '吞噬', '森林之子'];
  const STATUS_LABELS = { recruiting: '正在招募', soon: '即将开始', full: '已满员', ended: '已结束', cancelled: '已取消' };
  const VOICE_LABELS = { any: '语音不限', required: '需要语音', none: '不使用语音' };

  function id() {
    return root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function beijingParts(value = Date.now()) {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
  }

  function statusOf(quest, now = Date.now()) {
    if (quest.state === 'cancelled') return 'cancelled';
    if (quest.state === 'ended' || Date.parse(quest.startAt) <= now) return 'ended';
    if (quest.members.length >= quest.capacity) return 'full';
    return Date.parse(quest.startAt) - now <= 3600000 ? 'soon' : 'recruiting';
  }

  function textField(value, label, max, required = true) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (required && !result) throw new Error(`请填写${label}`);
    if (result.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
    return result;
  }

  function validState(state) {
    const validName = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 40;
    const validPerson = person => person && typeof person.id === 'string' && validName(person.nickname);
    if (!state || state.version !== 1 || !validPerson(state.user) || !Array.isArray(state.quests)) return false;
    const ids = new Set();
    return state.quests.every(quest => {
      if (!quest || typeof quest.id !== 'string' || ids.has(quest.id)) return false;
      ids.add(quest.id);
      return validName(quest.game) && validPerson(quest.owner) && Number.isInteger(quest.capacity)
        && quest.capacity >= 1 && quest.capacity <= 32 && Array.isArray(quest.members)
        && quest.members.length <= quest.capacity && quest.members.every(validPerson)
        && new Set(quest.members.map(member => member.id)).size === quest.members.length
        && Object.hasOwn(VOICE_LABELS, quest.voice) && ['open', 'ended', 'cancelled'].includes(quest.state)
        && typeof quest.note === 'string' && quest.note.length <= 500 && typeof quest.isDemo === 'boolean'
        && Number.isFinite(Date.parse(quest.startAt)) && Number.isFinite(Date.parse(quest.createdAt));
    });
  }

  function demoQuests(now) {
    const specifications = [
      ['PEAK', '山顶见', 4, 2, 40, 'required', '今晚一起爬山！不赶进度，跌倒了就互相拉一把。萌新放心来，快乐登顶最重要。'],
      ['R.E.P.O.', '纸箱骑士', 6, 3, 180, 'required', '快乐搬砖小队集合！主打一个轻拿轻放（尽量），欢迎新员工入职。'],
      ['逃生：试炼', '胆小的勇者', 4, 3, 300, 'required', '普通难度慢慢过，有人带路。可以尖叫，但请不要把队友关在门外。'],
      ['猛兽派对', '芝士小熊', 8, 5, 1440, 'any', '友谊第一，互相扔下去第二。休闲自定义房，菜一点也没有关系。'],
      ['森林之子', '森林装修队', 4, 4, 1500, 'required', '新档生存，盖房子、捡木头、给凯文放个假。这班车满啦，下次一起！'],
      ['渔力全开', '咸鱼翻身', 4, 1, 1620, 'none', '下班后来水边坐坐，听歌钓鱼，不卷图鉴。社恐冒险者友好。'],
      ['恐鬼症', '不怕不怕', 4, 3, -120, 'required', '昨晚的调查圆满结束，下次继续组队。']
    ];
    return specifications.map((specification, index) => {
      const [game, nickname, capacity, count, minutes, voice, note] = specification;
      const owner = { id: `demo-owner-${index}`, nickname };
      return {
        id: `demo-${index}`, game, owner, capacity, voice, note, state: 'open', isDemo: true,
        startAt: new Date(now + minutes * 60000).toISOString(),
        createdAt: new Date(now - (index + 1) * 1800000).toISOString(),
        members: Array.from({ length: count }, (_, memberIndex) => memberIndex === 0 ? { ...owner } : {
          id: `demo-member-${index}-${memberIndex}`, nickname: ['小酱瓜', '摸鱼法师', '土豆骑士', '月亮邮差', '勇敢蘑菇'][memberIndex - 1]
        })
      };
    });
  }

  function createService(storage, clock = () => Date.now()) {
    function read() {
      let raw;
      try { raw = storage.getItem(STORAGE_KEY); }
      catch { throw new Error('浏览器无法读取本地存储，请允许本站存储数据后重试。'); }
      if (raw === null) return null;
      try {
        const state = JSON.parse(raw);
        if (!validState(state)) throw new Error('invalid');
        return state;
      } catch {
        throw new Error('本地数据格式损坏或版本不兼容。原数据已保留，请先导出浏览器中的存储备份，再按 README 排查。');
      }
    }

    function save(state) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch { throw new Error('保存失败：浏览器存储已满或被禁用。此次操作没有保存，请检查设置后重试。'); }
    }

    // 支持 Web Locks 的同源标签页串行修改，避免同时报名覆盖数据。
    async function mutate(operation) {
      const perform = () => {
        const state = read();
        if (!state) throw new Error('公会尚未初始化，请刷新页面。');
        const result = operation(state);
        save(state);
        return result;
      };
      if (root.document && root.navigator?.locks) return root.navigator.locks.request(STORAGE_KEY, perform);
      return perform();
    }

    function getQuest(state, questId) {
      const quest = state.quests.find(item => item.id === questId);
      if (!quest) throw new Error('这份委托已不存在，请刷新列表。');
      return quest;
    }

    function assertOpen(quest) {
      if (['ended', 'cancelled'].includes(statusOf(quest, clock()))) throw new Error('这份委托已截止，不能再修改报名。');
    }

    return {
      async init() {
        const initialize = () => {
          if (!read()) save({ version: 1, user: { id: id(), nickname: '酱菜见习生' }, quests: demoQuests(clock()) });
        };
        if (root.document && root.navigator?.locks) await root.navigator.locks.request(STORAGE_KEY, initialize);
        else initialize();
        return this.snapshot();
      },
      async snapshot() {
        const state = read();
        if (!state) throw new Error('未找到本地数据，请刷新页面。');
        return {
          user: state.user,
          quests: state.quests.map(quest => ({ ...quest, status: statusOf(quest, clock()), ...beijingParts(quest.startAt) }))
        };
      },
      async updateNickname(nickname) {
        const name = textField(nickname, '冒险者昵称', 20);
        return mutate(state => {
          state.user.nickname = name;
          state.quests.forEach(quest => {
            if (quest.owner.id === state.user.id) quest.owner.nickname = name;
            quest.members.forEach(member => { if (member.id === state.user.id) member.nickname = name; });
          });
          return state.user;
        });
      },
      async createQuest(input) {
        const game = textField(input.game, '游戏名称', 40);
        const nickname = textField(input.nickname, '发布者昵称', 20);
        const note = textField(input.note, '招募备注', 500, false);
        const capacity = Number(input.capacity);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32) throw new Error('队伍总人数必须为 1–32 的整数。');
        if (!Object.hasOwn(VOICE_LABELS, input.voice)) throw new Error('请选择有效的语音要求。');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || '')) throw new Error('请填写完整、有效的开黑日期和时间。');
        const timestamp = Date.parse(`${input.date}T${input.time}:00+08:00`);
        if (!Number.isFinite(timestamp) || beijingParts(timestamp).date !== input.date) throw new Error('开黑日期无效。');
        if (timestamp <= clock()) throw new Error('开黑时间必须晚于现在（北京时间）。');
        return mutate(state => {
          state.user.nickname = nickname;
          state.quests.forEach(quest => {
            if (quest.owner.id === state.user.id) quest.owner.nickname = nickname;
            quest.members.forEach(member => { if (member.id === state.user.id) member.nickname = nickname; });
          });
          const owner = { ...state.user };
          const quest = { id: id(), game, owner, capacity, voice: input.voice, note,
            startAt: new Date(timestamp).toISOString(), createdAt: new Date(clock()).toISOString(),
            members: input.includeCreator ? [{ ...owner }] : [], state: 'open', isDemo: false };
          state.quests.unshift(quest);
          return quest;
        });
      },
      async joinQuest(questId) {
        return mutate(state => {
          const quest = getQuest(state, questId);
          assertOpen(quest);
          if (quest.members.some(member => member.id === state.user.id)) throw new Error('你已经在这支队伍里啦。');
          if (quest.members.length >= quest.capacity) throw new Error('队伍已满员，看看其他委托吧。');
          quest.members.push({ ...state.user });
        });
      },
      async leaveQuest(questId) {
        return mutate(state => {
          const quest = getQuest(state, questId);
          assertOpen(quest);
          const memberIndex = quest.members.findIndex(member => member.id === state.user.id);
          if (memberIndex === -1) throw new Error('你还没有报名这份委托。');
          quest.members.splice(memberIndex, 1);
        });
      },
      async finishQuest(questId, nextState) {
        if (!['ended', 'cancelled'].includes(nextState)) throw new Error('无效的委托状态。');
        return mutate(state => {
          const quest = getQuest(state, questId);
          if (quest.owner.id !== state.user.id) throw new Error('只有发布者可以管理这份委托。');
          assertOpen(quest);
          quest.state = nextState;
        });
      },
      async clearDemo() {
        return mutate(state => { state.quests = state.quests.filter(quest => !quest.isDemo); });
      },
      async exportData() { return JSON.stringify(read(), null, 2); }
    };
  }

  const api = { createService, PRESET_GAMES, STATUS_LABELS, VOICE_LABELS, STORAGE_KEY, statusOf, beijingParts };
  root.GuildData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
