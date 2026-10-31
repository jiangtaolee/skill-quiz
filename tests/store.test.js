/*!
 * tests/store.test.js — Store 存储层单元测试（零依赖，直接 node tests/store.test.js）
 * 用法：node tests/store.test.js
 * 说明：按浏览器加载顺序通过 fs.readFileSync + new Function 加载
 *       src/questions.js → src/srs.js → src/store.js，再用内存 storage 隔离每个用例。
 */
'use strict';

var fs = require('fs');
var path = require('path');

/** 在 Node 全局作用域执行浏览器脚本（脚本内部写 globalThis.XXX） */
function loadScript(relativePath) {
  var file = path.join(__dirname, '..', relativePath);
  new Function(fs.readFileSync(file, 'utf8'))();
}

loadScript('src/questions.js');
loadScript('src/srs.js');
loadScript('src/store.js');

var Store = globalThis.Store;
var SRS = globalThis.SRS;
var BANK = globalThis.QUESTION_BANK;

if (!Store || !SRS || !BANK) {
  console.error('LOAD FAIL: Store/SRS/QUESTION_BANK missing');
  process.exit(1);
}

// ------------------------------------------------------------ 迷你测试框架

var passed = 0;
var failed = 0;
var failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push(name + ' -> ' + (err && err.message ? err.message : String(err)));
  }
}

function ok(value, message) {
  if (!value) throw new Error(message || 'expected truthy, got ' + String(value));
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || 'equal') + ' expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
  }
}

function near(actual, expected, message) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-9) {
    throw new Error((message || 'near') + ' expected=' + expected + ' actual=' + actual);
  }
}

function deepEqual(actual, expected, message) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a !== b) throw new Error((message || 'deepEqual') + ' expected=' + b + ' actual=' + a);
}

// ------------------------------------------------------------ 测试辅助

var MINUTE = 60000;
var HOUR = 3600000;
var DAY = 86400000;

/** 本地时间戳（避免 UTC 时区导致 dayKey 断言偏移） */
function ts(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0).getTime();
}

