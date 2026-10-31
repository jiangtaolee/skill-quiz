/* 技能鉴定刷题 — 应用逻辑（原生 JS，无依赖）
 * 依赖：globalThis.QUESTION_BANK / globalThis.SRS / globalThis.Store
 * 视图：today | bank | wrong | stats | settings | quiz | result
 */
(function () {
  'use strict';

  var BANK = globalThis.QUESTION_BANK;
  var SRS = globalThis.SRS;
  var Store = globalThis.Store;

  var AppEl = document.getElementById('app');
  var TabBarEl = document.getElementById('tabbar');
  var ToastEl = document.getElementById('toast');
  var ModalRoot = document.getElementById('modal-root');

  if (!BANK || !SRS || !Store) {
    AppEl.innerHTML =
      '<div class="screen"><div class="scroll"><div class="empty">' +
      '<div class="empty-title">加载失败</div>' +
      '<div class="empty-desc">题库或算法模块未加载，请刷新页面重试。</div>' +
      '</div></div></div>';
    return;
  }

  var QS = BANK.questions || [];
  var BY_ID = {};
  for (var i = 0; i < QS.length; i++) BY_ID[QS[i].id] = QS[i];
  var TOTAL = QS.length;

  /* ------------------------------------------------------------------ */
  /* 图标                                                                */
  /* ------------------------------------------------------------------ */
  var I = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="m9 15 2 2 4-4"/></svg>',
    bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v16H6.5A2.5 2.5 0 0 0 4 22V6.5Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19"/><path d="M8.5 8.5h7M8.5 12h5"/></svg>',
    wrong: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v17l-7.5-4.2L4 21V5.5Z"/><path d="m9.5 9 5 5M14.5 9l-5 5"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.6 2.6 5.28 5.83.85-4.22 4.11.997 5.8L12 16.9l-5.21 2.74L7.79 13.84 3.57 9.73l5.83-.85L12 3.6Z"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m12 3.6 2.6 5.28 5.83.85-4.22 4.11.997 5.8L12 16.9l-5.21 2.74L7.79 13.84 3.57 9.73l5.83-.85L12 3.6Z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 5-7 7 7 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h3.5c1.6 0 3.1.8 4 2.1l4 6.3c.9 1.3 2.4 2.1 4 2.1H21"/><path d="M21 18h-2.5c-1.6 0-3.1-.8-4-2.1l-1-1.6"/><path d="M21 6h-2.5c-1.6 0-3.1.8-4 2.1l-1 1.6"/><path d="m18 3 3 3-3 3M18 15l3 3-3 3M3 18h3.5c1.6 0 3.1-.8 4-2.1"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 0 4 21.5v-16ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 1 1.5 1.5v-16Z"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M4 20h16"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 20h16"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4.5V11h-6.5"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/></svg>'
  };

  /* ------------------------------------------------------------------ */
  /* 工具                                                                */
  /* ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function weekdayText(ts) {
    return '日一二三四五六'.charAt(new Date(ts).getDay());
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return fmtDate(ts) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fmtDuration(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' 秒';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' 分 ' + (s % 60) + ' 秒';
    return Math.floor(m / 60) + ' 时 ' + (m % 60) + ' 分';
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function safe(fn, dflt) {
    try { var v = fn(); return v == null ? dflt : v; } catch (e) { return dflt; }
  }
  function greet() {
    var h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }
  function toast(msg) {
    ToastEl.textContent = msg;
    ToastEl.classList.toggle('at-top', !!document.querySelector('.modal-mask'));
    ToastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { ToastEl.classList.remove('show'); }, 1900);
  }
  var TYPE_LABEL = {
    daily: '今日计划', wrong: '错题重练', fav: '收藏练习',
    random: '随机练习', one: '单题练习', bank: '题库练习', category: '知识点练习'
  };
  var MASTERY_RANK = { 'new': 0, learning: 1, consolidating: 2, mastered: 3 };

  function masteryOf(qid) {
    var card = safe(function () { return Store.card(qid); }, null);
    return safe(function () { return SRS.masteryOf(card); }, { key: 'new', label: '未学', pct: 0 });
  }
  function fav(qid) { return !!safe(function () { return Store.isFav(qid); }, false); }
  function settings() {
    return safe(function () { return Store.settings(); }, { newPerDay: 20, reviewLimit: 60, showAlgoHint: true });
  }

  /* ------------------------------------------------------------------ */
  /* 数据/计划                                                           */
  /* ------------------------------------------------------------------ */
  function allCards() {
    var st = safe(function () { return Store.get(); }, {});
    return (st && st.cards) || {};
  }

  function dailyPlan(now) {
    var cards = allCards();
    var s = settings();
    var due = [], fresh = [];
    for (var i = 0; i < QS.length; i++) {
      var q = QS[i];
      var c = cards[q.id];
      if (!c) fresh.push(q.id);
      else if (c.due && c.due <= now) due.push(q.id);
    }
    due.sort(function (a, b) { return (cards[a].due || 0) - (cards[b].due || 0); });
    var reviewLimit = s.reviewLimit || 60;
    var newPerDay = s.newPerDay || 20;
    var duePick = due.slice(0, reviewLimit);
    var freshPick = fresh.slice(0, newPerDay);
    return {
      due: duePick, fresh: freshPick,
      dueTotal: due.length, freshTotal: fresh.length,
      total: duePick.length + freshPick.length
    };
  }

  function wrongList() {
    var cards = allCards();
    var out = [];
    for (var i = 0; i < QS.length; i++) {
      var c = cards[QS[i].id];
      if (c && (c.lapses || 0) > 0) out.push(QS[i]);
    }
    out.sort(function (a, b) {
      var ca = cards[a.id], cb = cards[b.id];
      return ((cb.lapses || 0) - (ca.lapses || 0)) || ((cb.last || 0) - (ca.last || 0));
    });
    return out;
  }

  function favList() {
    var ids = safe(function () { return Store.favs(); }, []) || [];
    return ids.filter(function (id) { return !!BY_ID[id]; });
  }

  function randomIds(n) {
    var cards = allCards();
    var unseen = [], seen = [];
    for (var i = 0; i < QS.length; i++) {
      (cards[QS[i].id] ? seen : unseen).push(QS[i].id);
    }
    shuffle(unseen); shuffle(seen);
    return unseen.concat(seen).slice(0, n);
  }

  function getStats(now) {
    var stt = safe(function () { return Store.stats(now); }, null);
    if (!stt) return null;
    stt.daily = stt.daily || [];
    stt.categories = stt.categories || [];
    stt.sessions = stt.sessions || [];
    stt.levelDist = stt.levelDist || [];
    return stt;
  }

  /* ------------------------------------------------------------------ */
  /* 状态                                                               */
  /* ------------------------------------------------------------------ */
  var State = {
    view: 'today',
    tab: 'today',
    settingsFrom: 'today',
    session: null,
    result: null,
    bank: { q: '', type: 'all', cat: 'all', expanded: null, limit: 60 },
    wrongTab: 'wrong',
    expandedWrong: null
  };

  /* ------------------------------------------------------------------ */
  /* 导航                                                               */
  /* ------------------------------------------------------------------ */
  var TAB_VIEWS = { today: 1, bank: 1, wrong: 1, stats: 1, settings: 1 };

  function navTab(name) {
    State.tab = name;
    State.view = name;
    State.session = null;
    State.result = null;
    State.expandedWrong = null;
    render();
  }
  function openSettings() {
    State.settingsFrom = State.tab;
    State.view = 'settings';
    render();
  }
  function goBack() {
    if (State.view === 'settings') {
      State.view = State.settingsFrom || 'today';
      State.tab = State.view;
      render();
    }
  }

  function startSession(type, ids, title) {
    if (!ids || !ids.length) { toast('暂无可用题目'); return; }
    var now = Date.now();
    State.session = {
      type: type,
      title: title || TYPE_LABEL[type] || '练习',
      ids: ids.slice(),
      queue: ids.slice(),
      pos: 0,
      answers: [],
      retried: {},
      startedAt: now,
      questionStart: now,
      current: null
    };
    State.returnView = State.tab || 'today';
    State.view = 'quiz';
    render();
  }

  function startDaily() {
    var plan = dailyPlan(Date.now());
    var ids = plan.due.concat(plan.fresh);
    if (!ids.length) { startRandom(); return; }
    startSession('daily', ids, '今日计划');
  }
  function startRandom() {
    startSession('random', randomIds(20), '随机练习');
  }
  function startWrong() {
    var ids = wrongList().map(function (q) { return q.id; });
    if (!ids.length) { toast('还没有错题，继续保持'); return; }
    startSession('wrong', ids.slice(0, 50), '错题重练');
  }
  function startFav() {
    var ids = favList();
    if (!ids.length) { toast('还没有收藏题目'); return; }
    startSession('fav', ids, '收藏练习');
  }

  /* ------------------------------------------------------------------ */
  /* 答题                                                               */
  /* ------------------------------------------------------------------ */
  function answer(key) {
    var s = State.session;
    if (!s || s.current) return;
    var q = BY_ID[s.queue[s.pos]];
    if (!q) return;
    var correct = key === q.answer;
    var now = Date.now();
    var res = safe(function () { return Store.record(q.id, correct, now); }, null);
    var card = res && res.card ? res.card : safe(function () { return Store.card(q.id); }, null);
    var before = res && res.before ? res.before : null;
    s.answers.push({
      qid: q.id, selected: key, correct: correct, at: now,
      ms: Math.max(0, now - s.questionStart),
      levelBefore: before ? before.level : 0,
      levelAfter: card ? card.level : 0
    });
    s.current = { key: key, correct: correct, card: card, before: before };
    if (!correct && !s.retried[q.id]) {
      s.retried[q.id] = 1;
      s.queue.push(q.id);
    }
    renderQuizPreserveScroll();
  }

  function nextQuestion() {
    var s = State.session;
    if (!s || !s.current) return;
    s.pos += 1;
    s.current = null;
    s.questionStart = Date.now();
    if (s.pos >= s.queue.length) { finishSession(); return; }
    render();
    var body = document.querySelector('.quiz-body');
    if (body) body.scrollTop = 0;
  }

  function finishSession() {
    var s = State.session;
    if (!s) return;
    var total = s.answers.length;
    var correct = s.answers.filter(function (a) { return a.correct; }).length;
    var duration = Date.now() - s.startedAt;
    safe(function () {
      Store.addSession({ type: s.type, total: total, correct: correct, durationMs: duration, at: Date.now() });
    }, null);

    var wrongMap = {};
    for (var i = 0; i < s.answers.length; i++) {
      var a = s.answers[i];
      if (!a.correct) wrongMap[a.qid] = a;
    }
    var improved = 0;
    for (var j = 0; j < s.answers.length; j++) {
      if (s.answers[j].levelAfter > s.answers[j].levelBefore) improved++;
    }
    State.result = {
      type: s.type, title: s.title, ids: s.ids,
      total: total, correct: correct, wrong: total - correct,
      accuracy: total ? Math.round((correct / total) * 100) : 0,
      duration: duration,
      wrongList: Object.keys(wrongMap).map(function (id) { return wrongMap[id]; }),
      improved: improved,
      at: Date.now()
    };
    State.session = null;
    State.view = 'result';
    render();
    window.scrollTo(0, 0);
  }

  function quitQuiz(confirm) {
    if (!State.session) { goBack(); return; }
    if (confirm) {
      State.session = null;
      State.view = State.returnView || 'today';
      State.tab = State.view;
      closeModal();
      toast('已结束本次练习，答题记录已保存');
      render();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 渲染入口                                                            */
  /* ------------------------------------------------------------------ */
  function render() {
    renderTabBar();
    if (State.view === 'quiz') return renderQuiz();
    if (State.view === 'result') return renderResult();
    if (State.view === 'bank') return renderBank();
    if (State.view === 'wrong') return renderWrong();
    if (State.view === 'stats') return renderStats();
    if (State.view === 'settings') return renderSettings();
    return renderToday();
  }

  function renderTabBar() {
    var tabs = [
      { k: 'today', label: '今日', icon: I.today },
      { k: 'bank', label: '题库', icon: I.bank },
      { k: 'wrong', label: '错题', icon: I.wrong },
      { k: 'stats', label: '统计', icon: I.stats }
    ];
    var html = '';
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      html += '<button class="tab ' + (State.tab === t.k ? 'on' : '') + '" data-action="tab" data-tab="' + t.k + '">' +
        t.icon + '<span>' + t.label + '</span></button>';
    }
    TabBarEl.innerHTML = html;
    TabBarEl.hidden = !TAB_VIEWS[State.view];
  }

  /* ------------------------------------------------------------------ */
  /* 今日                                                                */
  /* ------------------------------------------------------------------ */
  function renderToday() {
    var now = Date.now();
    var plan = dailyPlan(now);
    var stt = getStats(now) || {};
    var cards = allCards();
    var mastered = stt.masteredCount || 0;
    var answered = stt.answered || 0;
    var masteryPct = pct(mastered, TOTAL);
    var todayData = stt.today || { answered: 0, correct: 0, newLearned: 0 };
    var todayAcc = todayData.answered ? Math.round((todayData.correct / todayData.answered) * 100) : 0;
    var wrongCount = wrongList().length;
    var favCount = favList().length;
    var streak = stt.streak || 0;

    var html = '';
    html += '<div class="screen"><div class="scroll">';
    html += '<header class="page-head"><div class="grow">' +
      '<div class="page-date">' + fmtDate(now) + ' 星期' + weekdayText(now) + '</div>' +
      '<h1 class="page-title">' + greet() + '，开始刷题吧</h1>' +
      '<p class="page-desc">技能鉴定初级题库 · 共 ' + TOTAL + ' 题</p>' +
      '</div><button class="icon-btn" data-action="settings" aria-label="设置">' + I.gear + '</button></header>';

    // Hero
    var btnLabel = plan.total > 0 ? ('开始学习 · ' + plan.total + ' 题') : '随机练 20 题';
    var btnAction = plan.total > 0 ? 'start-daily' : 'start-random';
    html += '<section class="card hero">' +
      '<div class="hero-row">' +
      '<div class="hero-main">' +
      '<div class="hero-label">今日待学习</div>' +
      '<div class="hero-num">' + (plan.total > 0 ? plan.total : '✓') + (plan.total > 0 ? '<small>题</small>' : '') + '</div>' +
      '<div class="hero-sub">' +
      (plan.total > 0
        ? ('复习 ' + plan.due.length + ' 题 · 新题 ' + plan.fresh.length + ' 题 · 约 ' + Math.max(1, Math.round(plan.total * 0.5)) + ' 分钟')
        : '今日任务已完成，可随机巩固') +
      '</div></div>' +
      '<div class="ring" style="--p:' + masteryPct + '"><div class="ring-inner"><b>' + masteryPct + '%</b><span>掌握率</span></div></div>' +
      '</div>' +
      '<button class="btn btn-block btn-white" data-action="' + btnAction + '">' + btnLabel + '</button>' +
      '<div class="hero-meta"><span>已掌握 ' + mastered + '/' + TOTAL + '</span><span>连续学习 ' + streak + ' 天</span><span>累计作答 ' + answered + ' 题</span></div>' +
      '</section>';

    // 今日概览
    html += '<section class="card mt14">' +
      '<div class="row mb8"><div class="grow"><div class="card-title">今日概览</div>' +
      '<div class="card-sub">' + (todayData.answered ? '继续保持这个节奏' : '今天还没有开始，先来一组吧') + '</div></div>' +
      '</div>' +
      '<div class="today-grid">' +
      '<div class="today-cell"><b>' + (todayData.answered || 0) + '</b><span>已作答</span></div>' +
      '<div class="today-cell"><b class="' + (todayData.answered ? (todayAcc >= 60 ? 'pos' : 'neg') : '') + '">' +
      (todayData.answered ? todayAcc + '%' : '—') + '</b><span>今日正确率</span></div>' +
      '<div class="today-cell"><b>' + (todayData.newLearned || 0) + '</b><span>今日新学</span></div>' +
      '</div></section>';

    // 快捷入口
    html += '<section class="section"><div class="section-head"><h2>快捷入口</h2></div>' +
      '<div class="quick-grid">' +
      '<button class="quick" data-action="start-wrong">' +
      '<div class="quick-ico red">' + I.wrong + '</div>' +
      '<div class="quick-txt"><div class="quick-name">错题重练</div><div class="quick-sub">' + (wrongCount ? wrongCount + ' 道错题待巩固' : '暂无错题') + '</div></div></button>' +
      '<button class="quick" data-action="start-fav">' +
      '<div class="quick-ico amber">' + I.star + '</div>' +
      '<div class="quick-txt"><div class="quick-name">收藏练习</div><div class="quick-sub">' + (favCount ? favCount + ' 道已收藏' : '还没有收藏') + '</div></div></button>' +
      '<button class="quick" data-action="start-random">' +
      '<div class="quick-ico">' + I.shuffle + '</div>' +
      '<div class="quick-txt"><div class="quick-name">随机练习</div><div class="quick-sub">随机 20 道题</div></div></button>' +
      '<button class="quick" data-action="tab" data-tab="bank">' +
      '<div class="quick-ico green">' + I.bank + '</div>' +
      '<div class="quick-txt"><div class="quick-name">全部题库</div><div class="quick-sub">检索 / 背题模式</div></div></button>' +
      '</div></section>';

    // 间隔重复说明
    html += '<section class="card section">' +
      '<div class="row"><div class="quick-ico">' + I.spark + '</div>' +
      '<div class="grow"><div class="card-title">艾宾浩斯复习节奏</div>' +
      '<p class="card-sub">答对后间隔按 10分钟 → 1小时 → 1天 → 2天 → 4天 → 7天 → 15天 → 30天 → 60天 … 递增；答错自动降档，安排重练。</p>' +
      '</div></div>' +
      '<div class="row mt14" style="gap:8px;flex-wrap:wrap">' +
      '<span class="tag gray">今日到期 ' + plan.dueTotal + ' 题</span>' +
      '<span class="tag gray">尚未学习 ' + plan.freshTotal + ' 题</span>' +
      '<span class="tag gray">已掌握 ' + mastered + ' 题</span>' +
      '</div></section>';

    html += '</div></div>';
    AppEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* 答题页                                                              */
  /* ------------------------------------------------------------------ */
  function stemHtml(text) {
    return esc(text).replace(/[（(]\s*[)）]/g, '<span class="blank"></span>');
  }

  function renderQuizPreserveScroll() {
    var body = document.querySelector('.quiz-body');
    var top = body ? body.scrollTop : 0;
    render();
    var body2 = document.querySelector('.quiz-body');
    if (body2) body2.scrollTop = top;
  }

  function renderQuiz() {
    var s = State.session;
    if (!s) { navTab('today'); return; }
    var qid = s.queue[s.pos];
    var q = BY_ID[qid];
    if (!q) { navTab('today'); return; }
    var ans = s.current;
    var card = (ans && ans.card) || safe(function () { return Store.card(qid); }, null);
    var isFav = fav(qid);
    var answeredCount = s.answers.length;
    var correctCount = s.answers.filter(function (a) { return a.correct; }).length;
    var acc = answeredCount ? Math.round((correctCount / answeredCount) * 100) : null;
    var progress = Math.round(((s.pos + (ans ? 1 : 0)) / s.queue.length) * 100);
    var isLast = s.pos === s.queue.length - 1;

    var html = '<div class="quiz">';
    // 头部
    html += '<div class="quiz-head">' +
      '<button class="icon-btn plain" data-action="quit-quiz" aria-label="退出">' + I.close + '</button>' +
      '<div class="quiz-progress"><div class="bar"><i style="width:' + progress + '%"></i></div>' +
      '<span class="quiz-count">' + (s.pos + 1) + '/' + s.queue.length + '</span>' +
      (acc !== null ? '<span class="quiz-acc">' + acc + '%</span>' : '') +
      '</div>' +
      '<button class="icon-btn plain ' + (isFav ? 'on' : '') + '" data-action="fav" aria-label="收藏">' +
      (isFav ? I.starFill : I.star) + '</button>' +
      '</div>';

    // 题目
    html += '<div class="quiz-body">' +
      '<div class="quiz-meta">' +
      '<span class="tag ' + (q.type === 'judge' ? 'judge' : '') + '">' + (q.type === 'judge' ? '判断题' : '单选题') + '</span>' +
      '<span class="tag gray">' + esc(q.category || '未分类') + '</span>' +
      '<span class="quiz-no">第 ' + (q.no || qid) + ' 题</span>' +
      (card ? '<span class="mastery ' + (SRS.masteryOf(card).key) + '">' + SRS.masteryOf(card).label + '</span>' : '<span class="mastery new">未学</span>') +
      '</div>' +
      '<p class="stem">' + stemHtml(q.stem) + '</p>' +
      '<div class="opts">';

    for (var i = 0; i < q.options.length; i++) {
      var o = q.options[i];
      var cls = 'opt' + (q.type === 'judge' ? ' judge' : '');
      var flag = '';
      if (ans) {
        if (o.key === q.answer) { cls += ' correct'; flag = I.check; }
        else if (o.key === ans.key) { cls += ' wrong'; flag = I.x; }
        else cls += ' dim';
      }
      html += '<button class="' + cls + '" data-action="answer" data-key="' + o.key + '"' +
        (ans ? ' disabled' : '') + '>' +
        '<span class="opt-key">' + o.key + '</span>' +
        '<span class="opt-text">' + esc(o.text) + '</span>' +
        (flag ? '<span class="opt-flag">' + flag + '</span>' : '') +
        '</button>';
    }
    html += '</div></div>';

    // 底部
    html += '<div class="quiz-foot">';
    if (ans) {
      var okCls = ans.correct ? 'ok' : 'bad';
      var fbTitle = ans.correct ? '回答正确' : '回答错误';
      var showHint = settings().showAlgoHint !== false;
      var nextText = (showHint && card) ? safe(function () { return SRS.nextReviewText(card, Date.now()); }, '') : '';
      var fbSub = '';
      if (ans.correct) {
        fbSub = '正确答案：' + q.answer +
          (nextText ? ' · 下次复习：' + esc(nextText) : '') +
          (ans.before && card && SRS.masteryOf(card).key !== SRS.masteryOf(ans.before).key
            ? ' · 掌握度提升至「' + SRS.masteryOf(card).label + '」' : '');
      } else {
        var rightText = '';
        for (var k = 0; k < q.options.length; k++) {
          if (q.options[k].key === q.answer) rightText = q.options[k].text;
        }
        fbSub = '正确答案：' + q.answer + ' ' + esc(rightText) +
          (s.retried[qid] && ans.before ? ' · 本题将稍后重练' : '');
      }
      html += '<div class="feedback ' + okCls + '">' +
        '<span class="fb-ico">' + (ans.correct ? I.check : I.x) + '</span>' +
        '<div class="fb-body"><div class="fb-title">' + fbTitle + '</div>' +
        '<div class="fb-sub">' + fbSub + '</div></div></div>' +
        '<button class="btn btn-primary btn-block" data-action="next">' + (isLast ? '查看结果' : '下一题') + '</button>';
    } else {
      html += '<div class="quiz-hint">' + (q.type === 'judge' ? '判断对错后自动判分' : '选择答案后自动判分') + '</div>';
    }
    html += '</div>';

    html += '</div>';
    AppEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* 结算页                                                              */
  /* ------------------------------------------------------------------ */
  function renderResult() {
    var r = State.result;
    if (!r) { navTab('today'); return; }
    var emoji = r.accuracy >= 90 ? '🎉' : r.accuracy >= 70 ? '👍' : r.accuracy >= 50 ? '💪' : '📚';
    var title = r.accuracy >= 90 ? '太棒了，接近满分！' : r.accuracy >= 70 ? '表现不错，继续加油' : r.accuracy >= 50 ? '基础还行，错题再练练' : '别灰心，重点看错题';
    var html = '<div class="result"><div class="scroll">';
    html += '<div class="result-hero">' +
      '<div class="score-ring" style="--p:' + r.accuracy + '">' +
      '<div class="score-ring-inner"><b>' + r.accuracy + '%</b><span>正确率</span></div></div>' +
      '<div class="result-title">' + emoji + ' ' + title + '</div>' +
      '<div class="result-desc">' + TYPE_LABEL[r.type] + ' · 用时 ' + fmtDuration(r.duration) + '</div>' +
      '</div>';
    html += '<div class="result-stats">' +
      '<div class="rs-cell"><b>' + r.correct + '</b><span>答对</span></div>' +
      '<div class="rs-cell"><b style="color:var(--red)">' + r.wrong + '</b><span>答错</span></div>' +
      '<div class="rs-cell"><b>' + r.improved + '</b><span>掌握度提升</span></div>' +
      '</div>';

    html += '<div class="result-actions">' +
      '<button class="btn btn-primary btn-block" data-action="result-home">返回首页</button>';
    if (r.wrongList.length) {
      html += '<button class="btn btn-soft btn-block" data-action="result-wrong-again">错题再练（' + r.wrongList.length + ' 题）</button>';
    }
    html += '<button class="btn btn-ghost btn-block" data-action="result-again">再来一组</button>' +
      '</div>';

    if (r.wrongList.length) {
      html += '<div class="section"><div class="section-head"><h2>本次错题</h2>' +
        '<span class="muted" style="font-size:12.5px">共 ' + r.wrongList.length + ' 题</span></div>' +
        '<div class="review-list">';
      for (var i = 0; i < r.wrongList.length; i++) {
        var a = r.wrongList[i];
        var q = BY_ID[a.qid];
        if (!q) continue;
        var yours = '', right = '';
        for (var k = 0; k < q.options.length; k++) {
          if (q.options[k].key === a.selected) yours = q.options[k].text;
          if (q.options[k].key === q.answer) right = q.options[k].text;
        }
        html += '<div class="review-item">' +
          '<div class="review-stem">' + esc(q.stem) + '</div>' +
          '<div class="review-meta">' +
          '<span class="yours">你选 ' + a.selected + ' · ' + esc(yours) + '</span>' +
          '<span class="right">正确 ' + q.answer + ' · ' + esc(right) + '</span>' +
          '</div></div>';
      }
      html += '</div></div>';
    }
    html += '</div></div>';
    AppEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* 题库                                                                */
  /* ------------------------------------------------------------------ */
  function filteredBank() {
    var kw = State.bank.q.trim().toLowerCase();
    var type = State.bank.type;
    var cat = State.bank.cat;
    var out = [];
    for (var i = 0; i < QS.length; i++) {
      var q = QS[i];
      if (type !== 'all' && q.type !== type) continue;
      if (cat !== 'all' && q.category !== cat) continue;
      if (kw) {
        var hay = q.stem + ' ' + q.options.map(function (o) { return o.text; }).join(' ');
        if (hay.toLowerCase().indexOf(kw) < 0) continue;
      }
      out.push(q);
    }
    return out;
  }

  function categoryNames() {
    var names = []; var seen = {};
    for (var i = 0; i < QS.length; i++) {
      var c = QS[i].category || '其他';
      if (!seen[c]) { seen[c] = 1; names.push(c); }
    }
    return names;
  }

  function rowHtml(q, expanded, now) {
    var m = masteryOf(q.id);
    var card = safe(function () { return Store.card(q.id); }, null);
    var isFav = fav(q.id);
    var html = '<div class="q-row ' + (expanded ? 'open' : '') + '" data-action="bank-row" data-id="' + q.id + '">' +
      '<div class="q-row-main">' +
      '<span class="q-no">' + (q.no || q.id) + '</span>' +
      '<span class="q-stem">' + esc(q.stem) + '</span>' +
      (isFav ? '<span class="opt-flag" style="color:var(--amber);width:15px;height:15px">' + I.starFill + '</span>' : '') +
      '<span class="mastery ' + m.key + '">' + m.label + '</span>' +
      '</div>';
    if (expanded) {
      html += '<div class="q-detail">' +
        '<div class="q-detail-head"><div class="row" style="gap:6px">' +
        '<span class="tag ' + (q.type === 'judge' ? 'judge' : '') + '">' + (q.type === 'judge' ? '判断题' : '单选题') + '</span>' +
        '<span class="tag gray">' + esc(q.category || '未分类') + '</span></div>' +
        '<span class="muted" style="font-size:11.5px">答案 ' + q.answer + '</span></div>';
      for (var i = 0; i < q.options.length; i++) {
        var o = q.options[i];
        html += '<div class="opt-mini ' + (o.key === q.answer ? 'correct' : '') + '"><b>' + o.key + '</b><span>' + esc(o.text) + '</span></div>';
      }
      html += '<div class="stat-note">' +
        (card
          ? ('掌握度：' + m.label + '（' + m.pct + '%） · 下次复习：' + esc(safe(function () { return SRS.nextReviewText(card, now); }, '—')) +
            ' · 答对 ' + (card.reps || 0) + ' 次 / 答错 ' + (card.lapses || 0) + ' 次')
          : '尚未学习，加入今日计划后按艾宾浩斯曲线复习') +
        '</div>' +
        '<div class="q-detail-actions">' +
        '<button class="btn btn-soft btn-sm" data-action="practice-one" data-id="' + q.id + '">练习本题</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="fav-q" data-id="' + q.id + '">' + (isFav ? '取消收藏' : '收藏') + '</button>' +
        '</div></div>';
    }
    html += '</div>';
    return html;
  }

  function renderBankList() {
    var el = document.getElementById('bank-list');
    if (!el) return;
    var now = Date.now();
    var items = filteredBank();
    var shown = items.slice(0, State.bank.limit);
    if (!items.length) {
      el.innerHTML = '<div class="empty">' + I.search +
        '<div class="empty-title">没有找到题目</div><div class="empty-desc">换个关键词或筛选条件试试</div></div>';
    } else {
      var h = '';
      for (var i = 0; i < shown.length; i++) {
        h += rowHtml(shown[i], State.bank.expanded === shown[i].id, now);
      }
      if (items.length > shown.length) {
        h += '<button class="btn btn-ghost btn-block mt10" data-action="bank-more">加载更多（剩余 ' +
          (items.length - shown.length) + ' 题）</button>';
      }
      el.innerHTML = h;
    }
    var cnt = document.getElementById('bank-count');
    if (cnt) cnt.textContent = items.length + ' 题';
  }

  function renderBank() {
    var now = Date.now();
    var stt = getStats(now) || {};
    var cats = categoryNames();
    var html = '<div class="screen"><div class="scroll">';
    html += '<header class="page-head"><div class="grow">' +
      '<div class="page-date">题库</div>' +
      '<h1 class="page-title">全部题目</h1>' +
      '<p class="page-desc"><span id="bank-count">' + TOTAL + ' 题</span> · 已作答 ' + (stt.answered || 0) + ' 题</p>' +
      '</div><button class="icon-btn" data-action="settings" aria-label="设置">' + I.gear + '</button></header>';

    html += '<div class="search-box">' + I.search +
      '<input id="bank-search" class="search-input" type="search" placeholder="搜索题干或选项关键词" ' +
      'value="' + esc(State.bank.q) + '" enterkeyhint="search" autocomplete="off"></div>';

    html += '<div class="chip-row">';
    html += '<button class="chip ' + (State.bank.type === 'all' ? 'on' : '') + '" data-action="bank-type" data-type="all">全部</button>';
    html += '<button class="chip ' + (State.bank.type === 'single' ? 'on' : '') + '" data-action="bank-type" data-type="single">单选 ' + BANK.meta.singleCount + '</button>';
    html += '<button class="chip ' + (State.bank.type === 'judge' ? 'on' : '') + '" data-action="bank-type" data-type="judge">判断 ' + BANK.meta.judgeCount + '</button>';
    html += '</div>';

    html += '<div class="row mb8"><div class="grow"></div><select id="bank-cat" class="filter-select">' +
      '<option value="all"' + (State.bank.cat === 'all' ? ' selected' : '') + '>全部知识点</option>';
    for (var i = 0; i < cats.length; i++) {
      html += '<option value="' + esc(cats[i]) + '"' + (State.bank.cat === cats[i] ? ' selected' : '') + '>' + esc(cats[i]) + '</option>';
    }
    html += '</select></div>';

    html += '<div class="list" id="bank-list"></div>';
    html += '</div></div>';
    AppEl.innerHTML = html;
    renderBankList();
  }

  /* ------------------------------------------------------------------ */
  /* 错题 / 收藏                                                         */
  /* ------------------------------------------------------------------ */
  function renderWrong() {
    var now = Date.now();
    var tab = State.wrongTab;
    var html = '<div class="screen"><div class="scroll">';
    html += '<header class="page-head"><div class="grow">' +
      '<div class="page-date">巩固</div>' +
      '<h1 class="page-title">' + (tab === 'wrong' ? '错题本' : '我的收藏') + '</h1>' +
      '<p class="page-desc">' + (tab === 'wrong' ? '答错过的题目会一直保留，直到你连续答对' : '随时回看收藏的题目') + '</p>' +
      '</div><button class="icon-btn" data-action="settings" aria-label="设置">' + I.gear + '</button></header>';

    html += '<div class="chip-row">' +
      '<button class="chip ' + (tab === 'wrong' ? 'on' : '') + '" data-action="wrong-tab" data-tab="wrong">错题 ' + wrongList().length + '</button>' +
      '<button class="chip ' + (tab === 'fav' ? 'on' : '') + '" data-action="wrong-tab" data-tab="fav">收藏 ' + favList().length + '</button>' +
      '</div>';

    var items = tab === 'wrong' ? wrongList() : favList().map(function (id) { return BY_ID[id]; });
    if (items.length) {
      html += '<button class="btn btn-primary btn-block mb8" data-action="' + (tab === 'wrong' ? 'start-wrong' : 'start-fav') + '">' +
        '开始重练（' + Math.min(items.length, 50) + ' 题）</button>' +
        '<div class="list">';
      for (var i = 0; i < Math.min(items.length, 100); i++) {
        html += rowHtml(items[i], State.expandedWrong === items[i].id, now);
      }
      html += '</div>';
      if (items.length > 100) {
        html += '<p class="stat-note center">仅展示前 100 题，重练时会包含全部 ' + items.length + ' 题</p>';
      }
    } else {
      html += '<div class="empty">' + I.book +
        '<div class="empty-title">' + (tab === 'wrong' ? '还没有错题' : '还没有收藏') + '</div>' +
        '<div class="empty-desc">' + (tab === 'wrong' ? '做错的题会自动进入这里，按错误次数排序' : '在答题页点击右上角星标收藏题目') + '</div>' +
        '</div>';
      html += '<button class="btn btn-soft btn-block mt14" data-action="tab" data-tab="today">去刷题</button>';
    }
    html += '</div></div>';
    AppEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* 统计                                                                */
  /* ------------------------------------------------------------------ */
  function renderStats() {
    var now = Date.now();
    var stt = getStats(now);
    var html = '<div class="screen"><div class="scroll">';
    html += '<header class="page-head"><div class="grow">' +
      '<div class="page-date">学习数据</div>' +
      '<h1 class="page-title">统计</h1>' +
      '<p class="page-desc">掌握情况、复习节奏与正确率</p></div>' +
      '<button class="icon-btn" data-action="settings" aria-label="设置">' + I.gear + '</button></header>';

    if (!stt || !stt.answered) {
      html += '<div class="empty" style="padding-top:70px">' + I.stats +
        '<div class="empty-title">还没有学习记录</div>' +
        '<div class="empty-desc">完成第一组练习后，这里会显示掌握分布、<br>遗忘曲线复习节奏和正确率趋势</div>' +
        '</div>';
      html += '<button class="btn btn-primary btn-block mt14" data-action="tab" data-tab="today">去刷题</button>';
      html += '</div></div>';
      AppEl.innerHTML = html;
      return;
    }

    var total = stt.total || TOTAL;
    var mastered = stt.masteredCount || 0;
    var consolidating = stt.consolidatingCount || 0;
    var learning = stt.learningCount || 0;
    var newCount = stt.newCount || 0;
    var answeredTotal = stt.answered || 0;
    var a = pct(mastered, answeredTotal), b = pct(consolidating, answeredTotal), c = pct(learning, answeredTotal);

    // 掌握分布
    html += '<section class="card">' +
      '<div class="row mb8"><div class="grow"><div class="card-title">掌握情况</div>' +
      '<div class="card-sub">已掌握 ' + mastered + ' / ' + total + ' 题</div></div>' +
      '<span class="tag gray">' + pct(stt.answered || 0, total) + '% 已学习</span></div>' +
      '<div class="donut-wrap">' +
      '<div class="donut" style="--a:' + a + ';--b:' + b + ';--c:' + c + '">' +
      '<div class="donut-center"><b>' + (stt.answered || 0) + '</b><span>已学习</span></div></div>' +
      '<div class="legend">' +
      '<div class="legend-row"><span class="legend-dot" style="background:var(--green)"></span>已掌握<span class="n">' + mastered + '</span></div>' +
      '<div class="legend-row"><span class="legend-dot" style="background:var(--primary)"></span>巩固中<span class="n">' + consolidating + '</span></div>' +
      '<div class="legend-row"><span class="legend-dot" style="background:var(--amber)"></span>学习中<span class="n">' + learning + '</span></div>' +
      '<div class="legend-row"><span class="legend-dot" style="background:var(--line)"></span>未学<span class="n">' + newCount + '</span></div>' +
      '</div></div>' +
      '<p class="stat-note">掌握度由艾宾浩斯复习阶梯决定：答对升 1 级、答错降 2 级，达到第 5 级视为「已掌握」。</p>' +
      '</section>';

    // 复习阶梯
    var dist = stt.levelDist || [];
    var maxDist = 1;
    for (var i = 0; i < dist.length; i++) maxDist = Math.max(maxDist, dist[i] || 0);
    var labels = ['10分', '1时', '1天', '2天', '4天', '7天', '15天', '30天', '60天', '120天', '240天'];
    var chartHtml = '';
    for (var l = 0; l < 11; l++) {
      var v = dist[l] || 0;
      var hgt = Math.round((v / maxDist) * 82);
      chartHtml += '<div class="chart-col"><div class="chart-bar ' + (v ? '' : 'zero') + '" style="height:' + Math.max(3, hgt) + 'px"></div>' +
        '<div class="chart-x">' + labels[l] + '</div></div>';
    }
    html += '<section class="card section">' +
      '<div class="row mb8"><div class="grow"><div class="card-title">复习阶梯分布</div>' +
      '<div class="card-sub">当前各题所处的间隔档位（越高越牢）</div></div></div>' +
      '<div class="chart">' + chartHtml + '</div></section>';

    // 未来 7 天复习计划（艾宾浩斯排期）
    var cardsAll = allCards();
    var todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    var future = [0, 0, 0, 0, 0, 0, 0];
    var overdue = 0;
    for (var key in cardsAll) {
      if (!Object.prototype.hasOwnProperty.call(cardsAll, key)) continue;
      var cc = cardsAll[key];
      if (!cc || cc.due == null) continue;
      if (cc.due <= now) { overdue++; continue; }
      var dd = Math.floor((cc.due - todayStart.getTime()) / 86400000);
      if (dd >= 0 && dd < 7) future[dd]++;
    }
    future[0] += overdue;
    var futureMax = 1;
    for (var fi = 0; fi < future.length; fi++) futureMax = Math.max(futureMax, future[fi]);
    var futureHtml = '';
    for (var fd = 0; fd < 7; fd++) {
      var fh = Math.round((future[fd] / futureMax) * 78);
      var label = fd === 0 ? '今天' : (fd === 1 ? '明天' : ((new Date(todayStart.getTime() + fd * 86400000).getMonth() + 1) + '/' + new Date(todayStart.getTime() + fd * 86400000).getDate()));
      futureHtml += '<div class="chart-col"><div class="chart-v" style="font-size:9.5px;color:var(--sub);height:12px">' + (future[fd] ? future[fd] : '') + '</div>' +
        '<div class="chart-bar" style="height:' + Math.max(3, fh) + 'px' + (future[fd] ? '' : ';background:var(--line)') + '"></div>' +
        '<div class="chart-x">' + label + '</div></div>';
    }
    var futureTotal = 0;
    for (var ft = 0; ft < 7; ft++) futureTotal += future[ft];
    html += '<section class="card section">' +
      '<div class="row mb8"><div class="grow"><div class="card-title">未来 7 天复习计划</div>' +
      '<div class="card-sub">按艾宾浩斯间隔自动排期 · 今天含逾期 ' + overdue + ' 题</div></div>' +
      '<span class="tag gray">7 天 ' + futureTotal + ' 题</span></div>' +
      '<div class="chart">' + futureHtml + '</div>' +
      '<div class="chart-legend"><span>今天 → 第 7 天</span><span>每天到期题量</span></div>' +
      '</section>';

    // 14 天趋势
    var daily = stt.daily || [];
    var maxDay = 1;
    for (var d = 0; d < daily.length; d++) maxDay = Math.max(maxDay, daily[d].answered || 0);
    var trendHtml = '';
    var accSum = 0, accN = 0;
    for (var k = 0; k < daily.length; k++) {
      var day = daily[k];
      var hh = Math.round(((day.answered || 0) / maxDay) * 78);
      var showLabel = k % 2 === 1;
      trendHtml += '<div class="chart-col">' +
        '<div class="chart-bar ' + (day.answered ? '' : 'zero') + '" style="height:' + Math.max(3, hh) + 'px"></div>' +
        '<div class="chart-x">' + (showLabel ? day.date.slice(5) : '') + '</div></div>';
      if (day.answered) { accSum += (day.correct || 0) / day.answered; accN++; }
    }
    var avgAcc = accN ? Math.round((accSum / accN) * 100) : 0;
    html += '<section class="card section">' +
      '<div class="row mb8"><div class="grow"><div class="card-title">近 14 天学习量</div>' +
      '<div class="card-sub">日均正确率 ' + avgAcc + '% · 连续学习 ' + (stt.streak || 0) + ' 天</div></div>' +
      '<span class="tag gray">今天 ' + ((stt.today && stt.today.answered) || 0) + ' 题</span></div>' +
      '<div class="chart">' + trendHtml + '</div>' +
      '<div class="chart-legend"><span>越高的柱子 = 当天答得越多</span><span>14 天前 → 今天</span></div>' +
      '</section>';

    // 知识点
    var cats = (stt.categories || []).slice().sort(function (x, y) { return (y.total || 0) - (x.total || 0); });
    if (cats.length) {
      html += '<section class="card section"><div class="row mb8"><div class="grow"><div class="card-title">知识点正确率</div>' +
        '<div class="card-sub">按自动归类的知识点统计</div></div></div>';
      for (var ci = 0; ci < cats.length; ci++) {
        var cat = cats[ci];
        var accPct = Math.round((cat.accuracy || 0) * 100);
        html += '<button class="cat-row" data-action="start-cat" data-cat="' + esc(cat.name) + '"><div class="cat-top">' +
          '<span>' + esc(cat.name) + '<span class="n">' + (cat.answered || 0) + '/' + (cat.total || 0) + '</span></span>' +
          '<span class="acc">' + (cat.answered ? accPct + '%' : '—') + '</span></div>' +
          '<div class="bar ' + (accPct >= 80 ? 'green' : accPct >= 60 ? '' : 'amber') + '"><i style="width:' + accPct + '%"></i></div>' +
          '</button>';
      }
      html += '</section>';
    }

    // 学习记录
    var sessions = (stt.sessions || []).slice(-8).reverse();
    html += '<section class="card section"><div class="row mb8"><div class="grow"><div class="card-title">最近学习</div>' +
      '<div class="card-sub">共 ' + ((stt.sessions || []).length) + ' 次练习记录</div></div></div>';
    if (!sessions.length) {
      html += '<p class="stat-note">暂无记录</p>';
    } else {
      for (var si = 0; si < sessions.length; si++) {
        var se = sessions[si];
        var seAcc = se.total ? Math.round((se.correct / se.total) * 100) : 0;
        html += '<div class="session-row">' +
          '<div class="session-ico">' + I.book + '</div>' +
          '<div class="session-main"><div class="session-name">' + (TYPE_LABEL[se.type] || '练习') + '</div>' +
          '<div class="session-time">' + fmtTime(se.at) + ' · ' + se.total + ' 题 · ' + fmtDuration(se.durationMs || 0) + '</div></div>' +
          '<div class="session-score ' + (seAcc >= 80 ? 'up' : 'down') + '">' + seAcc + '%</div>' +
          '</div>';
      }
    }
    html += '</section>';

    html += '</div></div>';
    AppEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* 设置                                                                */
  /* ------------------------------------------------------------------ */
  function renderSettings() {
    var s = settings();
    var stt = getStats(Date.now()) || {};
    var html = '<div class="screen"><div class="scroll">';
    html += '<header class="page-head">' +
      '<button class="icon-btn" data-action="back" aria-label="返回">' + I.back + '</button>' +
      '<div class="grow"><div class="page-date">设置</div><h1 class="page-title">偏好与数据</h1></div></header>';

    html += '<div class="set-group">' +
      '<div class="set-row"><div class="set-label">每日新题上限<span class="sub">每天最多学习多少道新题</span></div>' +
      '<div class="seg">' +
      [10, 20, 30, 50].map(function (n) {
        return '<button class="' + (s.newPerDay === n ? 'on' : '') + '" data-action="set-new" data-val="' + n + '">' + n + '</button>';
      }).join('') +
      '</div></div>' +
      '<div class="set-row"><div class="set-label">每日复习上限<span class="sub">到期复习题一次最多安排多少道</span></div>' +
      '<div class="seg">' +
      [30, 60, 100].map(function (n) {
        return '<button class="' + (s.reviewLimit === n ? 'on' : '') + '" data-action="set-review" data-val="' + n + '">' + n + '</button>';
      }).join('') +
      '</div></div>' +
      '<div class="set-row"><div class="set-label">答题后显示复习提示<span class="sub">显示「下次复习：X」的算法提示</span></div>' +
      '<button class="switch ' + (s.showAlgoHint ? 'on' : '') + '" data-action="toggle-algo" aria-label="切换"></button></div>' +
      '</div>';

    html += '<div class="set-group">' +
      '<button class="set-row" data-action="export"><div class="set-label">导出学习备份<span class="sub">保存为 JSON，换机或清理缓存前请先备份</span></div>' +
      '<span class="chev">' + I.download + '</span></button>' +
      '<button class="set-row" data-action="import"><div class="set-label">导入学习备份<span class="sub">从 JSON 文件或粘贴文本恢复进度</span></div>' +
      '<span class="chev">' + I.upload + '</span></button>' +
      '<button class="set-row" data-action="reset"><div class="set-label" style="color:var(--red)">清空学习进度<span class="sub">删除全部答题记录、错题与收藏</span></div>' +
      '<span class="chev">' + I.refresh + '</span></button>' +
      '</div>';

    html += '<div class="set-group">' +
      '<div class="set-row"><div class="set-label">题库<span class="sub">共 ' + TOTAL + ' 题</span></div><span class="set-value">单选 ' + BANK.meta.singleCount + ' · 判断 ' + BANK.meta.judgeCount + '</span></div>' +
      '<div class="set-row"><div class="set-label">知识点<span class="sub">按题干关键词自动归类，仅用于统计</span></div><span class="set-value">' + categoryNames().length + ' 类</span></div>' +
      '<div class="set-row"><div class="set-label">复习算法<span class="sub">艾宾浩斯遗忘曲线 + 难度因子</span></div><span class="set-value">间隔重复</span></div>' +
      '<div class="set-row"><div class="set-label">已学习<span class="sub">至少作答过一次的题目</span></div><span class="set-value">' + (stt.answered || 0) + ' 题</span></div>' +
      '<div class="set-row"><div class="set-label">数据存储<span class="sub">全部保存在本机浏览器，不上传服务器</span></div><span class="set-value">本地存储</span></div>' +
      '</div>';

    html += '<section class="card" style="background:transparent;box-shadow:none;padding:0 3px">' +
      '<p class="stat-note">复习间隔：10分钟 → 1小时 → 1天 → 2天 → 4天 → 7天 → 15天 → 30天 → 60天 → 120天 → 240天。' +
      '答对升一级（难度因子微调间隔），答错降两级并安排重练，因此薄弱题会更快再次出现。</p>' +
      '</section>';

    html += '</div></div>';
    AppEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* 弹层                                                                */
  /* ------------------------------------------------------------------ */
  function openModal(html) {
    ModalRoot.innerHTML = '<div class="modal-mask" data-action="close-modal"><div class="modal" data-action="modal-noop">' +
      '<div class="modal-handle"></div>' + html + '</div></div>';
  }
  function closeModal() {
    ModalRoot.innerHTML = '';
  }
  function modalActions(lines) {
    var h = '<div class="modal-actions">';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      h += '<button class="btn ' + (l.cls || 'btn-ghost') + ' btn-block" data-action="' + l.action + '"' +
        (l.attrs || '') + '>' + l.label + '</button>';
    }
    return h + '</div>';
  }

  function showExport() {
    var data = safe(function () { return Store.exportData(); }, '{}');
    openModal('<div class="modal-title">导出学习备份</div>' +
      '<p class="modal-desc">复制下面内容保存到备忘录，或下载为 JSON 文件。备份包含全部答题记录、掌握度、错题与收藏。</p>' +
      '<textarea class="modal-input" id="backup-text" readonly>' + esc(data) + '</textarea>' +
      modalActions([
        { label: '复制备份内容', action: 'copy-backup', cls: 'btn-primary' },
        { label: '下载 JSON 文件', action: 'download-backup', cls: 'btn-soft' },
        { label: '关闭', action: 'close-modal' }
      ]));
  }

  function showImport() {
    openModal('<div class="modal-title">导入学习备份</div>' +
      '<p class="modal-desc">选择之前导出的 JSON 文件，或把备份内容粘贴到下面。导入会覆盖当前进度。</p>' +
      '<button class="btn btn-ghost btn-block mb8" data-action="pick-file">从文件选择</button>' +
      '<input id="import-file" type="file" accept="application/json,.json,text/plain" style="display:none">' +
      '<textarea class="modal-input" id="import-text" placeholder="粘贴备份 JSON 内容…"></textarea>' +
      modalActions([
        { label: '确认导入', action: 'do-import', cls: 'btn-primary' },
        { label: '取消', action: 'close-modal' }
      ]));
  }

  function showReset() {
    openModal('<div class="modal-title">清空学习进度？</div>' +
      '<p class="modal-desc">将删除全部答题记录、掌握度、错题与收藏，且无法恢复。题库本身不受影响。</p>' +
      modalActions([
        { label: '确认清空', action: 'confirm-reset', cls: 'btn-danger' },
        { label: '取消', action: 'close-modal' }
      ]));
  }

  function showQuit() {
    openModal('<div class="modal-title">结束本次练习？</div>' +
      '<p class="modal-desc">已作答的题目会保留掌握度记录，未作答的题目会回到今日计划。</p>' +
      modalActions([
        { label: '继续答题', action: 'close-modal', cls: 'btn-primary' },
        { label: '结束练习', action: 'quit-confirm', cls: 'btn-ghost' }
      ]));
  }

  function downloadBackup() {
    var data = safe(function () { return Store.exportData(); }, '{}');
    var name = '刷题备份-' + safe(function () { return Store.dayKey(Date.now()); }, 'backup') + '.json';
    try {
      var blob = new Blob([data], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('已生成备份文件');
    } catch (e) {
      toast('下载失败，请使用「复制备份内容」');
    }
  }

  function copyBackup() {
    var ta = document.getElementById('backup-text');
    if (!ta) return;
    var done = function () { toast('备份已复制到剪贴板'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done, function () { fallbackCopy(ta, done); });
    } else {
      fallbackCopy(ta, done);
    }
  }
  function fallbackCopy(ta, done) {
    try {
      ta.removeAttribute('readonly');
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      ta.setAttribute('readonly', 'readonly');
      if (ok) done(); else toast('复制失败，请长按文本手动选择');
    } catch (e) {
      toast('复制失败，请长按文本手动选择');
    }
  }

  function doImport() {
    var ta = document.getElementById('import-text');
    var text = ta ? ta.value.trim() : '';
    if (!text) { toast('请先粘贴备份内容'); return; }
    var ok = false;
    try { ok = Store.importData(text) !== false; } catch (e) { ok = false; }
    if (ok) {
      closeModal();
      toast('备份已导入');
      State.session = null;
      State.view = 'today';
      State.tab = 'today';
      render();
    } else {
      toast('备份格式不正确，导入失败');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 事件                                                                */
  /* ------------------------------------------------------------------ */
  var searchTimer = null;

  function handleAction(action, el) {
    switch (action) {
      case 'noop': case 'modal-noop': return;
      case 'close-modal': closeModal(); return;
      case 'tab': navTab(el.getAttribute('data-tab')); return;
      case 'settings': openSettings(); return;
      case 'back': goBack(); return;
      case 'start-daily': startDaily(); return;
      case 'start-random': startRandom(); return;
      case 'start-wrong': startWrong(); return;
      case 'start-fav': startFav(); return;
      case 'answer': answer(el.getAttribute('data-key')); return;
      case 'next': nextQuestion(); return;
      case 'quit-quiz':
        if (State.session && State.session.answers.length) showQuit();
        else { quitQuiz(true); }
        return;
      case 'quit-confirm': quitQuiz(true); return;
      case 'fav': {
        var s = State.session;
        if (!s) return;
        var qid = s.queue[s.pos];
        safe(function () { return Store.toggleFav(qid); }, null);
        renderQuizPreserveScroll();
        toast(fav(qid) ? '已收藏' : '已取消收藏');
        return;
      }
      case 'fav-q': {
        var id = Number(el.getAttribute('data-id'));
        safe(function () { return Store.toggleFav(id); }, null);
        toast(fav(id) ? '已收藏' : '已取消收藏');
        if (State.view === 'bank') { renderBankList(); }
        else if (State.view === 'wrong') { render(); }
        else { renderQuizPreserveScroll(); }
        return;
      }
      case 'bank-type':
        State.bank.type = el.getAttribute('data-type');
        State.bank.expanded = null;
        State.bank.limit = 60;
        render();
        return;
      case 'bank-row': {
        var rid = Number(el.getAttribute('data-id'));
        if (State.view === 'wrong') {
          State.expandedWrong = State.expandedWrong === rid ? null : rid;
          render();
        } else {
          State.bank.expanded = State.bank.expanded === rid ? null : rid;
          renderBankList();
        }
        return;
      }
      case 'bank-more':
        State.bank.limit += 60;
        renderBankList();
        return;
      case 'practice-one': {
        var pid = Number(el.getAttribute('data-id'));
        startSession('one', [pid], '单题练习');
        return;
      }
      case 'wrong-tab':
        State.wrongTab = el.getAttribute('data-tab');
        State.expandedWrong = null;
        render();
        return;
      case 'start-cat': {
        var catName = el.getAttribute('data-cat');
        var ccards = allCards();
        var cids = QS.filter(function (x) { return (x.category || '其他') === catName; }).map(function (x) { return x.id; });
        cids.sort(function (x, y) {
          var cx = ccards[x] || {}, cy = ccards[y] || {};
          var rx = cx.due && cx.due <= Date.now() ? 0 : (SRS.isNew(cx) ? 1 : 2);
          var ry = cy.due && cy.due <= Date.now() ? 0 : (SRS.isNew(cy) ? 1 : 2);
          if (rx !== ry) return rx - ry;
          return ((cx.due || 0) - (cy.due || 0));
        });
        startSession('category', cids.slice(0, 50), catName + ' · 专项练习');
        return;
      }
      case 'result-home':
        State.result = null;
        navTab('today');
        return;
      case 'result-again': {
        var r = State.result;
        if (!r) { navTab('today'); return; }
        State.result = null;
        startSession(r.type, r.ids, r.title);
        return;
      }
      case 'result-wrong-again': {
        var r2 = State.result;
        if (!r2 || !r2.wrongList.length) return;
        var wids = r2.wrongList.map(function (a) { return a.qid; });
        State.result = null;
        startSession('wrong', wids, '错题重练');
        return;
      }
      case 'export': showExport(); return;
      case 'import': showImport(); return;
      case 'reset': showReset(); return;
      case 'copy-backup': copyBackup(); return;
      case 'download-backup': downloadBackup(); return;
      case 'pick-file': {
        var fi = document.getElementById('import-file');
        if (fi) fi.click();
        return;
      }
      case 'do-import': doImport(); return;
      case 'confirm-reset':
        safe(function () { return Store.reset(); }, null);
        closeModal();
        toast('学习进度已清空');
        State.session = null;
        State.result = null;
        navTab('today');
        return;
      case 'set-new': {
        var n = Number(el.getAttribute('data-val'));
        safe(function () { return Store.setSetting('newPerDay', n); }, null);
        render();
        toast('每日新题上限：' + n + ' 题');
        return;
      }
      case 'set-review': {
        var rv = Number(el.getAttribute('data-val'));
        safe(function () { return Store.setSetting('reviewLimit', rv); }, null);
        render();
        toast('每日复习上限：' + rv + ' 题');
        return;
      }
      case 'toggle-algo': {
        var cur = settings().showAlgoHint !== false;
        safe(function () { return Store.setSetting('showAlgoHint', !cur); }, null);
        render();
        return;
      }
      default: return;
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    handleAction(el.getAttribute('data-action'), el);
  });

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'bank-search') {
      State.bank.q = e.target.value;
      State.bank.limit = 60;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderBankList, 120);
    }
  });

  document.addEventListener('change', function (e) {
    if (!e.target) return;
    if (e.target.id === 'bank-cat') {
      State.bank.cat = e.target.value;
      State.bank.expanded = null;
      State.bank.limit = 60;
      render();
    } else if (e.target.id === 'import-file') {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var ta = document.getElementById('import-text');
        if (ta) ta.value = String(reader.result || '');
        toast('文件已读取，点击「确认导入」');
      };
      reader.readAsText(f);
    }
  });

  // 键盘快捷键（桌面调试用）
  document.addEventListener('keydown', function (e) {
    if (State.view !== 'quiz' || !State.session) return;
    var s = State.session;
    if (!s.current) {
      var map = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', a: 'A', b: 'B', c: 'C', d: 'D' };
      var key = map[String(e.key).toLowerCase()];
      if (key) { e.preventDefault(); answer(key); }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      nextQuestion();
    }
  });

  /* ------------------------------------------------------------------ */
  /* 启动                                                                */
  /* ------------------------------------------------------------------ */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略：离线能力不可用不影响刷题 */ });
    });
  }

  function init() {
    try {
      safe(function () { return Store.init(); }, null);
    } catch (e) { /* localStorage 不可用时会退化为内存存储 */ }
    render();
    registerSW();
  }

  init();
})();
