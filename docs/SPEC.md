# 技能鉴定刷题 PWA — 技术规格与模块契约

> 本文件是 Lead 与队友之间的唯一契约。**所有模块必须严格按此实现**，函数名、参数、返回结构不得随意改动；
> 需要扩展时先在本文件追加，并在消息里同步 Lead。

## 1. 产品目标

iOS Safari 可"添加到主屏幕"的离线刷题 PWA，题库来自 `3_技能鉴定初级题库（2018年新版）.docx`
（600 题：480 单选 + 120 判断，判断题固定 A=对 / B=错）。
核心：艾宾浩斯遗忘曲线间隔重复（SRS），按答题正误动态调整复习计划；答题、判分、掌握情况记录、错题本、统计。

## 2. 目录与文件归属（互不越界）

| 文件 | 负责人 | 说明 |
|---|---|---|
| `index.html`, `styles/app.css`, `src/app.js` | Lead | 全部界面、路由、会话、统计展示 |
| `src/srs.js`, `src/store.js`, `tests/srs.test.js`, `tests/store.test.js` | srs-engine | 纯逻辑 + 单元测试 |
| `icons/*`, `manifest.webmanifest`, `sw.js`, `tools/gen_icons.py`, `tools/build_single.py`, `docs/部署与安装.md` | pwa-packaging | 图标、PWA 壳、单文件构建、部署文档 |
| `data/questions.json`, `src/questions.js`, `tools/parse_bank.py` | Lead | 已生成，只读 |
| `docs/SPEC.md` | Lead | 本文件 |
| `README.md` | Lead | 使用说明 |

题目数据：`src/questions.js` 定义 `globalThis.QUESTION_BANK = { meta, questions: [...] }`。
题目结构：`{ id:1..600, no, type:'single'|'judge', stem, options:[{key:'A',text}], answer:'A'..'D', score:0.5, category }`。
**不要在运行时 fetch 题库**，直接读 `QUESTION_BANK`（保证 file:// 打开也能用）。

## 3. 数据持久化

- 存储介质：`localStorage`，单键 `skillquiz.v1`，值为 JSON。
- 读写通过 `Store`（见 §5），其它模块不得直接碰 localStorage。
- 结构：

```js
{
  version: 1,
  createdAt: 1690000000000,
  updatedAt: 1690000000000,
  cards: {
    "123": { qid:123, level:3, ease:2.5, reps:2, lapses:0, streak:2,
             due:1690000000000, last:1690000000000, history:[{at:1690000000000, c:true}] }
  },
  favs: [1,2,3],
  daily: { "2026-10-31": { answered: 25, correct: 20, newLearned: 15 } },
  sessions: [ { at, type, total, correct, durationMs } ],   // 最多保留 200 条
  settings: { newPerDay: 20, reviewLimit: 60, showAlgoHint: true },
  streak: { lastDay: "2026-10-31", count: 3 }
}
```

- `cards` 只在"第一次答这道题"时创建（`ensureCard`），没做过的题不占存储。
- 日期键统一用本地时区 `YYYY-MM-DD`（`dayKey(now)`）。

## 4. 艾宾浩斯 SRS 算法（`src/srs.js`）

```js
const BASE_MINUTES = [10, 60, 1440, 2880, 5760, 10080, 21600, 43200, 86400, 172800, 345600];
// 10分钟, 1小时, 1天, 2天, 4天, 7天, 15天, 30天, 60天, 120天, 240天
```

复习阶梯：`level` 0..10。答对升 1 级，答错降 2 级（最低 0）。实际间隔 = `BASE_MINUTES[level] × easeFactor(ease)`，
其中 `easeFactor = clamp(1 + (ease - 2.5) * 0.5, 0.4, 1.15)`，结果四舍五入到分钟，最小 1 分钟。

`ease` 难度因子：初始 2.5，范围 [1.3, 2.8]。
- 答对且当前 `streak >= 1`（即连续第二次答对起）：`ease + 0.06`
- 答对但 `streak == 0`（刚答对第一题）：`ease + 0.03`
- 答错：`ease - 0.2`

一次作答 `review(card, correct, now)` 的完整变更：
1. `last = now`；`history` 追加 `{at: now, c: correct}`，**只保留最近 20 条**。
2. 答对：`reps++`、`streak++`、`level = min(10, level+1)`、ease 见上。
3. 答错：`lapses++`、`streak = 0`、`level = max(0, level-2)`、ease 见上。
4. `due = now + intervalMinutes*60000`。
5. 返回**新对象**（不可变，不修改入参）。

掌握度 `masteryOf(card)` 返回 `{ key, label, pct }`：
- 没有 card / `reps==0 && lapses==0` → `{key:'new', label:'未学', pct:0}`
- `level <= 1` → `{key:'learning', label:'学习中', pct: round(level/10*100)}`（10/20）
- `level 2..4` → `{key:'consolidating', label:'巩固中', pct: round(level/10*100)}`
- `level >= 5` → `{key:'mastered', label:'已掌握', pct: round(level/10*100)}`（≥50，UI 可另做展示）

`nextReviewText(card, now)`：`'—'`（未学）/ `'已到期'`（due<=now）/ `'X 分钟后'` / `'X 小时后'` / `'明天'` / `'X 天后'` / `'X 个月后'`。

