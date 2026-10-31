// 单文件版（file://）验证：确认不发起任何相对资源请求、渲染正常、无 JS 错误
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const FILE = path.resolve('dist/技能鉴定刷题.html');
const OUT = path.resolve('tools/shots/15-dist-file.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const requests = [];

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
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method && this.handlers.has(m.method)) this.handlers.get(m.method)(m.params);
    });
  }
  on(m, f) { this.handlers.set(m, f); }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

async function main() {
  if (!fs.existsSync(FILE)) { console.error('dist 不存在：' + FILE); process.exit(1); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-dist-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  if (!(await waitFor(`http://127.0.0.1:${PORT}/json/version`))) { console.error('CDP 未就绪'); process.exit(1); }
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const cdp = new CDP(await openWs(version.webSocketDebuggerUrl));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  cdp.on('Runtime.exceptionThrown', (p) => errors.push('EXCEPTION: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)));
  cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push('console.error: ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ')); });
  cdp.on('Network.requestWillBeSent', (p) => requests.push(p.request.url));
  cdp.on('Network.loadingFailed', (p) => { if (!p.canceled) errors.push('loadingFailed: ' + p.errorText + ' ' + (p.type || '')); });
  await cdp.send('Page.enable', {}, S);
  await cdp.send('Runtime.enable', {}, S);
  await cdp.send('Network.enable', {}, S);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 }, S);
  const url = pathToFileURL(FILE).href;
  await cdp.send('Page.navigate', { url }, S);
  await sleep(2500);

  const info = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const q = (s) => document.querySelector(s);
      return {
        title: document.title,
        pageTitle: q('.page-title')?.textContent,
        total: window.QUESTION_BANK?.questions?.length,
        srs: !!window.SRS, store: !!window.Store,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
        tabs: document.querySelectorAll('.tab').length,
        scripts: [...document.scripts].map(s => s.src || 'inline'),
        styleCount: document.querySelectorAll('style').length,
        storageWorks: (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch (e) { return false; } })()
      };
    })()`, returnByValue: true
  }, S).then((r) => r.result.value);
  console.log('INFO', JSON.stringify(info));

  check('单文件可打开并渲染', !!info.pageTitle, info.pageTitle);
  check('题库 600 题内联', info.total === 600, info.total);
  check('SRS/Store 内联可用', info.srs && info.store);
  check('无横向溢出', info.scrollWidth <= info.innerWidth, `${info.scrollWidth}/${info.innerWidth}`);
  check('4 个 Tab 正常', info.tabs === 4, info.tabs);
  check('脚本全部内联', info.scripts.every((s) => s === 'inline'), JSON.stringify(info.scripts));
  check('CSS 已内联', info.styleCount >= 1, info.styleCount);
  check('file:// 下 localStorage 可用', info.storageWorks === true);
  const external = requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:'));
  check('无任何外部网络请求', external.length === 0, external.join(', '));
  check('无 JS 运行时错误', errors.length === 0, errors.join(' | ').slice(0, 400));

  // 交互冒烟：开始学习 → 答题
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="start-daily"]').click()`, userGesture: true }, S);
  await sleep(500);
  const quiz = await cdp.send('Runtime.evaluate', {
    expression: `({ quiz: !!document.querySelector('.quiz'), opts: document.querySelectorAll('.opt').length, count: document.querySelector('.quiz-count')?.textContent })`,
    returnByValue: true
  }, S).then((r) => r.result.value);
  check('单文件答题流程可用', quiz.quiz && quiz.opts >= 2, JSON.stringify(quiz));
  await cdp.send('Runtime.evaluate', { expression: `document.querySelectorAll('.opt')[0].click()`, userGesture: true }, S);
  await sleep(400);
  const fb = await cdp.send('Runtime.evaluate', { expression: `!!document.querySelector('.feedback')`, returnByValue: true }, S).then((r) => r.result.value);
  check('单文件判分可用', fb === true);

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, S);
  fs.writeFileSync(OUT, Buffer.from(data, 'base64'));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== DIST file:// : ${results.length - failed.length}/${results.length} passed ====`);
  console.log('requests:', JSON.stringify(requests));
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
  try { cdp.ws.close(); } catch {}
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
