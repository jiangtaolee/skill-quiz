// E2E smoke test: drives headless Chrome via CDP (no external deps, Node 22+)
// Usage: node tests/e2e.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const PORT = 9333;
const OUT_DIR = path.resolve('tools/shots');
const DSF = 2;
const results = [];
const consoleErrors = [];

function check(name, ok, extra = '') {
  results.push({ name, ok: !!ok, extra: String(extra) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await sleep(200);
  }
  return false;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        const fn = this.handlers.get(msg.method);
        if (fn) fn(msg.params, msg.sessionId);
      }
    });
  }
  on(method, fn) { this.handlers.set(method, fn); }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-quiz-'));

  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-features=Translate', '--mute-audio', 'about:blank'
  ], { stdio: 'ignore' });

  const ok = await waitFor(`http://127.0.0.1:${PORT}/json/version`);
  if (!ok) { console.error('Chrome CDP not reachable'); process.exit(1); }

  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browserWs = await openWs(version.webSocketDebuggerUrl);
  const cdp = new CDP(browserWs);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = sessionId;

  cdp.on('Runtime.exceptionThrown', (p) => {
    consoleErrors.push('EXCEPTION: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'unknown'));
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') consoleErrors.push('console.error: ' + p.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') consoleErrors.push('log: ' + p.entry.text);
  });

  await cdp.send('Page.enable', {}, S);
  await cdp.send('Runtime.enable', {}, S);
  await cdp.send('Log.enable', {}, S);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: DSF, mobile: true,
    screenWidth: 390, screenHeight: 844
  }, S);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, S);

  async function evalJS(expression, awaitPromise = false) {
    const r = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise, userGesture: true
    }, S);
    if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  async function shot(name) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, S);
    fs.writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(data, 'base64'));
  }

  await cdp.send('Page.navigate', { url: BASE + '/index.html' }, S);
  await sleep(2200);

  // ---- 基础布局 ----
  const layout = await evalJS(`(() => {
    const q = (s) => document.querySelector(s);
    const rect = (el) => el ? el.getBoundingClientRect().toJSON() : null;
    return {
      innerWidth, innerHeight,
      dpr: devicePixelRatio,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      appRect: rect(q('#app')),
      tabbarRect: rect(q('#tabbar')),
      tabs: [...document.querySelectorAll('.tab')].map(t => ({ text: t.textContent.trim(), w: Math.round(t.getBoundingClientRect().width), x: Math.round(t.getBoundingClientRect().x) })),
      title: q('.page-title') ? q('.page-title').textContent : null,
      heroRect: rect(q('.hero')),
      heroBtnRect: rect(q('.hero .btn')),
      ringRect: rect(q('.ring')),
      storageKeys: Object.keys(localStorage),
      questionCount: window.QUESTION_BANK ? QUESTION_BANK.questions.length : -1,
      srsLoaded: !!window.SRS,
      storeLoaded: !!window.Store
    };
  })()`);
  console.log('LAYOUT', JSON.stringify(layout, null, 1));

  check('题库 600 题已加载', layout.questionCount === 600, layout.questionCount);
  check('SRS/Store 已加载', layout.srsLoaded && layout.storeLoaded);
  check('无横向溢出', layout.docScrollWidth <= layout.innerWidth && layout.bodyScrollWidth <= layout.innerWidth,
    `scrollWidth=${layout.docScrollWidth} innerWidth=${layout.innerWidth}`);
  check('Tab 栏宽度等于视口', Math.abs(layout.tabbarRect.width - layout.innerWidth) < 1,
    `${layout.tabbarRect.width} vs ${layout.innerWidth}`);
  check('4 个 Tab 均匀排布', layout.tabs.length === 4 && layout.tabs.every((t) => Math.abs(t.w - layout.innerWidth / 4) < 8),
    JSON.stringify(layout.tabs));
  check('Hero 按钮在视口内', layout.heroBtnRect && layout.heroBtnRect.right <= layout.innerWidth,
    `right=${layout.heroBtnRect?.right}`);
  check('掌握环可见', !!layout.ringRect && layout.ringRect.right <= layout.innerWidth,
    `right=${layout.ringRect?.right}`);
  await shot('01-today');

  // ---- 多机型视口 ----
  for (const [w, h] of [[375, 667], [430, 932], [320, 568]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 2, mobile: true, screenWidth: w, screenHeight: h
    }, S);
    await sleep(280);
    const vp = await evalJS(`(() => {
      const hero = document.querySelector('.hero');
      return {
        sw: document.documentElement.scrollWidth, iw: innerWidth,
        tabbar: Math.round(document.querySelector('#tabbar').getBoundingClientRect().width),
        heroRight: hero ? Math.round(hero.getBoundingClientRect().right) : null,
        tabs: document.querySelectorAll('.tab').length
      };
    })()`);
    check(`视口 ${w}×${h} 布局正常`, vp.sw <= w && Math.abs(vp.tabbar - w) < 1 && vp.heroRight !== null && vp.heroRight <= w && vp.tabs === 4, JSON.stringify(vp));
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: DSF, mobile: true, screenWidth: 390, screenHeight: 844
  }, S);
  await sleep(250);

  // ---- 开始学习 ----
  await evalJS(`document.querySelector('[data-action="start-daily"]').click()`);
  await sleep(400);
  const quiz1 = await evalJS(`(() => {
    const body = document.querySelector('.quiz-body');
    return {
      quiz: !!document.querySelector('.quiz'),
      stem: document.querySelector('.stem')?.textContent?.slice(0, 40),
      opts: [...document.querySelectorAll('.opt')].map(o => o.querySelector('.opt-key').textContent),
      count: document.querySelector('.quiz-count')?.textContent,
      tabbarHidden: document.querySelector('#tabbar').hidden,
      scrollWidth: document.documentElement.scrollWidth
    };
  })()`);
  console.log('QUIZ', JSON.stringify(quiz1));
  check('进入答题页', quiz1.quiz && !!quiz1.stem);
  check('答题页隐藏 Tab 栏', quiz1.tabbarHidden === true);
  check('选项渲染完整', quiz1.opts.length >= 2, quiz1.opts.join(','));
  await shot('02-quiz');

  // C 选项点击 -> 判分
  await evalJS(`document.querySelectorAll('.opt')[0].click()`);
  await sleep(350);
  const afterAnswer = await evalJS(`(() => {
    const fb = document.querySelector('.feedback');
    return {
      feedback: fb ? fb.className + ' | ' + fb.textContent.replace(/\\s+/g, ' ').trim() : null,
      correctMarked: document.querySelectorAll('.opt.correct').length,
      wrongMarked: document.querySelectorAll('.opt.wrong').length,
      nextBtn: !!document.querySelector('[data-action="next"]'),
      storage: !!localStorage.getItem('skillquiz.v1')
    };
  })()`);
  console.log('AFTER ANSWER', JSON.stringify(afterAnswer));
  check('判分反馈出现', !!afterAnswer.feedback);
  check('正确选项被标记', afterAnswer.correctMarked === 1);
  check('进入下一题按钮出现', afterAnswer.nextBtn);
  check('学习记录已写入 localStorage', afterAnswer.storage);
  await shot('03-quiz-answered');

  // 键盘/按钮进入下一题
  await evalJS(`document.querySelector('[data-action="next"]').click()`);
  await sleep(300);
  const quiz2 = await evalJS(`document.querySelector('.quiz-count')?.textContent`);
  check('进入下一题', quiz2 && quiz2 !== quiz1.count, `${quiz1.count} -> ${quiz2}`);

  // 收藏当前题
  await evalJS(`document.querySelector('[data-action="fav"]').click()`);
  await sleep(200);
  const favOk = await evalJS(`(() => { const s = JSON.parse(localStorage.getItem('skillquiz.v1')); return s.favs.length; })()`);
  check('收藏写入存储', favOk >= 1, 'favs=' + favOk);

  // 退出答题
  await evalJS(`document.querySelector('[data-action="quit-quiz"]').click()`);
  await sleep(250);
  const quitModal = await evalJS(`!!document.querySelector('.modal-mask')`);
  if (quitModal) {
    await evalJS(`document.querySelector('[data-action="quit-confirm"]').click()`);
    await sleep(300);
  }
  check('退出答题回到首页', await evalJS(`!!document.querySelector('.page-title')`));

  // ---- 题库 ----
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="bank"]').click()`);
  await sleep(350);
  const bank = await evalJS(`(() => ({
    rows: document.querySelectorAll('.q-row').length,
    count: document.querySelector('#bank-count')?.textContent,
    first: document.querySelector('.q-stem')?.textContent?.slice(0, 30),
    scrollWidth: document.documentElement.scrollWidth
  }))()`);
  console.log('BANK', JSON.stringify(bank));
  check('题库列表渲染', bank.rows > 10, 'rows=' + bank.rows);
  await shot('04-bank');

  // 搜索
  await evalJS(`(() => { const i = document.querySelector('#bank-search'); i.value = '加油机'; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(400);
  const search = await evalJS(`({ rows: document.querySelectorAll('.q-row').length, count: document.querySelector('#bank-count')?.textContent })`);
  check('搜索过滤生效', search.rows > 0 && search.rows <= 60 && search.count === '62 题', JSON.stringify(search));
  await evalJS(`(() => { const i = document.querySelector('#bank-search'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(300);

  // 展开题目 + 单题练习
  await evalJS(`document.querySelector('.q-row').click()`);
  await sleep(250);
  const detail = await evalJS(`(() => ({
    open: !!document.querySelector('.q-row.open'),
    opts: document.querySelectorAll('.q-detail .opt-mini').length,
    practice: !!document.querySelector('[data-action="practice-one"]')
  }))()`);
  check('题目详情展开', detail.open && detail.opts >= 2, JSON.stringify(detail));
  await shot('05-bank-detail');
  await evalJS(`document.querySelector('[data-action="practice-one"]').click()`);
  await sleep(350);

  // 单题作答 -> 结算
  await evalJS(`document.querySelectorAll('.opt')[1].click()`);
  await sleep(300);
  await evalJS(`document.querySelector('[data-action="next"]').click()`);
  await sleep(450);
  const result = await evalJS(`(() => ({
    result: !!document.querySelector('.result'),
    ring: document.querySelector('.score-ring-inner b')?.textContent,
    stats: [...document.querySelectorAll('.rs-cell b')].map(b => b.textContent),
    scrollWidth: document.documentElement.scrollWidth,
    reviewItems: document.querySelectorAll('.review-item').length
  }))()`);
  console.log('RESULT', JSON.stringify(result));
  check('结算页出现', result.result === true);
  check('结算页无横向溢出', result.scrollWidth <= 390 + 1, 'scrollWidth=' + result.scrollWidth);
  await shot('06-result');
  await evalJS(`document.querySelector('[data-action="result-home"]').click()`);
  await sleep(350);

  // ---- 判断题（固定 A=对 / B=错）----
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="bank"]').click()`);
  await sleep(300);
  await evalJS(`document.querySelector('[data-action="bank-type"][data-type="judge"]').click()`);
  await sleep(300);
  const judgeFilter = await evalJS(`({ count: document.querySelector('#bank-count')?.textContent, rows: document.querySelectorAll('.q-row').length })`);
  check('判断题筛选', judgeFilter.count === '120 题', JSON.stringify(judgeFilter));
  await evalJS(`document.querySelector('.q-row').click()`);
  await sleep(250);
  const judgeDetail = await evalJS(`(() => {
    const items = [...document.querySelectorAll('.q-detail .opt-mini')].map(o => o.textContent.trim());
    return { items };
  })()`);
  check('判断题选项为 A 对 / B 错', judgeDetail.items.length === 2 && judgeDetail.items[0].includes('A') && judgeDetail.items[0].includes('对') && judgeDetail.items[1].includes('错'), JSON.stringify(judgeDetail.items));
  await shot('05b-bank-judge');
  await evalJS(`document.querySelector('[data-action="practice-one"]').click()`);
  await sleep(300);
  const judgeQuiz = await evalJS(`({ opts: [...document.querySelectorAll('.opt .opt-text')].map(t=>t.textContent), tag: document.querySelector('.quiz-meta .tag')?.textContent, classes: [...document.querySelectorAll('.opt')].map(o=>o.className) })`);
  check('判断题答题页 A=对 B=错', judgeQuiz.opts.length === 2 && judgeQuiz.opts[0] === '对' && judgeQuiz.opts[1] === '错' && judgeQuiz.tag === '判断题', JSON.stringify(judgeQuiz));
  await shot('05c-judge-quiz');
  await evalJS(`document.querySelector('[data-action="quit-quiz"]').click()`);
  await sleep(250);
  if (await evalJS(`!!document.querySelector('.modal-mask')`)) {
    await evalJS(`document.querySelector('[data-action="quit-confirm"]').click()`);
    await sleep(250);
  }

  // ---- 错题 ----
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="wrong"]').click()`);
  await sleep(350);
  const wrongView = await evalJS(`({ title: document.querySelector('.page-title')?.textContent, rows: document.querySelectorAll('.q-row').length, chips: [...document.querySelectorAll('.chip')].map(c=>c.textContent.trim()) })`);
  console.log('WRONG', JSON.stringify(wrongView));
  check('错题页渲染', !!wrongView.title);
  await shot('07-wrong');

  // ---- 统计 ----
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="stats"]').click()`);
  await sleep(400);
  const statsView = await evalJS(`(() => ({
    title: document.querySelector('.page-title')?.textContent,
    donut: !!document.querySelector('.donut'),
    charts: document.querySelectorAll('.chart-bar').length,
    catRows: document.querySelectorAll('.cat-row').length,
    sessions: document.querySelectorAll('.session-row').length,
    futurePlan: [...document.querySelectorAll('.card-title')].some(t => t.textContent.includes('未来 7 天')),
    scrollWidth: document.documentElement.scrollWidth
  }))()`);
  console.log('STATS', JSON.stringify(statsView));
  check('统计页渲染', statsView.donut && statsView.charts > 10, JSON.stringify(statsView));
  check('未来 7 天复习计划', statsView.futurePlan === true);
  check('统计页无横向溢出', statsView.scrollWidth <= 391, 'scrollWidth=' + statsView.scrollWidth);
  await shot('08-stats');

  // 知识点专项练习
  await evalJS(`document.querySelector('.cat-row').click()`);
  await sleep(350);
  const catQuiz = await evalJS(`({ quiz: !!document.querySelector('.quiz'), tag: document.querySelector('.quiz-meta .tag.gray')?.textContent })`);
  check('知识点专项练习可进入', catQuiz.quiz === true, JSON.stringify(catQuiz));
  await shot('08b-cat-quiz');
  await evalJS(`document.querySelector('[data-action="quit-quiz"]').click()`);
  await sleep(250);
  if (await evalJS(`!!document.querySelector('.modal-mask')`)) {
    await evalJS(`document.querySelector('[data-action="quit-confirm"]').click()`);
    await sleep(300);
  }

  // ---- 设置 ----
  await evalJS(`document.querySelector('[data-action="settings"]')?.click()`);
  await sleep(350);
  const settingsView = await evalJS(`({ title: document.querySelector('.page-title')?.textContent, groups: document.querySelectorAll('.set-group').length })`);
  check('设置页打开', settingsView.groups >= 3, JSON.stringify(settingsView));
  await shot('09-settings');

  // 设置：每日新题上限
  await evalJS(`document.querySelector('[data-action="set-new"][data-val="30"]').click()`);
  await sleep(250);
  const newPerDay = await evalJS(`JSON.parse(localStorage.getItem('skillquiz.v1')).settings.newPerDay`);
  check('设置写回存储', newPerDay === 30, 'newPerDay=' + newPerDay);

  // 导出弹层
  await evalJS(`document.querySelector('[data-action="export"]').click()`);
  await sleep(300);
  const exp = await evalJS(`({ open: !!document.querySelector('.modal-mask'), len: document.querySelector('#backup-text')?.value?.length || 0 })`);
  check('导出备份弹层', exp.open && exp.len > 100, JSON.stringify(exp));
  await shot('10-export');
  const backupText = await evalJS(`document.querySelector('#backup-text')?.value || ''`);
  await evalJS(`document.querySelector('[data-action="close-modal"]').click()`);
  await sleep(200);

  // ---- 导入备份（用刚导出的内容回灌）----
  await evalJS(`document.querySelector('[data-action="import"]').click()`);
  await sleep(300);
  await evalJS(`(() => { const ta = document.querySelector('#import-text'); ta.value = ${JSON.stringify(backupText)}; })()`);
  await evalJS(`document.querySelector('[data-action="do-import"]').click()`);
  await sleep(400);
  const imported = await evalJS(`(() => { const s = JSON.parse(localStorage.getItem('skillquiz.v1')); return { cards: Object.keys(s.cards).length, favs: s.favs.length, view: !!document.querySelector('.page-title') }; })()`);
  check('导入备份恢复数据', imported.cards > 0 && imported.favs > 0 && imported.view, JSON.stringify(imported));

  // ---- 深色模式 ----
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, S);
  await sleep(400);
  const darkBg = await evalJS(`getComputedStyle(document.body).backgroundColor`);
  check('深色模式生效', darkBg !== 'rgb(242, 244, 249)', darkBg);
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="today"]').click()`);
  await sleep(300);
  await shot('11-dark-today');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, S);
  await sleep(200);

  // ---- 刷新后数据仍在 ----
  await cdp.send('Page.reload', {}, S);
  await sleep(1500);
  const persisted = await evalJS(`(() => {
    const s = JSON.parse(localStorage.getItem('skillquiz.v1'));
    return { cards: Object.keys(s.cards).length, favs: s.favs.length, sessions: s.sessions.length, tab: !!document.querySelector('.tab.on') };
  })()`);
  check('刷新后数据持久化', persisted.cards > 0 && persisted.favs > 0, JSON.stringify(persisted));
  await shot('12-today-after-reload');

  // ---- 清空进度 ----
  await evalJS(`document.querySelector('[data-action="settings"]').click()`);
  await sleep(300);
  await evalJS(`document.querySelector('[data-action="reset"]').click()`);
  await sleep(250);
  await evalJS(`document.querySelector('[data-action="confirm-reset"]').click()`);
  await sleep(400);
  const cleared = await evalJS(`(() => { const s = JSON.parse(localStorage.getItem('skillquiz.v1')); return { cards: Object.keys(s.cards).length, favs: s.favs.length, title: !!document.querySelector('.page-title') }; })()`);
  check('清空进度生效', cleared.cards === 0 && cleared.favs === 0 && cleared.title, JSON.stringify(cleared));

  // ---- 离线/Service Worker ----
  const swState = await evalJS(`(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    try { const reg = await navigator.serviceWorker.getRegistration(); return reg ? (reg.active ? 'active' : (reg.installing ? 'installing' : 'registered')) : 'none'; }
    catch (e) { return 'error:' + e.message; }
  })()`, true);
  console.log('SW', swState);
  check('Service Worker 已注册', ['active', 'installing', 'registered'].includes(swState), swState);

  // ---- 离线可用 ----
  await cdp.send('Network.enable', {}, S);
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, S);
  await cdp.send('Page.reload', {}, S);
  await sleep(2000);
  const offline = await evalJS(`(() => ({
    title: document.querySelector('.page-title')?.textContent || null,
    tabs: document.querySelectorAll('.tab').length,
    storageOk: !!localStorage.getItem('skillquiz.v1')
  }))()`);
  console.log('OFFLINE', JSON.stringify(offline));
  check('断网刷新后仍可打开', !!offline.title && offline.tabs === 4, JSON.stringify(offline));
  await shot('13-offline');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, S);
  await sleep(400);

  // ---- 控制台错误 ----
  check('无 JS 运行时错误', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 500));

  fs.writeFileSync(path.join(OUT_DIR, 'e2e-report.json'), JSON.stringify({ results, consoleErrors, layout, quiz1, result, statsView }, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== E2E: ${results.length - failed.length}/${results.length} passed ====`);
  if (consoleErrors.length) console.log('CONSOLE ERRORS:\n' + consoleErrors.join('\n'));

  try { await cdp.send('Target.closeTarget', { targetId }); } catch {}
  try { browserWs.close(); } catch {}
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('E2E CRASH', e); process.exit(1); });