导出 API（全部挂在 `globalThis.SRS`）：

| 函数 | 说明 |
|---|---|
| `SRS.BASE_MINUTES` | 常量数组 |
| `SRS.newCard(qid)` | 返回全新 card（`due:null, last:null, level:0, ease:2.5, reps:0, lapses:0, streak:0, history:[]`） |
| `SRS.review(card, correct, now)` | 见上，返回新 card；`correct` 为 boolean；`now` 为毫秒时间戳 |
| `SRS.isDue(card, now)` | `!!card && card.due != null && card.due <= now` |
| `SRS.isNew(card)` | `!card || (card.reps===0 && card.lapses===0)` |
| `SRS.masteryOf(card)` | 见上 |
| `SRS.nextReviewText(card, now)` | 见上 |
| `SRS.intervalMinutes(card)` | 当前 card 的间隔分钟数（无则 0） |
| `SRS.makeQueue(qids, cards, now)` | 返回 `{due:[qid...], fresh:[qid...]}`，due 为到期且非新题（按 due 升序），fresh 为从未作答的题 |

## 5. 存储 API（`src/store.js`）

`Store` 挂在 `globalThis.Store`，所有写操作内部自动 `save()`。

```js
Store.init(storage?)          // 默认用全局 localStorage；不可用时退化为内存 Map（保证 Node 测试可跑）
Store.get()                   // 返回当前 state 对象（只读使用）
Store.card(qid)               // card | undefined
Store.ensureCard(qid)         // 不存在则创建并返回（不保存也可以，record 会保存）
Store.record(qid, correct, now) // 核心：ensureCard → SRS.review → 更新 daily/streak → save
                                // 返回 { card, before }（before 为作答前的 card 或 null）
Store.stats(now)              // 汇总统计，结构见下
Store.favs()                  // number[]
Store.isFav(qid)
Store.toggleFav(qid)          // 返回 boolean（新状态）
Store.dayKey(ts)              // 'YYYY-MM-DD' 本地时区
Store.addSession({type,total,correct,durationMs,at}) // 追加 sessions（上限 200）
Store.settings()              // 设置对象（带默认值）
Store.setSetting(key, value)
Store.exportData()            // 返回 state 的深拷贝 JSON 字符串
Store.importData(jsonText)    // 校验 version，成功返回 true
Store.reset()                 // 清空进度（保留设置可选，直接全清也可）
Store.save()
```

`Store.stats(now)` 返回：

```js
{
  total: 600,                     // 题库总题数（从 QUESTION_BANK 读）
  answered: number,               // 至少作答过一次的题数
  newCount, learningCount, consolidatingCount, masteredCount,  // 互斥、相加=total
  dueCount,                       // due <= now 且非未学
  accuracy,                       // 0..1，累计正确次数/总作答次数（从 history 汇总）
  today: { answered, correct, newLearned },
  streak: number,                 // 连续学习天数
  categories: [{ name, total, answered, accuracy, mastered }],  // 按 QUESTION_BANK 的 category
  daily: [{ date, answered, correct }],  // 最近 14 天，含今天，无记录补 0
  levelDist: [0,0,0,0,0,0,0,0,0,0,0],   // level 0..10 各多少题
  sessions: [...]                  // 最近 sessions
}
```

注意：`Store.stats` 只依赖 `QUESTION_BANK`（若不存在则 total 用 cards 数），不要在 store.js 里写 UI 文案。

## 6. UI 信息架构（Lead 实现，供联调参照）

底部 Tab：**今日 / 题库 / 错题 / 统计**；首页右上角齿轮进设置。

1. **今日**：日期问候、今日待复习 / 新题 / 已掌握环形进度、连续打卡、`开始学习` 主按钮、快捷入口（错题重练、收藏练习、随机 20 题）。
2. **答题页**（全屏，无 Tab）：顶部进度条 + 题号 + 正确率；题型/知识点标签；题干；选项（判断题两大按钮 对/错）；
   选中即判分：正确绿色、错误红色并显示正确答案；底部"下一题"；★ 收藏；算法提示"下次复习：X"。
   一次学习 = 到期复习题 + 新题，答错的题排到本次队列末尾再练一次。
3. **结算页**：正确率、答对/答错、用时、掌握提升、错题回顾、再来一组 / 返回首页。
4. **题库**：搜索 + 题型/知识点筛选 + 全部题目列表（显示掌握状态），点进"单题练习/整组练习"。
5. **错题**：错题本（按错误次数排序）+ 收藏；可"重练本页"。
6. **统计**：掌握分布、复习阶梯分布、近 14 天正确率趋势、知识点正确率、连续打卡、学习记录。
7. **设置**：每日新题上限、复习上限、算法提示开关、导出备份、导入备份、清空进度、关于（数据来源/题量）。

## 7. 交付与验收

- 所有页面在 iPhone 390×844 视口下无横向滚动、点击目标 ≥44px、适配 `safe-area-inset-*`、支持深色模式。
- `node tests/srs.test.js`、`node tests/store.test.js` 全绿。
- `index.html` 直接双击（file://）可用；通过 http(s) 打开时注册 SW 离线可用。
- 提供 `dist/技能鉴定刷题.html` 单文件版（内联全部 CSS/JS/题库/图标），可直接发到 iPhone 用 Safari 打开。
