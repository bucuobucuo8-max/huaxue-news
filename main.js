/* =========================
   前景新闻渲染与筛选
   数据来源优先级: /api/v1/news(结构化API) > /api/news.json(本地API) > 内联数据(data.js)
   功能: 访客追踪 + 收藏 + 排行榜
   ========================= */
const masonryEl = document.getElementById("masonry");
const emptyEl = document.getElementById("emptyState");
const favEmptyEl = document.getElementById("favEmptyState");
const heroStatsEl = document.getElementById("heroStats");
const rankingCarouselEl = document.getElementById("rankingCarousel");

let newsData = NEWS;
let categoryLabels = CATEGORY_LABEL;
let dataSource = "inline";
let bannerImageUrl = "";
let currentFilter = "all";

// ===== 访客ID =====
function getVisitorId() {
  let id = localStorage.getItem("visitor_id");
  if (!id) {
    id = 'v-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("visitor_id", id);
  }
  return id;
}
const VISITOR_ID = getVisitorId();

// ===== 收藏管理 =====
function getLocalFavorites() {
  try { return JSON.parse(localStorage.getItem("favorites") || "[]"); } catch { return []; }
}
function saveLocalFavorites(favs) {
  localStorage.setItem("favorites", JSON.stringify(favs));
}
function isFavorited(title) {
  return getLocalFavorites().some(f => f.title === title);
}
async function toggleFavorite(item) {
  const favs = getLocalFavorites();
  const idx = favs.findIndex(f => f.title === item.title);
  if (idx >= 0) {
    // 取消收藏(仅从本地移除)
    favs.splice(idx, 1);
    saveLocalFavorites(favs);
  } else {
    // 添加收藏
    favs.push({ title: item.title, url: item.url, source: item.source, type: item.type, summary: item.summary });
    saveLocalFavorites(favs);
    // 同步到D1数据库
    try {
      await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor_id: VISITOR_ID,
          news_title: item.title,
          news_url: item.url,
          news_source: item.source,
          news_type: item.type,
          news_summary: item.summary,
        }),
      });
    } catch (e) { console.log("收藏同步失败", e); }
    // 刷新排行榜
    loadRanking();
  }
  // 更新UI
  updateFavoriteButtons();
  if (currentFilter === "favorites") renderNews("favorites");
}
function updateFavoriteButtons() {
  document.querySelectorAll(".fav-btn").forEach(btn => {
    const title = btn.dataset.title;
    btn.classList.toggle("favorited", isFavorited(title));
  });
}

// ===== 访客追踪 =====
async function trackVisitor() {
  try {
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor_id: VISITOR_ID,
        page: window.location.pathname,
        referrer: document.referrer || "",
      }),
    });
  } catch (e) { console.log("追踪失败", e); }
}

