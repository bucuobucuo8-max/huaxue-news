// 化学智能体学习站 - Service Worker
// 提供离线阅读能力:缓存主页面和静态资源,API 请求降级为缓存优先
const CACHE_NAME = 'chem-agent-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/3dmol@2.0.3/build/3Dmol-min.js',
  'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js',
];

// 安装:预缓存静态资源
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// 激活:清理旧缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// 请求拦截:静态资源缓存优先 / API 网络优先降级缓存 / 页面离线回退
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 跳过非 GET 请求
  if (e.request.method !== 'GET') return;

  // CDN 资源:缓存优先(StaleWhileRevalidate)
  if (url.hostname.includes('cdn.jsdelivr') || url.hostname.includes('pubchem')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(e.request);
        const fetchPromise = fetch(e.request).then(resp => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // API 请求:网络优先,失败降级缓存
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // 页面:网络优先,离线回退缓存
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});
