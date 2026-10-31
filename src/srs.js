/*!
 * src/srs.js — 艾宾浩斯遗忘曲线间隔重复算法（纯逻辑，零依赖）
 *
 * 浏览器：<script src="src/srs.js"></script>  →  globalThis.SRS
 * Node：  通过 fs.readFileSync + new Function / vm 加载（脚本末尾做 module.exports 兼容）
 *
 * 严格对应 docs/SPEC.md §4：
 *   - level 0..10，答对升 1 级，答错降 2 级（最低 0）
 *   - 间隔 = BASE_MINUTES[level] × easeFactor(ease)，四舍五入到分钟，最小 1 分钟
 *   - ease 初始 2.5，范围 [1.3, 2.8]；连续答对 +0.06 / 首次答对 +0.03 / 答错 -0.2
 *   - history 只保留最近 20 条；review 返回新对象，绝不修改入参
 */
(function (global) {
  'use strict';

  /** 复习阶梯（分钟）：10分钟、1小时、1天、2天、4天、7天、15天、30天、60天、120天、240天 */
  var BASE_MINUTES = [10, 60, 1440, 2880, 5760, 10080, 21600, 43200, 86400, 172800, 345600];

  var MAX_LEVEL = BASE_MINUTES.length - 1; // 10
  var EASE_MIN = 1.3;
  var EASE_MAX = 2.8;
  var BASE_EASE = 2.5;
  var EASE_GAIN_STREAK = 0.06; // 连续第二次答对起
  var EASE_GAIN_FIRST = 0.03;  // 刚答对第一题（此前的 streak 为 0）
  var EASE_PENALTY = 0.2;      // 答错
  var HISTORY_LIMIT = 20;      // 每题只保留最近 20 次作答记录
  var MINUTE = 60000;

  /** 数值夹取 */
  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  /** 难度因子：由 ease 换算到间隔倍率（0.4 ~ 1.15） */
  function easeFactor(ease) {
    return clamp(1 + (ease - BASE_EASE) * 0.5, 0.4, 1.15);
  }

  /** 四舍五入到分钟；加极小 epsilon 抵消二进制浮点误差（如 10 × 1.15 → 11.5 应进位为 12） */
  function roundMinutes(value) {
    return Math.round(value + 1e-9);
  }

  /**
   * 当前 card 的间隔分钟数（四舍五入，最小 1）。
   * 无 card 返回 0（SPEC：无则 0）。
   */
  function intervalMinutes(card) {
    if (!card) return 0;
    var level = clamp(Math.round(Number(card.level) || 0), 0, MAX_LEVEL);
    var ease = typeof card.ease === 'number' && isFinite(card.ease) ? card.ease : BASE_EASE;
    var minutes = roundMinutes(BASE_MINUTES[level] * easeFactor(ease));
    return Math.max(1, minutes);
  }

  /** 全新卡片（未学）。due/last 为 null，掌握度按 reps==0 && lapses==0 判定为「未学」 */
  function newCard(qid) {
    return {
      qid: qid,
      level: 0,
      ease: BASE_EASE,
      reps: 0,
      lapses: 0,
      streak: 0,
      due: null,
      last: null,
      history: []
    };
  }

  /** 是否未学：没有 card，或从未作答过（reps 与 lapses 都为 0） */
  function isNew(card) {
    return !card || ((Number(card.reps) || 0) === 0 && (Number(card.lapses) || 0) === 0);
  }

  /**
   * 一次作答，返回新 card（不可变，不修改入参）。
   * @param {object|null} card 作答前卡片，可为 null（视为新卡）
   * @param {boolean} correct 是否答对
   * @param {number} now 毫秒时间戳
   */
  function review(card, correct, now) {
    var base = card || newCard(null);
    var at = typeof now === 'number' && isFinite(now) ? now : Date.now();
    var ok = !!correct;

    var levelBefore = clamp(Math.round(Number(base.level) || 0), 0, MAX_LEVEL);
    var easeBefore = typeof base.ease === 'number' && isFinite(base.ease) ? base.ease : BASE_EASE;
    var streakBefore = Number(base.streak) || 0;

    // 1) history 追加一条（只留最近 20 条）—— 拷贝数组，避免污染入参
    var history = (Array.isArray(base.history) ? base.history : []).slice();
    history.push({ at: at, c: ok });
    if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);

    var next = {
      qid: base.qid,
      level: levelBefore,
      ease: easeBefore,
      reps: Number(base.reps) || 0,
      lapses: Number(base.lapses) || 0,
      streak: streakBefore,
      due: base.due == null ? null : base.due,
      last: at,
      history: history
    };

    if (ok) {
      // 2) 答对：升级、reps+1、streak+1、ease 递增
      next.level = Math.min(MAX_LEVEL, levelBefore + 1);
      next.reps = (Number(base.reps) || 0) + 1;
      next.streak = streakBefore + 1;
      var gain = streakBefore >= 1 ? EASE_GAIN_STREAK : EASE_GAIN_FIRST;
      next.ease = clamp(easeBefore + gain, EASE_MIN, EASE_MAX);
    } else {
      // 3) 答错：降 2 级（最低 0）、lapses+1、streak 归零、ease 递减
      next.level = Math.max(0, levelBefore - 2);
      next.lapses = (Number(base.lapses) || 0) + 1;
      next.streak = 0;
      next.ease = clamp(easeBefore - EASE_PENALTY, EASE_MIN, EASE_MAX);
    }

    // 4) 用「新 level + 新 ease」算下次到期时间
    next.due = at + intervalMinutes(next) * MINUTE;
    return next;
  }

  /** 是否到期复习（未学 / due 为空都不算到期） */
  function isDue(card, now) {
    var at = typeof now === 'number' ? now : Date.now();
    return !!card && card.due != null && card.due <= at;
  }

  /**
   * 掌握度四档：
   *   new 未学（无 card / 从未作答）
   *   learning 学习中（level ≤ 1）
   *   consolidating 巩固中（level 2..4）
   *   mastered 已掌握（level ≥ 5）
   */
  function masteryOf(card) {
    if (isNew(card)) return { key: 'new', label: '未学', pct: 0 };
    var level = clamp(Math.round(Number(card.level) || 0), 0, MAX_LEVEL);
    var pct = Math.round((level / MAX_LEVEL) * 100);
    if (level <= 1) return { key: 'learning', label: '学习中', pct: pct };
    if (level <= 4) return { key: 'consolidating', label: '巩固中', pct: pct };
    return { key: 'mastered', label: '已掌握', pct: pct };
  }

  /**
   * 下次复习文案：'—' / '已到期' / 'X 分钟后' / 'X 小时后' / '明天' / 'X 天后' / 'X 个月后'
   * 文案必须与 SPEC 完全一致（数字与单位之间有一个空格）。
   */
  function nextReviewText(card, now) {
    if (isNew(card)) return '—';
    if (card.due == null) return '—';
    var at = typeof now === 'number' ? now : Date.now();
    var diff = card.due - at;
    if (diff <= 0) return '已到期';

    var HOUR = 3600000;
    var DAY = 86400000;
    if (diff < HOUR) return Math.max(1, Math.round(diff / MINUTE)) + ' 分钟后';
    if (diff < DAY) return Math.max(1, Math.round(diff / HOUR)) + ' 小时后';

    var days = Math.round(diff / DAY);
    if (days <= 1) return '明天';
    if (days < 30) return days + ' 天后';
    return Math.max(1, Math.round(days / 30)) + ' 个月后';
  }

  /**
   * 组织一次学习队列：
   *   due   —— 已到期且非新题，按 due 升序（同一到期时间按题号升序）
   *   fresh —— 从未作答的题，保持传入的题目顺序
   * 未到期且非新题的卡不在两个队列中。
   * @param {number[]} qids 题目 id 列表
   * @param {object} cards  id → card 映射
   * @param {number} now 毫秒时间戳
   */
  function makeQueue(qids, cards, now) {
    var at = typeof now === 'number' ? now : Date.now();
    var list = Array.isArray(qids) ? qids : [];
    var map = cards && typeof cards === 'object' ? cards : {};
    var due = [];
    var fresh = [];

    for (var i = 0; i < list.length; i++) {
      var qid = list[i];
      var card = map[qid];
      if (card === undefined && map[String(qid)] !== undefined) card = map[String(qid)];
      if (isNew(card)) {
        fresh.push(qid);
      } else if (isDue(card, at)) {
        due.push({ qid: qid, due: card.due });
      }
    }

    due.sort(function (a, b) {
      var delta = a.due - b.due;
      if (delta) return delta;
      return (Number(a.qid) || 0) - (Number(b.qid) || 0);
    });

    return {
      due: due.map(function (item) { return item.qid; }),
      fresh: fresh
    };
  }

  // 常量数组冻结，防止使用方误改算法阶梯
  Object.freeze(BASE_MINUTES);

  var SRS = {
    BASE_MINUTES: BASE_MINUTES,
    newCard: newCard,
    review: review,
    isDue: isDue,
    isNew: isNew,
    masteryOf: masteryOf,
    nextReviewText: nextReviewText,
    intervalMinutes: intervalMinutes,
    makeQueue: makeQueue
  };

  global.SRS = SRS;

  // Node 兼容（浏览器端 typeof module === 'undefined'，不会执行）
  if (typeof module !== 'undefined' && module.exports) module.exports = SRS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