// ===== 排行榜(垂直滚动,每次显示3条) =====
let rankingTimer = null;
let rankingPos = 0;
async function loadRanking() {
  try {
    const resp = await fetch("/api/ranking");
    if (!resp.ok) { rankingCarouselEl.innerHTML = '<div class="ranking-loading">暂无排行数据</div>'; return; }
    const json = await resp.json();
    const items = json.data || [];
    if (items.length === 0) {
      rankingCarouselEl.innerHTML = '<div class="ranking-loading">暂无收藏数据,收藏新闻后这里会显示排行榜</div>';
      return;
    }
    // 渲染所有条目
    rankingCarouselEl.innerHTML = items.map((item, i) => {
      const rank = item.rank || i + 1;
      const isTop3 = rank <= 3;
      const titleClass = isTop3 ? `ranking-title top${rank}` : "ranking-title";
      const flameHtml = isTop3 ? '<span class="flame-icon"></span>' : '';
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
      return `
        <div class="ranking-card ${isTop3 ? 'top3' : ''}">
          <div class="ranking-rank">${medal}</div>
          <div class="ranking-body">
            ${flameHtml}
            <a class="${titleClass}" href="${item.news_url || '#'}" target="_blank" rel="noopener">${item.news_title}</a>
            <div class="ranking-meta">
              <span class="ranking-source">${item.news_source || ''}</span>
              <span class="ranking-count">♡ ${item.favorite_count}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    // 启动自动滚动
    if (rankingTimer) clearInterval(rankingTimer);
    rankingPos = 0;
    rankingCarouselEl.style.transform = 'translateY(0)';
    if (items.length > 3) {
      rankingTimer = setInterval(() => {
        rankingPos++;
        if (rankingPos > items.length - 3) rankingPos = 0;
        rankingCarouselEl.style.transform = `translateY(-${rankingPos * 88}px)`;
      }, 3000);
    }
  } catch (e) {
    rankingCarouselEl.innerHTML = '<div class="ranking-loading">排行榜加载失败</div>';
  }
}

// ===== API 数据加载 =====
const API_V1 = "/api/v1/news";
const API_LOCAL = "/api/news.json";

async function loadNewsData() {
  try {
    const resp = await fetch(API_V1);
    if (resp.ok) {
      const json = await resp.json();
      if (json.code === 200 && json.news && json.news.length > 0) {
        newsData = json.news.map(n => ({ ...n, type: n.category.key }));
        const catLabels = {};
        Object.keys(json.categories).forEach(k => { catLabels[k] = json.categories[k].label; });
        categoryLabels = catLabels;
        dataSource = json.meta.source || "live-json-api";
        bannerImageUrl = json.meta.bannerImage || "";
        return;
      }
    }
  } catch (e) {}
  try {
    const resp = await fetch(API_LOCAL);
    if (resp.ok) {
      const json = await resp.json();
      if (json.code === 200 && json.data && json.data.news) {
        newsData = json.data.news;
        categoryLabels = json.data.categories || CATEGORY_LABEL;
        dataSource = "local-api";
        return;
      }
    }
  } catch (e) {}
  dataSource = "inline";
}

function formatToday() {
  const now = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 星期${week}`;
}

function renderStats() {
  const total = newsData.length;
  const importantCount = newsData.filter(item => item.important).length;
  const counts = { award: 0, product: 0, company: 0, research: 0 };
  newsData.forEach(item => { if (counts[item.type] !== undefined) counts[item.type]++; });
  const maxCount = Math.max(...Object.values(counts), 1);
  const sourceLabel = dataSource.includes("json") ? "实时JSON API" : dataSource === "local-api" ? "本地API" : "内置数据";
  heroStatsEl.innerHTML = `
    <div class="stats-date">${formatToday()}</div>
    <div class="stats-numbers">
      <div class="stat-box"><div class="stat-label">新闻总数</div><div class="stat-num">${total}</div></div>
      <div class="stat-box important"><div class="stat-label">重要事件</div><div class="stat-num">${importantCount}</div></div>
    </div>
    <div class="stats-chart">
      ${Object.keys(counts).map(key => `
        <div class="chart-row">
          <span class="chart-label">${categoryLabels[key] || key}</span>
          <div class="chart-bar"><div class="chart-fill ${key}" style="width:${(counts[key] / maxCount * 100).toFixed(0)}%"></div></div>
          <span class="chart-val">${counts[key]}</span>
        </div>
      `).join("")}
    </div>
    <div style="margin-top:12px;font-size:11px;color:rgba(210,232,255,0.4);text-align:center;">数据来源:${sourceLabel}</div>
  `;
}

const BENZENE_SVG = `
  <svg class="molecule-deco" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <polygon points="50,10 86,30 86,70 50,90 14,70 14,30" fill="none" stroke="#fb7185" stroke-width="2"/>
    <circle cx="50" cy="10" r="6" fill="#fb7185"/><circle cx="86" cy="30" r="6" fill="#fb7185"/>
    <circle cx="86" cy="70" r="6" fill="#fb7185"/><circle cx="50" cy="90" r="6" fill="#fb7185"/>
    <circle cx="14" cy="70" r="6" fill="#fb7185"/><circle cx="14" cy="30" r="6" fill="#fb7185"/>
  </svg>
`;

// 收藏按钮 - 使用data-index避免特殊字符问题
let newsIndexMap = {};
function favBtnHtml(item, index) {
  const fav = isFavorited(item.title);
  return `<button class="fav-btn ${fav ? 'favorited' : ''}" data-index="${index}">${fav ? '♥' : '♡'}</button>`;
}

function newsTemplate(item, index) {
  const layoutClass = `story story-${index}`;
  const tagHtml = `<span class="story-tag ${item.type}">${categoryLabels[item.type] || item.type}</span>`;
  const importantHtml = item.important ? `<span class="story-important">重要</span>` : "";
  const decoHtml = item.important ? BENZENE_SVG : "";
  const favHtml = favBtnHtml(item, index);

  if (index === 0) {
    return `
      <article class="${layoutClass}" data-type="${item.type}">
        ${decoHtml}${favHtml}
        <div class="story-meta-line"><span class="story-time">${item.time}</span>${tagHtml}${importantHtml}</div>
        <h2 class="story-title-xl">${item.title}</h2>
        <p class="story-summary-lg">${item.summary}</p>
        <div class="story-foot"><span class="story-source">${item.source}</span><a class="story-link" href="${item.url}" target="_blank" rel="noopener noreferrer">阅读全文 ↗</a></div>
      </article>`;
  } else if (index === 1) {
    return `
      <article class="${layoutClass}" data-type="${item.type}">
        ${favHtml}
        <div class="story-meta-line"><span class="story-time">${item.time}</span>${tagHtml}</div>
        <h2 class="story-title-md">${item.title}</h2>
        <p class="story-summary">${item.summary}</p>
        <div class="story-foot"><span class="story-source">${item.source}</span><a class="story-link" href="${item.url}" target="_blank" rel="noopener noreferrer">阅读全文 ↗</a></div>
      </article>`;
  } else if (index === 2) {
    return `
      <article class="${layoutClass}" data-type="${item.type}">
        ${favHtml}
        <div class="story-meta-line"><span class="story-time">${item.time}</span>${tagHtml}</div>
        <h2 class="story-title-md">${item.title}</h2>
        <p class="story-summary">${item.summary}</p>
        <div class="story-foot"><span class="story-source">${item.source}</span><a class="story-link" href="${item.url}" target="_blank" rel="noopener noreferrer">阅读全文 ↗</a></div>
      </article>`;
  } else if (index === 3) {
    return `
      <article class="${layoutClass}" data-type="${item.type}">
        ${favHtml}
        <div class="story-split">
          <div class="story-split-left"><div class="story-meta-line"><span class="story-time">${item.time}</span>${tagHtml}</div><h2 class="story-title-md">${item.title}</h2></div>
          <div class="story-split-right"><p class="story-summary">${item.summary}</p><div class="story-foot"><span class="story-source">${item.source}</span><a class="story-link" href="${item.url}" target="_blank" rel="noopener noreferrer">阅读全文 ↗</a></div></div>
        </div>
      </article>`;
  } else {
    return `
      <article class="${layoutClass}" data-type="${item.type}">
        ${favHtml}
        <div class="story-meta-line"><span class="story-time">${item.time}</span>${tagHtml}</div>
        <h2 class="story-title-sm">${item.title}</h2>
        <p class="story-summary">${item.summary}</p>
        <div class="story-foot"><span class="story-source">${item.source}</span><a class="story-link" href="${item.url}" target="_blank" rel="noopener noreferrer">阅读全文 ↗</a></div>
      </article>`;
  }
}

function renderNews(filter = "all") {
  currentFilter = filter;
  let list;
  if (filter === "favorites") {
    const favs = getLocalFavorites();
    list = favs.map(f => ({ ...f, time: "★", important: false }));
  } else {
    list = filter === "all" ? newsData : newsData.filter(item => item.type === filter);
  }
  // 存储到索引映射,供收藏按钮使用
  newsIndexMap = {};
  list.forEach((item, i) => { newsIndexMap[i] = item; });
  masonryEl.innerHTML = list.map((item, i) => newsTemplate(item, i)).join("");
  emptyEl.style.display = (filter !== "favorites" && list.length === 0) ? "block" : "none";
  favEmptyEl.style.display = (filter === "favorites" && list.length === 0) ? "block" : "none";
}

// 事件委托:收藏按钮点击
masonryEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".fav-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const index = parseInt(btn.dataset.index);
  const item = newsIndexMap[index];
  if (item) {
    toggleFavorite(item);
  }
});

// 筛选按钮
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderNews(btn.dataset.filter);
  });
});

// 初始化
(async function init() {
  await loadNewsData();
  renderStats();
  renderNews("all");
  trackVisitor();
  loadRanking();
})();
