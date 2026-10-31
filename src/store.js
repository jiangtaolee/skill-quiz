/*!
 * src/store.js — 进度存储层（localStorage 单键 skillquiz.v1，Node 下退化为内存存储）
 *
 * 浏览器：先加载 src/srs.js（可选 src/questions.js），再 <script src="src/store.js"></script>
 *         → globalThis.Store
 * Node：  fs.readFileSync + new Function / vm 加载（末尾做 module.exports 兼容）
 *
 * 严格对应 docs/SPEC.md §3 §5：所有写操作内部自动 save()；
 * 其它模块不得直接读写 localStorage，只通过 Store。
 */
(function (global) {
  'use strict';

  var KEY = 'skillquiz.v1';
  var VERSION = 1;
  var SESSION_LIMIT = 200; // sessions 最多保留 200 条
  var STATS_SESSIONS = 20; // stats() 里返回的最近 sessions 条数
  var DAILY_DAYS = 14;     // stats() 近 14 天趋势

  var DEFAULT_SETTINGS = { newPerDay: 20, reviewLimit: 60, showAlgoHint: true };

  var DAY = 86400000;

  /** 懒取 SRS，缺失时抛清晰错误（避免浏览器脚本加载顺序问题） */
  function srs() {
    var api = global.SRS;
    if (!api) throw new Error('Store 依赖 SRS：请先加载 src/srs.js（globalThis.SRS 不存在）');
    return api;
  }

  /** 懒取 QUESTION_BANK（纯逻辑层允许题库缺失） */
  function questionBank() {
    var bank = global.QUESTION_BANK;
    return bank && Array.isArray(bank.questions) ? bank : null;
  }

  // ---------------------------------------------------------------- 基础工具

  /** 题号归一化：'123' → 123，非法值原样返回 */
  function qidOf(qid) {
    var n = Number(qid);
    return isFinite(n) && n > 0 ? n : qid;
  }

  /** 数字兜底 */
  function num(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : (fallback || 0);
  }

  /** 本地时区日期键 YYYY-MM-DD */
  function dayKey(ts) {
    var d = new Date(typeof ts === 'number' && isFinite(ts) ? ts : Date.now());
    var month = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (month < 10 ? '0' + month : month) + '-' + (day < 10 ? '0' + day : day);
  }

  /** 日期键加减天数（按本地日历，DST 安全） */
  function addDays(key, delta) {
    var parts = String(key).split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + delta);
    return dayKey(d.getTime());
  }

  /** 内存 storage（localStorage 不可用时的兜底，保证 Node 测试可跑） */
  function memoryStorage() {
    var data = {};
    return {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) {
        data[key] = String(value);
      },
      removeItem: function (key) {
        delete data[key];
      }
    };
  }

  // ---------------------------------------------------------------- 状态结构

  function defaultSettings() {
    return {
      newPerDay: DEFAULT_SETTINGS.newPerDay,
      reviewLimit: DEFAULT_SETTINGS.reviewLimit,
      showAlgoHint: DEFAULT_SETTINGS.showAlgoHint
    };
  }

  /** 全新用户状态（SPEC §3） */
  function defaultState() {
    var now = Date.now();
    return {
      version: VERSION,
      createdAt: now,
      updatedAt: now,
      cards: {},
      favs: [],
      daily: {},
      sessions: [],
      settings: defaultSettings(),
      streak: { lastDay: null, count: 0 }
    };
  }

  function normalizeSettings(raw) {
    var out = defaultSettings();
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.newPerDay === 'number' && isFinite(raw.newPerDay)) out.newPerDay = raw.newPerDay;
    if (typeof raw.reviewLimit === 'number' && isFinite(raw.reviewLimit)) out.reviewLimit = raw.reviewLimit;
    if (typeof raw.showAlgoHint === 'boolean') out.showAlgoHint = raw.showAlgoHint;
    return out;
  }

  function normalizeStreak(raw) {
    if (!raw || typeof raw !== 'object') return { lastDay: null, count: 0 };
    return {
      lastDay: typeof raw.lastDay === 'string' ? raw.lastDay : null,
      count: Math.max(0, Math.floor(num(raw.count, 0)))
    };
  }

  /** 把任意输入（存储 / 导入）整理成合法 state，缺字段补默认值 */
  function normalizeState(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    return {
      version: VERSION,
      createdAt: num(raw.createdAt, base.createdAt),
      updatedAt: num(raw.updatedAt, base.updatedAt),
      cards: raw.cards && typeof raw.cards === 'object' && !Array.isArray(raw.cards) ? raw.cards : {},
      favs: Array.isArray(raw.favs) ? raw.favs.slice() : [],
      daily: raw.daily && typeof raw.daily === 'object' && !Array.isArray(raw.daily) ? raw.daily : {},
      sessions: Array.isArray(raw.sessions) ? raw.sessions.slice(0, SESSION_LIMIT) : [],
      settings: normalizeSettings(raw.settings),
      streak: normalizeStreak(raw.streak)
    };
  }

  // ---------------------------------------------------------------- 存储适配

  var storage = null;
  var state = null;

  /** 选默认存储：localStorage 可用则用，否则内存兜底 */
  function pickDefaultStorage() {
    try {
      var ls = global.localStorage;
      if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
        var probe = KEY + '.__probe';
        ls.setItem(probe, '1');
        ls.removeItem(probe);
        return ls;
      }
    } catch (e) {
      // 隐私模式 / 受限环境 / Node —— 退化到内存
    }
    return memoryStorage();
  }

  /** 从 storage 载入 state（失败一律回到全新状态） */
  function loadState() {
    var text = null;
    try {
      text = storage ? storage.getItem(KEY) : null;
    } catch (e) {
      text = null;
    }
    if (!text) return defaultState();
    try {
      var raw = JSON.parse(text);
      if (!raw || raw.version !== VERSION) return defaultState();
      return normalizeState(raw);
    } catch (e) {
      return defaultState();
    }
  }

  /**
   * 初始化存储。
   * @param {object} [customStorage] 实现 getItem/setItem/removeItem 的对象；缺省用全局 localStorage
   * @returns {object} 当前 state
   */
  function init(customStorage) {
    var usable = customStorage && typeof customStorage.getItem === 'function' && typeof customStorage.setItem === 'function';
    storage = usable ? customStorage : pickDefaultStorage();
    state = loadState();
    return state;
  }

  /** 当前 state 对象（只读使用，不要直接改） */
  function get() {
    return state;
  }

  // ---------------------------------------------------------------- 卡片 / 作答

  /** 取某题卡片，未作答过返回 undefined */
  function card(qid) {
    return state.cards[String(qidOf(qid))];
  }

  /** 取卡片，不存在则创建（不立即落盘；record() 会保存） */
  function ensureCard(qid) {
    var id = qidOf(qid);
    var key = String(id);
    if (!state.cards[key]) {
      state.cards[key] = srs().newCard(id);
    }
    return state.cards[key];
  }

  /** 连续打卡：同一天不重复计数；昨天记录过则 +1；断签从今天重新计数 */
  function touchStreak(day) {
    var streak = state.streak || (state.streak = { lastDay: null, count: 0 });
    if (streak.lastDay === day) return;
    if (streak.lastDay && addDays(day, -1) === streak.lastDay) {
      streak.count = num(streak.count, 0) + 1;
    } else {
      streak.count = 1; // 首次学习或断签后重新开始
    }
    streak.lastDay = day;
  }

  /**
   * 记录一次作答（核心写入口）：
   * 确保卡片存在 → SRS.review → 更新 daily → 更新 streak → save
   * @returns {{card: object, before: object|null}} card 为作答后的新卡，before 为作答前卡片
   */
  function record(qid, correct, now) {
    var at = typeof now === 'number' && isFinite(now) ? now : Date.now();
    var id = qidOf(qid);
    var key = String(id);
    var before = state.cards[key] || null;
    var api = srs();
    var next = api.review(before || api.newCard(id), !!correct, at);
    next.qid = id;
    state.cards[key] = next;

    var day = dayKey(at);
    var daily = state.daily[day];
    if (!daily) {
      daily = { answered: 0, correct: 0, newLearned: 0 };
      state.daily[day] = daily;
    }
    daily.answered = num(daily.answered, 0) + 1;
    if (correct) daily.correct = num(daily.correct, 0) + 1;
    if (api.isNew(before)) daily.newLearned = num(daily.newLearned, 0) + 1;

    touchStreak(day);
    save();
    return { card: next, before: before };
  }

  // ---------------------------------------------------------------- 收藏

  function favs() {
    return state.favs.slice();
  }

  function isFav(qid) {
    return state.favs.indexOf(qidOf(qid)) !== -1;
  }

  /** 切换收藏状态，返回切换后的新状态（true=已收藏） */
  function toggleFav(qid) {
    var id = qidOf(qid);
    var index = state.favs.indexOf(id);
    var nowFav;
    if (index === -1) {
      state.favs.push(id);
      nowFav = true;
    } else {
      state.favs.splice(index, 1);
      nowFav = false;
    }
    save();
    return nowFav;
  }

  // ---------------------------------------------------------------- 统计

  /** 累计有效连续天数（今天/昨天有记录才算未断签） */
  function effectiveStreak(today) {
    var streak = state.streak || {};
    var count = num(streak.count, 0);
    if (!streak.lastDay) return 0;
    if (streak.lastDay === today || streak.lastDay === addDays(today, -1)) return count;
    return 0; // 断签
  }

  /**
   * 汇总统计，结构见 SPEC §5。
   * 全新用户（无任何卡片）也能安全返回全零结构。
   */
  function stats(now) {
    var at = typeof now === 'number' && isFinite(now) ? now : Date.now();
    var api = srs();
    var bank = questionBank();
    var questions = bank ? bank.questions : null;
    var cards = state.cards || {};

    var total = 0;
    var answeredCount = 0;
    var newCount = 0;
    var learningCount = 0;
    var consolidatingCount = 0;
    var masteredCount = 0;
    var accuracyCorrect = 0;
    var accuracyTotal = 0;
    var dueCount = 0;
    var levelDist = [];
    for (var k = 0; k <= 10; k++) levelDist.push(0);

    var catMap = {};
    var catOrder = [];
    function ensureCat(name) {
      if (!catMap[name]) {
        catMap[name] = { name: name, total: 0, answered: 0, mastered: 0, correct: 0, attempts: 0 };
        catOrder.push(name);
      }
      return catMap[name];
    }
    // 优先按题库 meta.categories 的顺序展示知识点
    if (bank && bank.meta && bank.meta.categories && typeof bank.meta.categories === 'object') {
      Object.keys(bank.meta.categories).forEach(function (name) { ensureCat(name); });
    }

    function accumulate(card, cat) {
      var level = Math.max(0, Math.min(10, Math.round(num(card.level, 0))));
      levelDist[level]++;
      if (level >= 5) {
        masteredCount++;
        if (cat) cat.mastered++;
      } else if (level >= 2) {
        consolidatingCount++;
      } else {
        learningCount++;
      }
      var history = Array.isArray(card.history) ? card.history : [];
      for (var h = 0; h < history.length; h++) {
        var item = history[h];
        accuracyTotal++;
        if (cat) cat.attempts++;
        if (item && item.c) {
          accuracyCorrect++;
          if (cat) cat.correct++;
        }
      }
      if (card.due != null && card.due <= at) dueCount++;
    }

    if (questions) {
      // 题库存在：以题库为准遍历，保证四档互斥且相加 = total
      total = questions.length;
      for (var i = 0; i < questions.length; i++) {
        var q = questions[i] || {};
        var catName = q.category || '未分类';
        var category = ensureCat(catName);
        category.total++;
        var current = cards[String(q.id)];
        if (!current || api.isNew(current)) {
          newCount++;
          continue;
        }
        answeredCount++;
        category.answered++;
        accumulate(current, category);
      }
    } else {
      // 题库缺失：退化为只统计已创建的卡片
      var keys = Object.keys(cards);
      total = keys.length;
      for (var j = 0; j < keys.length; j++) {
        var c = cards[keys[j]];
        if (!c || api.isNew(c)) {
          newCount++;
          continue;
        }
        answeredCount++;
        accumulate(c, null);
      }
    }

    var today = dayKey(at);
    var todayRaw = state.daily[today] || {};
    var todayStats = {
      answered: num(todayRaw.answered, 0),
      correct: num(todayRaw.correct, 0),
      newLearned: num(todayRaw.newLearned, 0)
    };

    var categories = catOrder.map(function (name) {
      var c = catMap[name];
      return {
        name: c.name,
        total: c.total,
        answered: c.answered,
        accuracy: c.attempts ? c.correct / c.attempts : 0,
        mastered: c.mastered
      };
    });

    var daily = [];
    for (var d = DAILY_DAYS - 1; d >= 0; d--) {
      var date = addDays(today, -d);
      var rec = state.daily[date] || {};
      daily.push({
        date: date,
        answered: num(rec.answered, 0),
        correct: num(rec.correct, 0)
      });
    }

    return {
      total: total,
      answered: answeredCount,
      newCount: newCount,
      learningCount: learningCount,
      consolidatingCount: consolidatingCount,
      masteredCount: masteredCount,
      dueCount: dueCount,
      accuracy: accuracyTotal ? accuracyCorrect / accuracyTotal : 0,
      today: todayStats,
      streak: effectiveStreak(today),
      categories: categories,
      daily: daily,
      levelDist: levelDist,
      sessions: (state.sessions || []).slice(-STATS_SESSIONS)
    };
  }

  // ---------------------------------------------------------------- 学习记录

  /** 追加一次学习会话记录（最多保留 200 条） */
  function addSession(session) {
    var src = session || {};
    var entry = {
      at: num(src.at, Date.now()),
      type: typeof src.type === 'string' ? src.type : 'practice',
      total: num(src.total, 0),
      correct: num(src.correct, 0),
      durationMs: num(src.durationMs, 0)
    };
    if (!Array.isArray(state.sessions)) state.sessions = [];
    state.sessions.push(entry);
    if (state.sessions.length > SESSION_LIMIT) {
      state.sessions = state.sessions.slice(state.sessions.length - SESSION_LIMIT);
    }
    save();
    return entry;
  }

  // ---------------------------------------------------------------- 设置

  /** 设置对象（带默认值的副本） */
  function settings() {
    return normalizeSettings(state.settings);
  }

  function setSetting(key, value) {
    if (!state.settings || typeof state.settings !== 'object') state.settings = defaultSettings();
    state.settings[key] = value;
    save();
    return settings();
  }

  // ---------------------------------------------------------------- 备份 / 重置

  /** 导出 state 的 JSON 字符串（深拷贝，便于备份） */
  function exportData() {
    return JSON.stringify(state);
  }

  /** 导入备份：校验 version 与基本结构，成功返回 true，失败返回 false（不改动现有数据） */
  function importData(jsonText) {
    if (typeof jsonText !== 'string' || !jsonText) return false;
    var raw;
    try {
      raw = JSON.parse(jsonText);
    } catch (e) {
      return false;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    if (raw.version !== VERSION) return false;
    if (!raw.cards || typeof raw.cards !== 'object' || Array.isArray(raw.cards)) return false;
    state = normalizeState(raw);
    save();
    return true;
  }

  /** 清空全部进度与设置，恢复全新用户状态 */
  function reset() {
    state = defaultState();
    save();
    return state;
  }

  // ---------------------------------------------------------------- 持久化

  /** 立即落盘，返回是否成功（localStorage 可能因配额 / 隐私模式失败） */
  function save() {
    if (!state) return false;
    state.updatedAt = Date.now();
    try {
      storage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false; // 写入失败不阻断答题流程
    }
  }

  // ---------------------------------------------------------------- 对外 API

  var Store = {
    init: init,
    get: get,
    card: card,
    ensureCard: ensureCard,
    record: record,
    stats: stats,
    favs: favs,
    isFav: isFav,
    toggleFav: toggleFav,
    dayKey: dayKey,
    addSession: addSession,
    settings: settings,
    setSetting: setSetting,
    exportData: exportData,
    importData: importData,
    reset: reset,
    save: save
  };

  global.Store = Store;

  // 加载即初始化：有 localStorage 用 localStorage，否则内存（Node 直接可跑）
  init();

  // Node 兼容（浏览器端 typeof module === 'undefined'，不会执行）
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
