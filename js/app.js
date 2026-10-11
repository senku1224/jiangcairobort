(async function () {
  'use strict';
  const UI = GuildUI;
  const select = selector => document.querySelector(selector);
  let service;
  let snapshot;
  let page = 'hall';
  let mine = 'joined';
  let detailId = null;
  let confirmation = null;
  let revision = 0;

  UI.hydrateIcons();
  const form = select('#create-form');
  const dialogs = [...document.querySelectorAll('dialog')];
  const filters = {
    search: select('#search'), game: select('#filter-game'), status: select('#filter-status'),
    date: select('#filter-date'), slots: select('#filter-slots'), sort: select('#sort')
  };

  function toast(message, error = false) {
    const container = select('#toast-container');
    container.innerHTML = `<div class="toast ${error ? 'error' : ''}">${UI.icon(error ? 'flask' : 'check')}<span>${UI.escape(message)}</span></div>`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { container.innerHTML = ''; }, 4500);
  }
  function showError(element, message) {
    element.textContent = message;
    element.hidden = !message;
  }
  function openDialog(element) {
    element.showModal();
    document.body.classList.add('modal-open');
  }
  dialogs.forEach(dialog => {
    dialog.addEventListener('close', () => {
      if (!dialogs.some(item => item.open)) document.body.classList.remove('modal-open');
      if (dialog.id === 'detail-dialog') detailId = null;
      if (dialog.id === 'confirm-dialog') confirmation = null;
    });
  });
  function closeDialogs() { dialogs.filter(dialog => dialog.open).forEach(dialog => dialog.close()); }

  function renderList() {
    if (!snapshot) return;
    const values = Object.fromEntries(Object.entries(filters).map(([key, element]) => [key, element.type === 'checkbox' ? element.checked : element.value]));
    const quests = UI.filterQuests(snapshot.quests, { ...values, page, mine }, snapshot.user);
    select('#result-count').innerHTML = `共 <strong>${quests.length}</strong> 份冒险委托${values.status === 'active' ? '<span> · 已隐藏结束与取消的委托</span>' : ''}`;
    select('#quest-list').innerHTML = quests.length ? quests.map(quest => UI.card(quest, snapshot.user)).join('')
      : `<div class="empty-state">${UI.icon('compass')}<h3>${page === 'mine' ? '你的冒险故事，等你开启' : '这一页还没有冒险委托'}</h3><p>试试调整筛选条件，或发起一场属于你的冒险。</p><div><button class="button subtle" data-action="reset-filters">清除筛选</button><button class="button primary" data-action="create">发布冒险委托</button></div></div>`;
    document.querySelectorAll('[data-mine]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mine === mine)));
  }

  function renderSummary() {
    const active = snapshot.quests.filter(UI.isActive);
    const recruiting = active.filter(quest => quest.members.length < quest.capacity).length;
    const soon = active.filter(quest => Date.parse(quest.startAt) - Date.now() <= 3600000).length;
    const available = active.reduce((sum, quest) => sum + quest.capacity - quest.members.length, 0);
    const joined = snapshot.quests.filter(quest => quest.members.some(member => member.id === snapshot.user.id));
    const published = snapshot.quests.filter(quest => quest.owner.id === snapshot.user.id);
    select('#stats-row').innerHTML = [
      ['scroll', recruiting, '正在招募', '下一场冒险，等你加入', 'sage'],
      ['clock', soon, '即将开始', '一小时内出发，准备集合', 'gold'],
      ['users', available, '空缺席位', '总有一个位置属于你', 'rust'],
      ['backpack', joined.filter(UI.isActive).length, '我的待赴冒险', '记得准时和队友碰头', 'blue']
    ].map(([icon, count, label, description, color]) => `<div class="stat-card"><span class="stat-icon ${color}">${UI.icon(icon)}</span><div><div class="stat-number">${count}<span>${label}</span></div><p>${description}</p></div></div>`).join('');
    select('#nav-count').textContent = active.length;
    select('#my-joined-count').textContent = joined.length;
    select('#my-published-count').textContent = published.length;
    document.querySelectorAll('.user-name').forEach(element => { element.textContent = snapshot.user.nickname; });
    document.querySelectorAll('.user-initial').forEach(element => { element.textContent = snapshot.user.nickname.slice(0, 1); });
    select('#clear-demo').disabled = !snapshot.quests.some(quest => quest.isDemo);
    select('#clear-demo').textContent = select('#clear-demo').disabled ? '示例委托已清除' : '清除示例委托';
  }

  async function refresh() {
    const ticket = ++revision;
    const fresh = await service.snapshot();
    if (ticket !== revision) return;
    snapshot = fresh;
    renderSummary();
    const renderKey = JSON.stringify(fresh) + GuildData.beijingParts().date;
    if (refresh.lastKey === renderKey) return;
    refresh.lastKey = renderKey;
    const game = filters.game.value;
    const games = [...new Set([...GuildData.PRESET_GAMES, ...snapshot.quests.map(quest => quest.game)])];
    filters.game.innerHTML = '<option value="">全部游戏</option>' + games.map(name => `<option value="${UI.escape(name)}">${UI.escape(name)}</option>`).join('');
    filters.game.value = games.includes(game) ? game : '';
    renderList();
    if (detailId && select('#detail-dialog').open) renderDetail(detailId);
  }

  function resetFilters() {
    filters.search.value = '';
    filters.game.value = '';
    filters.date.value = '';
    filters.status.value = page === 'mine' ? 'all' : 'active';
    filters.slots.checked = false;
    filters.sort.value = 'start';
    renderList();
  }

  function route() {
    const [target, subpage] = location.hash.slice(1).split('/');
    const previous = page;
    page = ['hall', 'quests', 'mine'].includes(target) ? target : 'hall';
    if (page === 'mine') mine = subpage === 'published' ? 'published' : 'joined';
    const titles = { hall: '公会大厅', quests: '委托看板', mine: '我的冒险' };
    select('#page-title').innerHTML = `${titles[page]}<span class="title-sparkle">✧</span>`;
    select('#breadcrumb-current').textContent = titles[page];
    select('#page-subtitle').textContent = {
      hall: '欢迎回来，冒险者。今天准备和谁一起拯救世界？',
      quests: '寻找游戏、挑选队伍，让下一场冒险不再孤单。',
      mine: '收藏每一场相遇，管理你的委托与报名。'
    }[page];
    select('#hall-hero').hidden = page !== 'hall';
    select('#stats-row').hidden = page === 'mine';
    select('#mine-tabs').hidden = page !== 'mine';
    select('#board-title').innerHTML = UI.icon(page === 'mine' ? 'backpack' : 'scroll') + (page === 'mine' ? '我的冒险记录' : '冒险委托看板');
    document.querySelectorAll('[data-page]').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
      if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = `${titles[page]} · 酱菜冒险者公会`;
    if (previous !== page) resetFilters();
    else renderList();
    if (previous !== page) window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function openCreate() {
    if (!snapshot) return;
    form.reset();
    const nextHour = GuildData.beijingParts(Date.now() + 3600000);
    form.elements.date.min = GuildData.beijingParts().date;
    form.elements.date.value = nextHour.date;
    form.elements.time.value = nextHour.time;
    form.elements.nickname.value = snapshot.user.nickname;
    showError(select('#create-error'), '');
    openDialog(select('#create-dialog'));
  }

  function renderDetail(questId) {
    const quest = snapshot.quests.find(item => item.id === questId);
    if (!quest) {
      select('#detail-dialog').close();
      toast('这份委托已经移除。');
      return false;
    }
    const focusedAction = select('#detail-dialog').contains(document.activeElement) ? document.activeElement.dataset.action : null;
    select('#detail-content').innerHTML = UI.detail(quest, snapshot.user);
    if (focusedAction) select(`#detail-content [data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
    return true;
  }
  function confirm(title, message, label, action) {
    select('#confirm-title').textContent = title;
    select('#confirm-message').textContent = message;
    select('#confirm-submit').textContent = label;
    showError(select('#confirm-error'), '');
    confirmation = action;
    openDialog(select('#confirm-dialog'));
  }

  async function perform(button, operation, message) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await operation();
      await refresh();
      toast(message);
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  }

  function showInfo(kind) {
    select('#info-title').textContent = kind === 'guide' ? '冒险者指南' : '关于酱菜公会';
    select('#info-content').innerHTML = kind === 'guide'
      ? '<div class="guide-step"><b>01</b><div><h3>挑一份心动的委托</h3><p>按游戏、日期、状态搜索，确认时间、语音要求与剩余名额。</p></div></div><div class="guide-step"><b>02</b><div><h3>报名，和队友准时碰头</h3><p>点击「报名参加」加入。行程改变时，可以在开场前取消报名；发布者同样可以退出自己的队伍。</p></div></div><div class="guide-step"><b>03</b><div><h3>没有合适的？自己发起！</h3><p>点击「发布冒险委托」，选择预设游戏或输入自定义游戏名。人数是队伍总人数，可选择是否占用一个名额。</p></div></div><div class="identity-note">开场前一小时显示「即将开始」；满员优先显示「已满员」；到开场时间自动结束招募。「已结束」仅表示招募截止，不代表游戏已经结束。</div><p>守时、友善、尊重队友。不会玩没关系，开心最重要。</p>'
      : '<h3>酱菜多人联机区的温暖据点</h3><p>这是为 QQ 群友准备的 Steam 开黑招募面板。公会精神很简单：游戏可以输，队友不能丢。</p><div class="identity-note"><strong>当前为本地演示</strong><p>身份和招募只保存在当前浏览器、当前站点。没有接入 QQ 登录、消息通知或共享数据库；同名昵称不等于同一个人。</p><p>清除浏览器数据、更换设备或更换打开地址后，原数据不会自动跟随。请使用页脚「导出数据」保留备份。</p></div><p>多人真实使用需要后端数据库与可靠身份认证。未来 QQ 机器人交互将依据实际接口权限实现。</p>';
    openDialog(select('#info-dialog'));
  }

  document.addEventListener('click', async event => {
    const dismiss = event.target.closest('[data-dismiss]');
    if (dismiss) { dismiss.closest('dialog').close(); return; }
    const tab = event.target.closest('[data-mine]');
    if (tab) { mine = tab.dataset.mine; renderList(); return; }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    const questId = button.dataset.id;
    if (action === 'create') openCreate();
    else if (action === 'reset-filters') resetFilters();
    else if (action === 'profile' && snapshot) {
      select('#profile-form').elements.nickname.value = snapshot.user.nickname;
      showError(select('#profile-error'), '');
      openDialog(select('#profile-dialog'));
    } else if (action === 'guide' || action === 'about') showInfo(action);
    else if (action === 'detail') {
      detailId = questId;
      if (renderDetail(questId)) openDialog(select('#detail-dialog'));
    } else if (action === 'join') {
      await perform(button, () => service.joinQuest(questId), '报名成功！记得准时赴约，冒险者。');
      if (!select('#detail-dialog').open) [...document.querySelectorAll('[data-action="leave"]')].find(element => element.dataset.id === questId)?.focus({ preventScroll: true });
    } else if (action === 'leave') confirm('确定取消这次报名？', '你的位置将重新开放给其他冒险者。委托仍开放且有空位时，可以重新报名。', '确认取消报名', async () => { await service.leaveQuest(questId); return '已取消报名，期待下次同行。'; });
    else if (action === 'end' || action === 'cancel') confirm(action === 'end' ? '确定结束招募？' : '确定取消这份委托？', '确认后将停止接受报名并保留记录。此操作不能撤回，也不会向 QQ 群发送消息。', action === 'end' ? '确认结束' : '确认取消委托', async () => { await service.finishQuest(questId, action === 'end' ? 'ended' : 'cancelled'); return action === 'end' ? '招募已结束。' : '委托已取消。'; });
    else if (action === 'clear-demo') confirm('清除所有示例委托？', '示例委托及其报名记录会被移除，你自己发布的委托会保留。清除后不会自动重新生成。', '清除示例', async () => { await service.clearDemo(); return '示例已清除，公告板留给你的真实计划。'; });
    else if (action === 'export') await perform(button, async () => {
      const blob = new Blob([await service.exportData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `酱菜公会备份-${GuildData.beijingParts().date}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, '已生成本地数据备份。');
  });

  select('#confirm-submit').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (!confirmation || button.disabled) return;
    const operation = confirmation;
    button.disabled = true;
    try {
      const message = await operation();
      select('#confirm-dialog').close();
      await refresh();
      toast(message);
    } catch (error) { showError(select('#confirm-error'), error.message); }
    finally { button.disabled = false; }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    if (!form.checkValidity()) {
      showError(select('#create-error'), '请完整填写必填项，并检查人数、日期与文字长度。');
      form.reportValidity();
      return;
    }
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      values.includeCreator = form.elements.includeCreator.checked;
      await service.createQuest(values);
      closeDialogs();
      location.hash = 'quests';
      page = 'quests';
      route();
      resetFilters();
      filters.sort.value = 'newest';
      await refresh();
      renderList();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('委托已贴上公告板，等待队友集结！');
    } catch (error) { showError(select('#create-error'), error.message); }
    finally { button.disabled = false; }
  });

  select('#profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    const profileForm = event.currentTarget;
    const button = profileForm.querySelector('[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      await service.updateNickname(profileForm.elements.nickname.value);
      select('#profile-dialog').close();
      await refresh();
      toast('名片已更新，冒险记录会一直跟随你。');
    } catch (error) { showError(select('#profile-error'), error.message); }
    finally { button.disabled = false; }
  });

  Object.values(filters).forEach(element => element.addEventListener(element.type === 'search' ? 'input' : 'change', renderList));
  select('#clear-filters').addEventListener('click', resetFilters);
  select('#preset-games').innerHTML = GuildData.PRESET_GAMES.map(game => `<option value="${UI.escape(game)}"></option>`).join('');
  window.addEventListener('hashchange', route);
  window.addEventListener('storage', event => {
    if (event.key === GuildData.STORAGE_KEY || event.key === null) refresh().catch(error => toast(error.message, true));
  });

  try {
    service = GuildData.createService(window.localStorage);
    await service.init();
    await refresh();
    route();
    setInterval(() => {
      if (!document.hidden) refresh().catch(error => toast(error.message, true));
    }, 15000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh().catch(error => toast(error.message, true));
    });
  } catch (error) {
    showError(select('#fatal-error'), `${error.message} 请修复后刷新页面。`);
    document.querySelectorAll('[data-action="create"], [data-action="profile"], [data-action="clear-demo"], [data-action="export"]').forEach(button => { button.disabled = true; });
    select('#result-count').textContent = '公会数据暂时无法载入';
  }
})();
