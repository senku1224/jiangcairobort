/* 纯展示函数，不直接修改存储；所有用户文字在进入 HTML 前转义。 */
(function (root) {
  'use strict';
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    board: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4V2m6 2V2M8 10h8m-8 4h8m-8 4h5"/>',
    backpack: '<rect x="5" y="7" width="14" height="14" rx="4"/><path d="M8 7V5a4 4 0 0 1 8 0v2M5 13h14M10 13v3m4-3v3"/>',
    book: '<path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1v15"/>',
    shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 11 3 3 5-6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m10 3 4 0 1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    scroll: '<path d="M6 3h13v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3h11a3 3 0 0 0 6 0M6 3a3 3 0 0 0-3 3v3h5V6a3 3 0 0 0-2-3ZM11 8h5m-5 4h5"/>',
    megaphone: '<path d="m3 9 17-5v16L3 15Zm3 7 2 5h4l-2-6M16 5v14"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5Z"/>',
    flask: '<path d="M9 3h6m-5 0v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3M7 15h10"/>',
    x: '<path d="m6 6 12 12M6 18 18 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    users: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v3"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
    mute: '<path d="M9 9v3a3 3 0 0 0 5 2m1-5V5a3 3 0 0 0-5-2M5 10v2a7 7 0 0 0 12 5m2-5v-2m-7 9v3M3 3l18 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    sword: '<path d="m14 3 7 0 0 7-12 10-5-5Zm-5 12 5 5M3 21l4-4m9-9 3-3"/>',
    flag: '<path d="M5 22V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0"/>',
    leaf: '<path d="M20 3C4 2 0 13 7 18s15-2 13-15ZM5 21 17 7"/>'
  };
  const themes = {
    'PEAK': { className: 'peak', english: 'PEAK', subtitle: '向山顶，向朋友。', type: '合作攀登', icon: 'flag' },
    'R.E.P.O.': { className: 'repo', english: 'R.E.P.O.', subtitle: '小心轻放，快乐搬砖', type: '合作恐怖', icon: 'flask' },
    '逃生：试炼': { className: 'trials', english: 'THE OUTLAST TRIALS', subtitle: '勇敢一点，队友就在身边', type: '生存恐怖', icon: 'shield' },
    '猛兽派对': { className: 'party', english: 'PARTY ANIMALS', subtitle: '友谊的小船，翻了再上', type: '欢乐派对', icon: 'users' },
    '森林之子': { className: 'forest', english: 'SONS OF THE FOREST', subtitle: '在森林里，建一个家', type: '开放世界', icon: 'leaf' },
    '渔力全开': { className: 'fishing', english: 'FISHING TIME', subtitle: '今天也要，愿者上钩', type: '休闲钓鱼', icon: 'compass' },
    '恐鬼症': { className: 'trials', english: 'PHASMOPHOBIA', subtitle: '科学调查，合理尖叫', type: '合作恐怖', icon: 'shield' },
    '离开后室': { className: 'backroom', english: 'ESCAPE THE BACKROOMS', subtitle: '这一次，一起找到出口', type: '合作探索', icon: 'compass' },
    '机械狂欢': { className: 'repo', english: 'ROBOT PARTY', subtitle: '齿轮转动，快乐开场', type: '多人联机', icon: 'settings' },
    '吞噬': { className: 'trials', english: 'DEVOUR', subtitle: '别回头，跟紧你的队友', type: '合作恐怖', icon: 'flask' }
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const icon = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.compass}</svg>`;
  function hydrateIcons(container = document) {
    container.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
  }
  function theme(game) { return themes[game] || { className: 'custom', english: 'NEXT ADVENTURE', subtitle: '新的地图，新的故事', type: '自定义冒险', icon: 'compass' }; }
  function dateLabel(date) {
    const today = GuildData.beijingParts().date;
    const tomorrow = GuildData.beijingParts(Date.now() + 86400000).date;
    if (date === today) return '今天';
    if (date === tomorrow) return '明天';
    const [year, month, day] = date.split('-');
    return `${year === today.slice(0, 4) ? '' : year + '年'}${Number(month)}月${Number(day)}日`;
  }
  function cover(game) {
    const style = theme(game);
    const drawings = {
      peak: '<path d="m0 100 67-82 52 56 34-47 83 73Z" fill="#b9cba6"/><path d="m51 37 16-19 25 31-20-6-12 5Z" fill="#fff1cf"/><path d="m66 100 87-73 83 73Z" fill="#87a08a"/><path d="m136 43 17-16 19 17-18-6Z" fill="#ddd9b4"/><path d="M175 78V41m0 0 21 7-21 8" stroke="#f2bd7f" stroke-width="2"/>',
      repo: '<path d="M89 97V47q0-15 18-15h38q18 0 18 15v50Z" fill="#be8763"/><rect x="98" y="41" width="56" height="30" rx="9" fill="#272f36"/><circle cx="114" cy="55" r="6" fill="#dae1a3"/><circle cx="139" cy="55" r="6" fill="#dae1a3"/><path d="m96 97-12-18m72 18 16-18M125 32V17m0 0h15" stroke="#bd976f" stroke-width="5"/><circle cx="139" cy="17" r="4" fill="#edd08c"/>',
      trials: '<path d="M62 100V20h119v80Z" fill="#36534a"/><path d="M89 100V36h63v64Z" fill="#192c29"/><path d="M115 100V38l35-3v65Z" fill="#c0b991" opacity=".25"/><path d="M18 0v100M217 0v100M0 80h240" stroke="#7a8a68" opacity=".4"/><path d="M117 73a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-10 6h20l5 21h-30Z" fill="#1a2927"/>',
      party: '<ellipse cx="137" cy="90" rx="44" ry="34" fill="#c49a75"/><circle cx="111" cy="36" r="14" fill="#b88160"/><circle cx="160" cy="36" r="14" fill="#b88160"/><ellipse cx="136" cy="61" rx="35" ry="30" fill="#d9b18a"/><ellipse cx="136" cy="74" rx="17" ry="12" fill="#f5d8ae"/><circle cx="124" cy="58" r="3" fill="#544039"/><circle cx="150" cy="58" r="3" fill="#544039"/><path d="m132 68 5 5 5-5Z" fill="#544039"/><path d="m80 35 7 6m95 28 7-6m-15-37 4-7" stroke="#ffe6ac" stroke-width="3"/>',
      forest: '<path d="m30 100 40-82 40 82Zm45 0 51-105 51 105Zm62 0 42-81 42 81Z" fill="#264537"/><path d="m44 100 50-68 48 68Z" fill="#45634a"/><path d="m114 100 59-73 40 73Z" fill="#173c33"/><path d="M158 71h30v29h-30Z" fill="#b19969"/><path d="m151 73 22-21 22 21Z" fill="#c6b17d"/>',
      fishing: '<circle cx="173" cy="31" r="18" fill="#e3c897"/><path d="M0 79q43-8 82 0t78 0 80 0v21H0Z" fill="#8ab2ab"/><path d="m94 74 10 14h54l12-14Z" fill="#314f4d"/><path d="M122 74V55m-7 18 7-18 13 18m-12-17 38-18-7 38" stroke="#d0cfac" stroke-width="3"/><circle cx="124" cy="46" r="7" fill="#d0cfac"/>'
    };
    return `<div class="game-cover ${style.className}"><div class="cover-text"><span>${escape(style.english)}</span><small>${escape(style.subtitle)}</small></div><svg class="cover-art" viewBox="0 0 240 100" aria-hidden="true">${drawings[style.className] || drawings.peak}</svg><span class="cover-type">${icon(style.icon)} ${escape(style.type)}</span></div>`;
  }
  function isActive(quest) { return !['ended', 'cancelled'].includes(quest.status); }
  function actions(quest, user, full = false) {
    const joined = quest.members.some(member => member.id === user.id);
    const owner = quest.owner.id === user.id;
    let action;
    if (!isActive(quest)) action = `<button class="button closed-button" disabled>${quest.status === 'cancelled' ? '委托已取消' : '招募已结束'}</button>`;
    else if (joined) action = `<button class="button joined-button" data-action="leave" data-id="${escape(quest.id)}">${icon('check')}已报名 · 取消</button>`;
    else if (quest.status === 'full') action = '<button class="button closed-button" disabled>队伍已满员</button>';
    else action = `<button class="button join-button" data-action="join" data-id="${escape(quest.id)}">${icon('plus')}报名参加</button>`;
    if (!full) action = `<button class="text-button details-button" data-action="detail" data-id="${escape(quest.id)}">查看详情 ${icon('arrow')}</button>${action}`;
    if (full && owner && isActive(quest)) action += `<button class="button subtle" data-action="end" data-id="${escape(quest.id)}">结束招募</button><button class="button danger-outline" data-action="cancel" data-id="${escape(quest.id)}">取消委托</button>`;
    return action;
  }
  function card(quest, user) {
    const remaining = quest.capacity - quest.members.length;
    const joined = quest.members.some(member => member.id === user.id);
    return `<article class="quest-card ${isActive(quest) ? '' : 'inactive'}" data-quest="${escape(quest.id)}">
      ${cover(quest.game)}<div class="card-content"><div class="card-heading"><h3>${escape(quest.game)}</h3><span class="status-badge ${quest.status}"><i></i>${GuildData.STATUS_LABELS[quest.status]}</span></div>
      <div class="card-owner"><span class="tiny-avatar">${escape(quest.owner.nickname.slice(0, 1))}</span>${escape(quest.owner.nickname)}${quest.owner.id === user.id ? '<span class="owner-mark">我发布的</span>' : ''}${quest.isDemo ? '<span class="demo-tag">示例</span>' : ''}</div>
      <div class="card-schedule">${icon('clock')}<strong>${dateLabel(quest.date)} <span>${escape(quest.time)}</span></strong><span class="voice-info">${icon(quest.voice === 'none' ? 'mute' : 'mic')}${GuildData.VOICE_LABELS[quest.voice]}</span></div>
      <p class="card-note">${escape(quest.note || '冒险计划等你一起商量，欢迎加入！')}</p>
      <div class="capacity-heading"><span>${icon('users')}<strong>${quest.members.length}</strong> / ${quest.capacity} 人${joined ? '<b class="joined-mark">你在队伍中</b>' : ''}</span><span class="remaining ${remaining === 0 ? 'no-slots' : ''}">${isActive(quest) ? remaining ? `还差 <b>${remaining}</b> 位冒险者` : '全员集结' : '本次招募已截止'}</span></div>
      <div class="capacity-track" role="meter" aria-label="队伍人数" aria-valuemin="0" aria-valuemax="${quest.capacity}" aria-valuenow="${quest.members.length}"><span style="width:${quest.members.length / quest.capacity * 100}%"></span></div>
      <div class="card-actions">${actions(quest, user)}</div></div></article>`;
  }
  function detail(quest, user) {
    return `<div class="detail-cover">${cover(quest.game)}<button class="icon-button" data-dismiss aria-label="关闭委托详情">${icon('x')}</button></div><div class="detail-body"><div class="card-heading"><h2 id="detail-title">${escape(quest.game)}</h2><span class="status-badge ${quest.status}"><i></i>${GuildData.STATUS_LABELS[quest.status]}</span></div><p class="detail-owner">${escape(quest.owner.nickname)} 发布${quest.isDemo ? ' · 示例委托' : ''}</p><dl class="detail-facts"><div><dt>开黑时间 · 北京时间</dt><dd>${escape(quest.date)} ${escape(quest.time)}</dd></div><div><dt>语音要求</dt><dd>${GuildData.VOICE_LABELS[quest.voice]}</dd></div><div><dt>队伍人数</dt><dd>${quest.members.length} / ${quest.capacity} 人</dd></div><div><dt>剩余名额</dt><dd>${quest.capacity - quest.members.length} 位${isActive(quest) ? '' : '（报名已截止）'}</dd></div></dl><h3>委托说明</h3><p class="detail-note">${escape(quest.note || '发布者还没有填写备注，一起商量冒险计划吧。')}</p><h3>已集结的冒险者</h3><div class="member-list">${quest.members.length ? quest.members.map(member => `<span>${icon('users')}${escape(member.nickname)}${member.id === quest.owner.id ? '<small>队长</small>' : ''}${member.id === user.id ? '<small>我</small>' : ''}</span>`).join('') : '<p>队伍尚未有人报名，来当第一位冒险者吧。</p>'}</div><p class="field-tip">报名仅保存在此浏览器。请自行与队友确认集合方式；本页不会发送 QQ 通知。</p></div><div class="dialog-footer detail-actions">${actions(quest, user, true)}</div>`;
  }
  function filterQuests(quests, filters, user) {
    const keyword = filters.search.trim().toLocaleLowerCase();
    return quests.filter(quest => {
      if (filters.page === 'mine') {
        if (filters.mine === 'joined' && !quest.members.some(member => member.id === user.id)) return false;
        if (['published', 'manageable'].includes(filters.mine) && quest.owner.id !== user.id) return false;
        if (filters.mine === 'manageable' && !isActive(quest)) return false;
      }
      return (!keyword || quest.game.toLocaleLowerCase().includes(keyword))
        && (!filters.game || quest.game === filters.game)
        && (!filters.date || quest.date === filters.date)
        && (filters.status === 'all' || (filters.status === 'active' ? isActive(quest) : quest.status === filters.status))
        && (!filters.slots || (isActive(quest) && quest.members.length < quest.capacity));
    }).sort((first, second) => {
      if (filters.sort === 'newest') return Date.parse(second.createdAt) - Date.parse(first.createdAt);
      if (filters.sort === 'slots') return (second.capacity - second.members.length) - (first.capacity - first.members.length);
      return Number(!isActive(first)) - Number(!isActive(second)) || Date.parse(first.startAt) - Date.parse(second.startAt);
    });
  }
  const api = { escape, icon, hydrateIcons, dateLabel, isActive, card, detail, filterQuests };
  root.GuildUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
