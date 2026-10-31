/*!
 * tests/srs.test.js — SRS 算法单元测试（零依赖，直接 node tests/srs.test.js）
 * 用法：node tests/srs.test.js
 * 说明：通过 fs.readFileSync + new Function 加载 src/srs.js（模拟浏览器 <script>）。
 */
'use strict';

var fs = require('fs');
var path = require('path');

/** 在 Node 全局作用域执行浏览器脚本（脚本内部写 globalThis.XXX） */
function loadScript(relativePath) {
  var file = path.join(__dirname, '..', relativePath);
  new Function(fs.readFileSync(file, 'utf8'))();
}

loadScript('src/srs.js');

var SRS = globalThis.SRS;
if (!SRS) {
  console.error('LOAD FAIL: globalThis.SRS is missing');
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

// ------------------------------------------------------------ 测试数据

var NOW = 1700000000000; // 固定时间戳，便于断言 due 精确值
var MINUTE = 60000;
var HOUR = 3600000;
var DAY = 86400000;

/** 手工构造一张「已作答」卡片 */
function makeCard(overrides) {
  var card = {
    qid: 1,
    level: 1,
    ease: 2.5,
    reps: 1,
    lapses: 0,
    streak: 1,
    due: NOW + 10 * MINUTE,
    last: NOW - MINUTE,
    history: [{ at: NOW - MINUTE, c: true }]
  };
  if (overrides) {
    Object.keys(overrides).forEach(function (key) { card[key] = overrides[key]; });
  }
  return card;
}

// ------------------------------------------------------------ SRS.BASE_MINUTES

test('BASE_MINUTES ladder', function () {
  deepEqual(SRS.BASE_MINUTES, [10, 60, 1440, 2880, 5760, 10080, 21600, 43200, 86400, 172800, 345600]);
  ok(Object.isFrozen(SRS.BASE_MINUTES), 'BASE_MINUTES should be frozen');
});

// ------------------------------------------------------------ newCard

test('newCard fields', function () {
  var card = SRS.newCard(7);
  deepEqual(card, {
    qid: 7,
    level: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    streak: 0,
    due: null,
    last: null,
    history: []
  });
  ok(card.history !== SRS.newCard(7).history, 'history array must be a fresh array');
});

// ------------------------------------------------------------ intervalMinutes

test('intervalMinutes: no card -> 0, new card -> 10', function () {
  equal(SRS.intervalMinutes(null), 0);
  equal(SRS.intervalMinutes(undefined), 0);
  equal(SRS.intervalMinutes(SRS.newCard(1)), 10);
});

test('intervalMinutes: ease factor and rounding', function () {
  equal(SRS.intervalMinutes(makeCard({ level: 1, ease: 2.5 })), 60);
  equal(SRS.intervalMinutes(makeCard({ level: 5, ease: 2.5 })), 10080);
  // ease 2.8 -> factor 1.15 -> 10 * 1.15 = 11.5 -> round -> 12
  equal(SRS.intervalMinutes(makeCard({ level: 0, ease: 2.8 })), 12);
  // ease 1.3 -> factor 0.4 -> 10 * 0.4 = 4
  equal(SRS.intervalMinutes(makeCard({ level: 0, ease: 1.3 })), 4);
  // level 10 上限
  equal(SRS.intervalMinutes(makeCard({ level: 10, ease: 2.5 })), 345600);
  // 非法 level 自动夹取
  equal(SRS.intervalMinutes(makeCard({ level: 99, ease: 2.5 })), 345600);
});

// ------------------------------------------------------------ review: 答对

test('review correct (first): level+1, ease+0.03, reps+1, streak+1, due set', function () {
  var before = SRS.newCard(1);
  var after = SRS.review(before, true, NOW);
  equal(after.level, 1);
  near(after.ease, 2.53);
  equal(after.reps, 1);
  equal(after.lapses, 0);
  equal(after.streak, 1);
  equal(after.last, NOW);
  equal(SRS.intervalMinutes(after), 61); // 60 * (1 + 0.03 * 0.5) = 60.9 -> 61
  equal(after.due, NOW + 61 * MINUTE);
});

test('review correct (consecutive): ease +0.06', function () {
  var first = SRS.review(SRS.newCard(1), true, NOW);
  var second = SRS.review(first, true, NOW + 1000);
  equal(second.level, 2);
  near(second.ease, 2.59);
  equal(second.reps, 2);
  equal(second.streak, 2);
  equal(SRS.intervalMinutes(second), 1505); // 1440 * 1.045 = 1504.8 -> 1505
  equal(second.due, NOW + 1000 + 1505 * MINUTE);
});

test('review correct: level capped at 10', function () {
  var card = makeCard({ level: 10, ease: 2.5, streak: 3 });
  var after = SRS.review(card, true, NOW);
  equal(after.level, 10);
  near(after.ease, 2.56); // 连续答对 +0.06
  equal(after.due, NOW + 355968 * MINUTE); // 345600 * 1.03 = 355968
});

// ------------------------------------------------------------ review: 答错

test('review wrong: level-2 (min 0), ease-0.2, lapses+1, streak 0, reps unchanged', function () {
  var card = makeCard({ level: 3, ease: 2.5, reps: 3, streak: 2 });
  var after = SRS.review(card, false, NOW);
  equal(after.level, 1);
  near(after.ease, 2.3);
  equal(after.lapses, 1);
  equal(after.reps, 3);
  equal(after.streak, 0);
  equal(SRS.intervalMinutes(after), 54); // 60 * 0.9 = 54
  equal(after.due, NOW + 54 * MINUTE);
});

test('review wrong: level floor 0', function () {
  var after = SRS.review(SRS.newCard(2), false, NOW);
  equal(after.level, 0);
  equal(after.lapses, 1);
  equal(after.reps, 0);
  equal(after.streak, 0);
  near(after.ease, 2.3);
});

// ------------------------------------------------------------ ease 上下限

test('ease lower clamp 1.3', function () {
  var after = SRS.review(makeCard({ ease: 1.4 }), false, NOW);
  near(after.ease, 1.3);
  var again = SRS.review(after, false, NOW + 1000);
  near(again.ease, 1.3);
});

test('ease upper clamp 2.8', function () {
  var after = SRS.review(makeCard({ level: 4, ease: 2.75, streak: 1 }), true, NOW);
  near(after.ease, 2.8);
  var after2 = SRS.review(makeCard({ level: 4, ease: 2.78, streak: 0 }), true, NOW);
  near(after2.ease, 2.8);
});

// ------------------------------------------------------------ due 公式

test('due = now + intervalMinutes * 60000 (all levels, correct & wrong)', function () {
  for (var level = 0; level <= 10; level++) {
    var base = makeCard({ level: level, ease: 2.5, streak: 0 });
    var correctAfter = SRS.review(base, true, NOW);
    equal(correctAfter.due, NOW + SRS.intervalMinutes(correctAfter) * MINUTE, 'correct level ' + level);
    near((correctAfter.due - NOW) / MINUTE, Math.round((correctAfter.due - NOW) / MINUTE));
    var wrongAfter = SRS.review(base, false, NOW);
    equal(wrongAfter.due, NOW + SRS.intervalMinutes(wrongAfter) * MINUTE, 'wrong level ' + level);
  }
});

// ------------------------------------------------------------ history

test('history: append {at, c} and keep only last 20', function () {
  var card = SRS.newCard(3);
  for (var i = 0; i < 25; i++) {
    card = SRS.review(card, true, NOW + i * MINUTE);
  }
  equal(card.history.length, 20);
  equal(card.history[19].at, NOW + 24 * MINUTE);
  equal(card.history[0].at, NOW + 5 * MINUTE); // 最早 5 条被截断
  for (var j = 0; j < card.history.length; j++) {
    equal(card.history[j].c, true);
  }
});

test('history: wrong answers recorded with c=false', function () {
  var card = SRS.review(SRS.newCard(4), false, NOW);
  deepEqual(card.history, [{ at: NOW, c: false }]);
});

// ------------------------------------------------------------ 不可变性

test('review does not mutate input card (deep)', function () {
  var card = SRS.review(SRS.newCard(5), true, NOW);
  var snapshot = JSON.stringify(card);
  var next = SRS.review(card, false, NOW + MINUTE);
  equal(JSON.stringify(card), snapshot, 'input card must stay unchanged');
  ok(next !== card, 'must return a new object');
  ok(next.history !== card.history, 'must not reuse input history array');
});

test('review does not mutate a hand-built card', function () {
  var card = makeCard({});
  var snapshot = JSON.stringify(card);
  SRS.review(card, true, NOW + DAY);
  equal(JSON.stringify(card), snapshot);
});

// ------------------------------------------------------------ isNew / isDue

test('isNew: null/new/answered', function () {
  equal(SRS.isNew(null), true);
  equal(SRS.isNew(undefined), true);
  equal(SRS.isNew(SRS.newCard(1)), true);
  equal(SRS.isNew({ reps: 0, lapses: 1 }), false);
  equal(SRS.isNew({ reps: 1, lapses: 0 }), false);
  equal(SRS.isNew({ reps: 1, lapses: 0, level: 0 }), false);
});

test('isDue', function () {
  equal(SRS.isDue(null, NOW), false);
  equal(SRS.isDue(SRS.newCard(1), NOW), false);
  equal(SRS.isDue({ due: null }, NOW), false);
  equal(SRS.isDue({ due: NOW - 1 }, NOW), true);
  equal(SRS.isDue({ due: NOW }, NOW), true);
  equal(SRS.isDue({ due: NOW + 1 }, NOW), false);
});

// ------------------------------------------------------------ masteryOf

test('masteryOf four tiers and labels', function () {
  deepEqual(SRS.masteryOf(null), { key: 'new', label: '未学', pct: 0 });
  deepEqual(SRS.masteryOf(SRS.newCard(1)), { key: 'new', label: '未学', pct: 0 });
  deepEqual(SRS.masteryOf({ reps: 0, lapses: 0, level: 0 }), { key: 'new', label: '未学', pct: 0 });
  deepEqual(SRS.masteryOf({ reps: 1, lapses: 0, level: 0 }), { key: 'learning', label: '学习中', pct: 0 });
  deepEqual(SRS.masteryOf({ reps: 1, lapses: 0, level: 1 }), { key: 'learning', label: '学习中', pct: 10 });
  deepEqual(SRS.masteryOf({ reps: 1, lapses: 0, level: 2 }), { key: 'consolidating', label: '巩固中', pct: 20 });
  deepEqual(SRS.masteryOf({ reps: 1, lapses: 0, level: 4 }), { key: 'consolidating', label: '巩固中', pct: 40 });
  deepEqual(SRS.masteryOf({ reps: 1, lapses: 0, level: 5 }), { key: 'mastered', label: '已掌握', pct: 50 });
  deepEqual(SRS.masteryOf({ reps: 1, lapses: 0, level: 10 }), { key: 'mastered', label: '已掌握', pct: 100 });
});

// ------------------------------------------------------------ nextReviewText

test('nextReviewText labels', function () {
  var base = makeCard({});
  function withDue(due) {
    var card = makeCard({});
    card.due = due;
    return card;
  }
  equal(SRS.nextReviewText(null, NOW), '—');
  equal(SRS.nextReviewText(SRS.newCard(1), NOW), '—');
  equal(SRS.nextReviewText(withDue(NOW), NOW), '已到期');
  equal(SRS.nextReviewText(withDue(NOW - 1000), NOW), '已到期');
  equal(SRS.nextReviewText(withDue(NOW + 5 * MINUTE), NOW), '5 分钟后');
  equal(SRS.nextReviewText(withDue(NOW + 30 * 1000), NOW), '1 分钟后');
  equal(SRS.nextReviewText(withDue(NOW + 3 * HOUR), NOW), '3 小时后');
  equal(SRS.nextReviewText(withDue(NOW + DAY), NOW), '明天');
  equal(SRS.nextReviewText(withDue(NOW + 5 * DAY), NOW), '5 天后');
  equal(SRS.nextReviewText(withDue(NOW + 30 * DAY), NOW), '1 个月后');
  equal(SRS.nextReviewText(withDue(NOW + 240 * DAY), NOW), '8 个月后');
  ok(base.due > NOW);
});

// ------------------------------------------------------------ makeQueue

test('makeQueue: due sorted asc, fresh in input order, not-due excluded', function () {
  var cards = {
    '1': { qid: 1, level: 0, ease: 2.5, reps: 0, lapses: 0, streak: 0, due: null, last: null, history: [] },
    '2': { qid: 2, level: 2, ease: 2.5, reps: 2, lapses: 0, streak: 2, due: NOW - 5000, last: NOW - DAY, history: [] },
    '3': { qid: 3, level: 2, ease: 2.5, reps: 2, lapses: 0, streak: 2, due: NOW - 1000, last: NOW - DAY, history: [] },
    '4': { qid: 4, level: 2, ease: 2.5, reps: 2, lapses: 0, streak: 2, due: NOW + 60000, last: NOW - DAY, history: [] }
  };
  var queue = SRS.makeQueue([1, 2, 3, 4, 5], cards, NOW);
  deepEqual(queue.due, [2, 3]); // due 升序：NOW-5000 先于 NOW-1000
  deepEqual(queue.fresh, [1, 5]);
});

test('makeQueue: tie on due breaks by qid, handles empty input', function () {
  var cards = {
    '9': { qid: 9, level: 1, ease: 2.5, reps: 1, lapses: 0, streak: 1, due: NOW - 1000, last: NOW, history: [] },
    '7': { qid: 7, level: 1, ease: 2.5, reps: 1, lapses: 0, streak: 1, due: NOW - 1000, last: NOW, history: [] }
  };
  deepEqual(SRS.makeQueue([9, 7], cards, NOW).due, [7, 9]);
  deepEqual(SRS.makeQueue([], cards, NOW), { due: [], fresh: [] });
  deepEqual(SRS.makeQueue(null, null, NOW), { due: [], fresh: [] });
});

// ------------------------------------------------------------ 边界

test('review(null, ...) works', function () {
  var after = SRS.review(null, true, NOW);
  equal(after.qid, null);
  equal(after.level, 1);
  equal(after.reps, 1);
  equal(after.due, NOW + 61 * MINUTE);
});

test('review correct flag coerced to boolean', function () {
  var after = SRS.review(SRS.newCard(8), 1, NOW);
  equal(after.reps, 1);
  equal(after.history[0].c, true);
});

// ------------------------------------------------------------ 汇总

if (failed > 0) {
  console.error('FAILED ' + failed + ' of ' + (passed + failed) + ' tests');
  for (var i = 0; i < failures.length; i++) console.error('  FAIL ' + failures[i]);
  process.exit(1);
}
console.log('PASS srs: ' + passed + ' tests, 0 failed');