/** 可持久化的内存 storage（同一对象可跨 Store.init 复用） */
function memoryStorage(seed) {
  var data = seed || {};
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

/** 全新用户环境（独立内存 storage） */
function fresh() {
  var storage = memoryStorage();
  Store.init(storage);
  return storage;
}

function sum(list, pick) {
  var total = 0;
  for (var i = 0; i < list.length; i++) total += pick(list[i]);
  return total;
}

// ------------------------------------------------------------ init / 初始结构

test('init: empty state structure', function () {
  fresh();
  var state = Store.get();
  equal(state.version, 1);
  deepEqual(state.cards, {});
  deepEqual(state.favs, []);
  deepEqual(state.daily, {});
  deepEqual(state.sessions, []);
  deepEqual(state.settings, { newPerDay: 20, reviewLimit: 60, showAlgoHint: true });
  deepEqual(state.streak, { lastDay: null, count: 0 });
});

test('init: corrupt / wrong-version storage falls back to clean state', function () {
  var now = ts(2026, 10, 31, 10, 0);
  Store.init(memoryStorage({ 'skillquiz.v1': '{not valid json' }));
  equal(Store.stats(now).answered, 0);
  Store.init(memoryStorage({ 'skillquiz.v1': JSON.stringify({ version: 0, cards: { 1: { reps: 1 } } }) }));
  equal(Store.stats(now).answered, 0);
  deepEqual(Store.get().cards, {});
});

// ------------------------------------------------------------ dayKey

test('dayKey: local YYYY-MM-DD with zero padding', function () {
  equal(Store.dayKey(ts(2026, 1, 5, 0, 0)), '2026-01-05');
  equal(Store.dayKey(ts(2026, 10, 31, 23, 59)), '2026-10-31');
  equal(Store.dayKey(ts(2026, 12, 9, 12, 0)), '2026-12-09');
});

// ------------------------------------------------------------ stats: 空数据

test('stats: fresh user structure (no crash)', function () {
  fresh();
  var now = ts(2026, 10, 31, 10, 0);
  var s = Store.stats(now);

  equal(s.total, BANK.meta.total);
  equal(s.total, BANK.questions.length);
  equal(s.answered, 0);
  equal(s.newCount, s.total);
  equal(s.learningCount, 0);
  equal(s.consolidatingCount, 0);
  equal(s.masteredCount, 0);
  equal(s.dueCount, 0);
  equal(s.accuracy, 0);
  deepEqual(s.today, { answered: 0, correct: 0, newLearned: 0 });
  equal(s.streak, 0);

  equal(s.categories.length, Object.keys(BANK.meta.categories).length);
  equal(sum(s.categories, function (c) { return c.total; }), s.total);
  for (var i = 0; i < s.categories.length; i++) {
    equal(s.categories[i].answered, 0);
    equal(s.categories[i].accuracy, 0);
    equal(s.categories[i].mastered, 0);
  }

  equal(s.daily.length, 14);
  equal(s.daily[0].date, Store.dayKey(ts(2026, 10, 18, 10, 0)));
  equal(s.daily[13].date, Store.dayKey(now));
  deepEqual(s.daily[13], { date: Store.dayKey(now), answered: 0, correct: 0 });

  equal(s.levelDist.length, 11);
  equal(sum(s.levelDist, function (n) { return n; }), 0);
  deepEqual(s.sessions, []);
});

// ------------------------------------------------------------ record

test('record: first answer creates card and updates daily', function () {
  fresh();
  var now = ts(2026, 10, 31, 10, 0);
  var day = Store.dayKey(now);

  ok(Store.card(123) === undefined, 'card must not exist before first answer');
  var result = Store.record(123, true, now);
  equal(result.before, null);
  equal(result.card.qid, 123);
  equal(result.card.level, 1);
  equal(result.card.reps, 1);

  var state = Store.get();
  ok(Store.card(123) === result.card, 'state must hold the returned card');
  deepEqual(state.daily[day], { answered: 1, correct: 1, newLearned: 1 });
  equal(state.streak.count, 1);
  equal(state.streak.lastDay, day);

  var s = Store.stats(now);
  equal(s.answered, 1);
  equal(s.newCount, s.total - 1);
  equal(s.learningCount, 1);
  equal(s.masteredCount, 0);
  equal(s.dueCount, 0); // 下次复习在未来
  near(s.accuracy, 1);
  deepEqual(s.today, { answered: 1, correct: 1, newLearned: 1 });
  equal(s.levelDist[1], 1);
});

test('record: same question again does not double count newLearned', function () {
  fresh();
  var now = ts(2026, 10, 31, 10, 0);
  var day = Store.dayKey(now);

  Store.record(123, true, now);
  var second = Store.record(123, false, now + 60000);
  ok(second.before !== null, 'before must be previous card');
  equal(second.before.reps, 1);
  equal(second.card.reps, 1);
  equal(second.card.lapses, 1);

  deepEqual(Store.get().daily[day], { answered: 2, correct: 1, newLearned: 1 });
  var s = Store.stats(now + 60000);
  deepEqual(s.today, { answered: 2, correct: 1, newLearned: 1 });
  near(s.accuracy, 0.5); // 1 对 1 错
  equal(s.answered, 1); // 仍是 1 道不同的题
  equal(s.levelDist[0], 1); // 答错后 level 0
});

test('record: string qid is normalized to number', function () {
  fresh();
  var now = ts(2026, 10, 31, 10, 0);
  var result = Store.record('42', true, now);
  equal(result.card.qid, 42);
  equal(result.card.qid, 42);
  ok(Store.card(42) !== undefined);
  ok(Store.card('42') !== undefined);
  deepEqual(Object.keys(Store.get().cards), ['42']);
});

// ------------------------------------------------------------ streak

test('streak: cross-day increment, same-day no double count, gap reset', function () {
  fresh();
  var d1 = ts(2026, 10, 31, 9, 0);
  var d2 = ts(2026, 11, 1, 9, 0);
  var d3 = ts(2026, 11, 2, 9, 0);
  var d4 = ts(2026, 11, 4, 9, 0);

  Store.record(1, true, d1);
  equal(Store.get().streak.count, 1);
  equal(Store.get().streak.lastDay, '2026-10-31');

  Store.record(2, true, d2);
  equal(Store.get().streak.count, 2);
  equal(Store.get().streak.lastDay, '2026-11-01');

  Store.record(3, true, d2 + HOUR); // 同一天再学不重复计数
  equal(Store.get().streak.count, 2);

  equal(Store.stats(d3).streak, 2); // 昨天学过，连续未断
  equal(Store.stats(d4).streak, 0); // 隔天未学，断签

  Store.record(4, true, d4); // 断签后重新从今天计数
  equal(Store.get().streak.count, 1);
  equal(Store.stats(d4).streak, 1);
});

// ------------------------------------------------------------ 持久化

test('persistence: same storage restores cards/daily/streak/settings', function () {
  var storage = memoryStorage();
  Store.init(storage);
  var now = ts(2026, 10, 31, 10, 0);
  Store.record(11, true, now);
  Store.setSetting('newPerDay', 33);

  Store.init(storage); // 模拟刷新页面
  equal(Store.card(11).reps, 1);
  deepEqual(Store.get().daily[Store.dayKey(now)], { answered: 1, correct: 1, newLearned: 1 });
  equal(Store.get().streak.count, 1);
  equal(Store.settings().newPerDay, 33);
});

// ------------------------------------------------------------ 收藏

test('favs: toggle, list copy, isFav', function () {
  fresh();
  deepEqual(Store.favs(), []);
  equal(Store.toggleFav(5), true);
  equal(Store.isFav(5), true);
  deepEqual(Store.favs(), [5]);

  var list = Store.favs();
  list.push(99);
  deepEqual(Store.favs(), [5], 'favs() must return a copy');

  equal(Store.toggleFav(5), false);
  equal(Store.isFav(5), false);
  deepEqual(Store.favs(), []);

  equal(Store.toggleFav('7'), true);
  deepEqual(Store.favs(), [7], 'fav ids are numbers');
  equal(Store.isFav('7'), true);
});

// ------------------------------------------------------------ sessions

test('addSession: entry shape, 200 cap, stats last 20', function () {
  fresh();
  var now = ts(2026, 10, 31, 10, 0);
  for (var i = 0; i < 205; i++) {
    Store.addSession({ type: 'learn', total: 1, correct: 1, durationMs: 1000, at: now + i });
  }
  equal(Store.get().sessions.length, 200);
  equal(Store.get().sessions[199].at, now + 204);

  var entry = Store.addSession({ type: 'review', total: 10, correct: 8, durationMs: 60000, at: now });
  deepEqual(entry, { at: now, type: 'review', total: 10, correct: 8, durationMs: 60000 });
  equal(Store.get().sessions.length, 200);

  var s = Store.stats(now);
  equal(s.sessions.length, 20);
  equal(s.sessions[19].at, now);
  equal(s.sessions[19].type, 'review');

  var fallback = Store.addSession({});
  equal(fallback.type, 'practice');
  equal(fallback.total, 0);
  equal(typeof fallback.at, 'number');
});

// ------------------------------------------------------------ 设置

test('settings: defaults, set, copy semantics, persistence', function () {
  var storage = fresh();
  deepEqual(Store.settings(), { newPerDay: 20, reviewLimit: 60, showAlgoHint: true });
  Store.setSetting('showAlgoHint', false);
  equal(Store.settings().showAlgoHint, false);

  var copy = Store.settings();
  copy.newPerDay = 999;
  equal(Store.settings().newPerDay, 20, 'settings() must return a copy');

  Store.init(storage);
  equal(Store.settings().showAlgoHint, false);
});

// ------------------------------------------------------------ export / import

test('export/import: roundtrip preserves progress', function () {
  var storage = fresh();
  var now = ts(2026, 10, 31, 10, 0);
  Store.record(1, true, now);
  Store.record(2, false, now);
  Store.toggleFav(2);
  Store.addSession({ type: 'learn', total: 2, correct: 1, durationMs: 5000, at: now });

  var dump = Store.exportData();
  equal(typeof dump, 'string');
  equal(JSON.parse(dump).version, 1);

  Store.reset();
  equal(Store.stats(now).answered, 0);

  equal(Store.importData(dump), true);
  var s = Store.stats(now);
  equal(s.answered, 2);
  equal(s.today.answered, 2);
  equal(Store.isFav(2), true);
  equal(Store.get().sessions.length, 1);

  Store.init(storage); // 导入结果已落盘
  equal(Store.stats(now).answered, 2);
  equal(Store.isFav(2), true);
});

test('importData: rejects bad input without touching current data', function () {
  fresh();
  var now = ts(2026, 10, 31, 10, 0);
  Store.record(1, true, now);

  equal(Store.importData(''), false);
  equal(Store.importData('not json'), false);
  equal(Store.importData(JSON.stringify({ version: 2, cards: {} })), false);
  equal(Store.importData(JSON.stringify({ version: 1 })), false);
  equal(Store.importData(JSON.stringify({ version: 1, cards: [] })), false);
  equal(Store.importData(null), false);

  equal(Store.stats(now).answered, 1, 'failed import must keep old data');
});

// ------------------------------------------------------------ reset

test('reset: clears cards, favs, daily, sessions, streak', function () {
  fresh();
  var now = ts(2026, 10, 31, 10, 0);
  Store.record(1, true, now);
  Store.toggleFav(1);
  Store.addSession({ type: 'learn', total: 1, correct: 1, durationMs: 1000, at: now });
  Store.setSetting('newPerDay', 5);

  Store.reset();
  var state = Store.get();
  deepEqual(state.cards, {});
  deepEqual(state.favs, []);
  deepEqual(state.daily, {});
  deepEqual(state.sessions, []);
  deepEqual(state.streak, { lastDay: null, count: 0 });
  deepEqual(state.settings, { newPerDay: 20, reviewLimit: 60, showAlgoHint: true });

  var s = Store.stats(now);
  equal(s.answered, 0);
  equal(s.newCount, s.total);
  equal(s.dueCount, 0);
  equal(s.accuracy, 0);
  equal(s.streak, 0);
});

// ------------------------------------------------------------ ensureCard

test('ensureCard: creates once, does not count as answered', function () {
  fresh();
  var now = ts(2026, 10, 31, 10, 0);
  ok(Store.card(42) === undefined);
  var card = Store.ensureCard(42);
  equal(card.qid, 42);
  equal(card.level, 0);
  equal(card.ease, 2.5);
  equal(card.reps, 0);
  equal(card.history.length, 0);
  ok(Store.ensureCard(42) === card, 'second ensureCard returns the same object');
  ok(Store.card(42) === card);

  var s = Store.stats(now);
  equal(s.answered, 0);
  equal(s.newCount, s.total);
});

// ------------------------------------------------------------ 统计一致性

test('stats: mastery buckets and levelDist stay consistent', function () {
  fresh();
  var now = ts(2026, 10, 31, 10, 0);

  // qid 1 连续答对 5 次 → level 5（已掌握）
  for (var i = 0; i < 5; i++) Store.record(1, true, now + i * 1000);
  // qid 2 答对 1 次 → level 1（学习中）
  Store.record(2, true, now + 6000);
  // qid 3 答错 1 次 → level 0（学习中）
  Store.record(3, false, now + 7000);

  var s = Store.stats(now + 10000);
  equal(s.answered, 3);
  equal(s.learningCount, 2);
  equal(s.consolidatingCount, 0);
  equal(s.masteredCount, 1);
  equal(s.newCount, s.total - 3);
  equal(s.newCount + s.learningCount + s.consolidatingCount + s.masteredCount, s.total);
  equal(sum(s.levelDist, function (n) { return n; }), 3);
  equal(s.levelDist[0], 1);
  equal(s.levelDist[1], 1);
  equal(s.levelDist[5], 1);
  equal(s.dueCount, 0);
  equal(sum(s.categories, function (c) { return c.answered; }), 3);
  equal(sum(s.categories, function (c) { return c.mastered; }), 1);

  // 1000 天后全部到期
  equal(Store.stats(now + 1000 * DAY).dueCount, 3);
});

test('stats: daily window includes today and zeros for missing days', function () {
  fresh();
  Store.record(1, true, ts(2026, 10, 29, 10, 0));
  Store.record(2, true, ts(2026, 10, 31, 10, 0));

  var s = Store.stats(ts(2026, 10, 31, 12, 0));
  equal(s.daily.length, 14);
  equal(s.daily[13].date, '2026-10-31');
  equal(s.daily[13].answered, 1);
  equal(s.daily[12].date, '2026-10-30');
  equal(s.daily[12].answered, 0);
  equal(s.daily[11].date, '2026-10-29');
  equal(s.daily[11].answered, 1);
  equal(s.daily[11].correct, 1);
});

test('stats: works when QUESTION_BANK is unavailable', function () {
  var saved = globalThis.QUESTION_BANK;
  globalThis.QUESTION_BANK = undefined;
  try {
    fresh();
    var now = ts(2026, 10, 31, 10, 0);
    Store.record(1, true, now);
    Store.record(2, false, now);
    var s = Store.stats(now);
    equal(s.total, 2); // 退化为 cards 数
    equal(s.answered, 2);
    equal(s.newCount, 0);
    deepEqual(s.categories, []);
    equal(s.levelDist.length, 11);
    equal(s.daily.length, 14);
    near(s.accuracy, 0.5);
  } finally {
    globalThis.QUESTION_BANK = saved;
  }
});

// ------------------------------------------------------------ 汇总

if (failed > 0) {
  console.error('FAILED ' + failed + ' of ' + (passed + failed) + ' tests');
  for (var i = 0; i < failures.length; i++) console.error('  FAIL ' + failures[i]);
  process.exit(1);
}
console.log('PASS store: ' + passed + ' tests, 0 failed');
