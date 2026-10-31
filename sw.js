/* ============================================================================
 * 技能鉴定刷题 — Service Worker（离线缓存）
 * ----------------------------------------------------------------------------
 * 版本策略（重要）：
 *   1. 每次修改 index.html / styles/*.css / src/*.js / icons/* 等任何静态资源，
 *      都要把下面的 CACHE_VERSION 改成一个新值（v1 → v2 → v3……或用日期 v20261031）。
 *      当前最终值：'skillquiz-v20261031'（2026-10-31 首次交付版本）。
 *   2. 旧版本缓存会在 activate 阶段自动删除，用户下次打开就是新版本。
 *   3. 不要手改 CACHE_PREFIX；它用来区分本应用的缓存与本域名下其它应用的缓存
 *      （部署在子目录时也不会误删别人的缓存）。
 *   4. 所有路径都用相对路径（'./' 开头），因此整个文件夹放到任意子目录
 *      （如 https://example.com/skillquiz/）都能正常工作。
 *
 * 离线策略：
 *   - install：逐个预缓存核心文件；单个文件失败只警告、不中断整次安装；
 *              最后 skipWaiting()，让新 SW 尽快接管。
 *   - activate：删除所有「本应用前缀 + 非当前版本」的缓存，然后 clients.claim()。
 *   - fetch：只处理同源 GET；缓存优先，缓存缺失时回源并写入缓存；
 *            页面导航请求失败时回退到缓存的 './index.html'。
 * ========================================================================== */

const CACHE_VERSION = 'skillquiz-v20261031';
const CACHE_PREFIX = 'skillquiz-';

/* 预缓存清单：应用运行所需的最小完整集合 */
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles/app.css',
  './src/questions.js',
  './src/srs.js',
  './src/store.js',
  './src/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

/* ---------------------------------------------------------------- install */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);

      // 逐个 add：任何一个失败都不影响其它文件，也不阻断安装（离线降级）
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(url);
          } catch (err) {
            console.warn('[sw] 预缓存失败，已跳过（不影响其它文件）:', url, err);
          }
        })
      );

      // 新 SW 立即进入 waiting -> activating，尽快接管页面
      await self.skipWaiting();
    })()
  );
});

/* --------------------------------------------------------------- activate */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          // 只清「本应用」的旧版本缓存，不动同域名下其它应用的缓存
          if (key !== CACHE_VERSION && key.startsWith(CACHE_PREFIX)) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      );

      // 让已经打开的页面也立刻归本 SW 管理
      await self.clients.claim();
    })()
  );
});

/* ------------------------------------------------------------------ fetch */

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 只处理同源的 GET 请求
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  event.respondWith(handleFetch(request));
});

async function handleFetch(request) {
  const cache = await caches.open(CACHE_VERSION);

  // 1) 缓存优先
  const cached = await cache.match(request);
  if (cached) return cached;

  // 2) 缓存没有 -> 回源，并把成功的同源响应写入缓存
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      // 复制一份再写缓存，避免消费掉返回给页面的响应体
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    // 3) 断网/回源失败：导航请求回退到缓存的首页
    if (request.mode === 'navigate') {
      const fallback =
        (await cache.match('./index.html')) || (await cache.match('./'));
      if (fallback) return fallback;
    }
    throw err;
  }
}
