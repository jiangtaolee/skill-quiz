// 生成文档/展示用截图（干净的演示数据），输出到 docs/screenshots/
// 用法：先在本机 8765 端口起静态服务器，再 node tests/demo_shots.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const PORT = 9334;
const OUT = path.resolve('docs/screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch {}
    await sleep(200);
  }
  return false;
}
function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
  });
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const seedScript = (() => {
  const fn = function () {
    const now = Date.now(), DAY = 86400000;
    const pad = (n) => (n < 10 ? '0' : '') + n;
    const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    const QS = window.QUESTION_BANK.questions;
    const state = {
      version: 1,
      createdAt: now - 12 * DAY,
      updatedAt: now,
      cards: {}, favs: [3, 17, 88, 210, 402],
      daily: {}, sessions: [],
      settings: { newPerDay: 20, reviewLimit: 60, showAlgoHint: true },
      streak: { lastDay: dayKey(now), count: 6 }
    };
    const pattern = [];
    for (let i = 0; i < 46; i++) pattern.push(8);   // 已掌握
    for (let i = 0; i < 38; i++) pattern.push(4);   // 巩固中
    for (let i = 0; i < 26; i++) pattern.push(1);   // 学习中
    for (let i = 0; i < 12; i++) pattern.push(0);   // 学习中（低位）
    const wrongSet = new Set([12, 45, 78, 120, 155, 201, 233, 288, 310, 372, 401, 455]);
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    let qi = 0;
    for (let i = 0; i < pattern.length && i < QS.length; i++) {
      const q = QS[i];
      const level = wrongSet.has(q.id) ? Math.max(0, pattern[qi] - 3) : pattern[qi];
      const lapses = wrongSet.has(q.id) ? 2 + Math.floor(rnd() * 3) : 0;
      const reps = level + 1 + lapses;
      const intervalDays = [0.007, 0.04, 1, 2, 4, 7, 15, 30, 60, 120, 240][level] || 1;
      const due = wrongSet.has(q.id) ? now - Math.floor(rnd() * 3 * DAY) : now + Math.floor((intervalDays * (0.15 + rnd() * 0.5)) * DAY);
      const hist = [];
      const hc = Math.max(2, Math.min(20, reps));
      for (let h = 0; h < hc; h++) hist.push({ at: now - (hc - h) * DAY * 0.6, c: true });
      for (let l = 0; l < Math.min(lapses, 3); l++) hist[hist.length - 1 - l].c = false;
      state.cards[q.id] = {
        qid: q.id, level, ease: 2.5, reps, lapses, streak: wrongSet.has(q.id) ? 0 : reps,
        due, last: now - Math.floor(rnd() * 5 * DAY), history: hist
      };
      qi++;
    }
    for (let d = 13; d >= 1; d--) {
      const answered = 18 + Math.floor(rnd() * 40);
      state.daily[dayKey(now - d * DAY)] = {
        answered, correct: Math.round(answered * (0.62 + rnd() * 0.25)), newLearned: 4 + Math.floor(rnd() * 12)
      };
    }
    state.daily[dayKey(now)] = { answered: 26, correct: 21, newLearned: 8 };
    state.sessions = [
      { at: now - 3 * DAY, type: 'daily', total: 40, correct: 31, durationMs: 1260000 },
      { at: now - 2 * DAY, type: 'wrong', total: 24, correct: 20, durationMs: 760000 },
      { at: now - 1 * DAY, type: 'daily', total: 45, correct: 37, durationMs: 1410000 },
      { at: now - 1 * DAY, type: 'category', total: 20, correct: 15, durationMs: 620000 },
      { at: now - 2 * 3600000, type: 'daily', total: 26, correct: 21, durationMs: 800000 }
    ];
    localStorage.setItem('skillquiz.v1', JSON.stringify(state));
    return Object.keys(state.cards).length;
  };
  return '(' + fn.toString() + ')()';
})();

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-demo-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  if (!(await waitFor(`http://127.0.0.1:${PORT}/json/version`))) { console.error('CDP not up'); process.exit(1); }
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browserWs = await openWs(version.webSocketDebuggerUrl);
  const cdp = new CDP(browserWs);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, S);
  await cdp.send('Runtime.enable', {}, S);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844
  }, S);
  const evalJS = async (expression, awaitPromise = false) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true }, S);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, S);
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('saved', name);
  };
  const go = async (url) => { await cdp.send('Page.navigate', { url }, S); await sleep(1800); };

  await go(BASE + '/index.html');
  await evalJS(`localStorage.clear()`);
  const seeded = await evalJS(seedScript);
  console.log('seeded cards:', seeded);
  await go(BASE + '/index.html');
  await sleep(300);
  await shot('01-today-light');

  // 答题页（未作答）
  await evalJS(`document.querySelector('[data-action="start-daily"]').click()`);
  await sleep(500);
  await shot('02-quiz');

  // 作答后
  await evalJS(`document.querySelectorAll('.opt')[0].click()`);
  await sleep(400);
  await shot('03-quiz-feedback');

  // 判断题
  await evalJS(`document.querySelector('[data-action="quit-quiz"]').click()`);
  await sleep(300);
  if (await evalJS(`!!document.querySelector('.modal-mask')`)) {
    await evalJS(`document.querySelector('[data-action="quit-confirm"]').click()`);
    await sleep(300);
  }
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="bank"]').click()`);
  await sleep(400);
  await evalJS(`document.querySelector('[data-action="bank-type"][data-type="judge"]').click()`);
  await sleep(300);
  await evalJS(`document.querySelector('.q-row').click()`);
  await sleep(300);
  await shot('04-bank-judge');
  await evalJS(`document.querySelector('[data-action="practice-one"]').click()`);
  await sleep(400);
  await shot('05-judge-quiz');
  await evalJS(`document.querySelectorAll('.opt')[0].click()`);
  await sleep(350);
  await shot('06-judge-feedback');
  // 完成本组（答错会排到队尾重练，循环到结算页）
  for (let i = 0; i < 6; i++) {
    if (await evalJS(`!!document.querySelector('.result')`)) break;
    if (await evalJS(`!!document.querySelector('[data-action="next"]')`)) {
      await evalJS(`document.querySelector('[data-action="next"]').click()`);
      await sleep(400);
    } else if (await evalJS(`!!document.querySelector('.opt')`)) {
      await evalJS(`document.querySelectorAll('.opt')[0].click()`);
      await sleep(300);
    } else {
      break;
    }
  }
  await shot('07-result');

  // 题库
  await evalJS(`document.querySelector('[data-action="result-home"]').click()`);
  await sleep(400);
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="bank"]').click()`);
  await sleep(400);
  await evalJS(`document.querySelector('.q-row').click()`);
  await sleep(300);
  await shot('08-bank');

  // 错题
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="wrong"]').click()`);
  await sleep(400);
  await shot('09-wrong');

  // 统计
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="stats"]').click()`);
  await sleep(500);
  await shot('10-stats');

  // 设置 + 导出
  await evalJS(`document.querySelector('[data-action="settings"]').click()`);
  await sleep(400);
  await shot('11-settings');
  await evalJS(`document.querySelector('[data-action="export"]').click()`);
  await sleep(350);
  await shot('12-export');
  await evalJS(`document.querySelector('[data-action="close-modal"]').click()`);
  await sleep(250);

  // 深色
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, S);
  await evalJS(`document.querySelector('[data-action="back"]').click()`);
  await sleep(250);
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="today"]').click()`);
  await sleep(450);
  await shot('13-today-dark');
  await evalJS(`document.querySelector('[data-action="tab"][data-tab="stats"]').click()`);
  await sleep(450);
  await shot('14-stats-dark');

  try { browserWs.close(); } catch {}
  chrome.kill();
  console.log('done');
}
main().catch((e) => { console.error(e); process.exit(1); });
