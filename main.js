/* =========================
   前景新闻渲染与筛选
   数据来源: /api/v1/news(实时API,聚合 GDELT/Crossref/OpenAlex/PubMed)
   功能: 访客追踪 + 收藏 + 排行榜 + AI翻译/推荐
   ========================= */
const masonryEl = document.getElementById("masonry");
const emptyEl = document.getElementById("emptyState");
const favEmptyEl = document.getElementById("favEmptyState");
const heroStatsEl = document.getElementById("heroStats");
const rankingCarouselEl = document.getElementById("rankingCarousel");

let newsData = [];
let categoryLabels = CATEGORY_LABEL;
let dataSource = "live-json-api";
let bannerImageUrl = "";
let currentFilter = "all";
let activeFilters = new Set(); // 多选筛选集合

// ===== AI 翻译(localStorage 缓存,点击单个标题右侧按钮时翻译该标题) =====
const aiGridEl = document.getElementById("aiGrid");
const aiGenBtn = document.getElementById("aiGenBtn");
const aiDescEl = document.getElementById("aiDesc");
const aiBriefBtn = document.getElementById("aiBriefBtn");
const aiTagsBtn = document.getElementById("aiTagsBtn");
const aiBriefBox = document.getElementById("aiBriefBox");
const aiTagCloud = document.getElementById("aiTagCloud");
const aiSearchInput = document.getElementById("aiSearchInput");
const aiSearchBtn = document.getElementById("aiSearchBtn");
const aiSearchClear = document.getElementById("aiSearchClear");

// 解读缓存与展开状态
let explainCache = {};
try { explainCache = JSON.parse(localStorage.getItem("ai_explains") || "{}"); } catch { explainCache = {}; }
function saveExplainCache() {
  localStorage.setItem("ai_explains", JSON.stringify(explainCache));
}
const expandedExplains = new Set(); // 记录哪些标题的解读面板处于展开状态

// 语义搜索状态:null=未激活;数组=匹配的新闻下标(按相关度排序)
let searchIndices = null;
let searchQueryText = "";
let translationCache = {};
const CACHE_VERSION = "v2"; // 版本号,改了会清掉旧的全量翻译缓存
try {
  const raw = localStorage.getItem("ai_translations");
  const parsed = raw ? JSON.parse(raw) : null;
  if (parsed && parsed.__version === CACHE_VERSION) {
    translationCache = parsed.data || {};
  } else {
    // 旧版缓存(全局翻译)已废弃,清空
    translationCache = {};
    localStorage.removeItem("ai_translations");
  }
} catch { translationCache = {}; }
function saveTranslationCache() {
  localStorage.setItem("ai_translations", JSON.stringify({ __version: CACHE_VERSION, data: translationCache }));
}
// 判断是否为英文标题(无中文字符且含拉丁字母)
function isEnglishTitle(title) {
  return !/[\u4e00-\u9fa5]/.test(title) && /[a-zA-Z]/.test(title);
}
// 记录每个标题当前是否显示中文(true=中文,false=原文)
const translatedState = new Set();
// 获取展示用标题:根据 translatedState 决定显示中文还是原文
function displayName(item) {
  if (translatedState.has(item.title) && translationCache[item.title]) {
    return translationCache[item.title];
  }
  return item.title;
}
// 标题右侧的翻译按钮(仅英文标题显示)
function translateBtnHtml(item) {
  if (!isEnglishTitle(item.title)) return "";
  const isZh = translatedState.has(item.title) && translationCache[item.title];
  const label = isZh ? "原文" : "译";
  const title = isZh ? "显示英文原文" : "AI 翻译该标题";
  const cls = isZh ? "translate-btn translated" : "translate-btn";
  return `<button class="${cls}" data-title="${encodeURIComponent(item.title)}" title="${title}">${label}</button>`;
}
// 卡片底部的 AI 解读按钮
function explainBtnHtml(item) {
  const expanded = expandedExplains.has(item.title);
  const label = expanded ? "收起解读" : "✨ AI 解读";
  return `<button class="explain-btn" data-title="${encodeURIComponent(item.title)}" title="DeepSeek 通俗解读">${label}</button>`;
}
// 解读面板内容(展开且有缓存时渲染)
function explainPanelHtml(item) {
  if (!expandedExplains.has(item.title)) return "";
  const text = explainCache[item.title];
  if (!text) return "";
  return `<div class="explain-panel">${text}</div>`;
}

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
function toggleFavorite(item) {
  const favs = getLocalFavorites();
  const idx = favs.findIndex(f => f.title === item.title);
  if (idx >= 0) {
    // 取消收藏:本地移除 + 后台同步D1
    favs.splice(idx, 1);
    saveLocalFavorites(favs);
    fetch("/api/favorites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor_id: VISITOR_ID,
        news_title: item.title,
      }),
    }).then(() => loadRanking()).catch(() => {});
  } else {
    favs.push({ title: item.title, url: item.url, source: item.source, type: item.type, summary: item.summary });
    saveLocalFavorites(favs);
    // 后台同步到D1,不阻塞UI
    fetch("/api/favorites", {
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
    }).then(() => loadRanking()).catch(() => {});
  }
  // 立即更新UI
  updateFavoriteButtons();
  renderStats(); // 统计面板同步(收藏项会并入计数)
  lastAIIndices = []; // 收藏偏好变了,清空推荐缓存,下次点推荐重新生成
  recommendVisible = false;
  aiGenBtn.textContent = "根据我的收藏生成推荐";
  aiDescEl.textContent = AI_DESC_DEFAULT;
  aiGridEl.innerHTML = "";
  if (currentFilter === "favorites") renderNews("favorites");
  else renderNews(currentFilter); // 收藏的旧新闻增删会影响"全部"列表
}
function updateFavoriteButtons() {
  document.querySelectorAll(".fav-btn").forEach(btn => {
    const index = parseInt(btn.dataset.index);
    const item = newsIndexMap[index];
    if (item) {
      const fav = isFavorited(item.title);
      btn.classList.toggle("favorited", fav);
      btn.textContent = fav ? '♥' : '♡';
    }
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

// ===== 排行榜(垂直滚动,每次显示3条,包含0收藏新闻) =====
let rankingTimer = null;
let rankingPos = 0;
async function loadRanking() {
  try {
    // 获取排行榜数据(已收藏的)
    const resp = await fetch("/api/ranking");
    let rankedItems = [];
    if (resp.ok) {
      const json = await resp.json();
      rankedItems = json.data || [];
    }

    // 合并当前新闻数据(0收藏的也显示)
    const rankedTitles = new Set(rankedItems.map(i => i.news_title));
    const unrankedNews = newsData
      .filter(n => !rankedTitles.has(n.title))
      .map(n => ({
        news_title: n.title,
        news_url: n.url || '',
        news_source: n.source || '',
        news_type: n.type || '',
        favorite_count: 0,
      }));

    // 合并并排序:有收藏的在前,0收藏的在后,取前10
    const allItems = [...rankedItems, ...unrankedNews].slice(0, 10);
    if (allItems.length === 0) {
      rankingCarouselEl.innerHTML = '<div class="ranking-loading">暂无新闻数据</div>';
      return;
    }

    // 渲染所有条目到内层滚动容器
    const cardsHtml = allItems.map((item, i) => {
      const rank = i + 1;
      const isTop3 = rank <= 3;
      const titleClass = isTop3 ? `ranking-title top${rank}` : "ranking-title";
      const flameHtml = isTop3 ? '<span class="flame-icon"></span>' : '';
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
      // 翻译:复用统一缓存与按钮逻辑
      const rankItem = { title: item.news_title };
      const displayTitle = displayName(rankItem);
      const transBtn = translateBtnHtml(rankItem);
      return `
        <div class="ranking-card ${isTop3 ? 'top3' : ''}">
          <div class="ranking-rank">${medal}</div>
          <div class="ranking-body">
            ${flameHtml}
            <a class="${titleClass}" href="${item.news_url || '#'}" target="_blank" rel="noopener">${displayTitle}</a>
            <div class="ranking-meta">
              <span class="ranking-source">${item.news_source || ''}</span>
              <span class="ranking-count">♡ ${item.favorite_count}</span>
              ${transBtn}
            </div>
          </div>
        </div>
      `;
    }).join("");
    rankingCarouselEl.innerHTML = `<div class="ranking-inner" id="rankingInner">${cardsHtml}</div>`;

    // 启动自动滚动
    const innerEl = document.getElementById("rankingInner");
    if (rankingTimer) clearInterval(rankingTimer);
    rankingPos = 0;
    if (innerEl) innerEl.style.transform = 'translateY(0)';
    if (allItems.length > 3 && innerEl) {
      rankingTimer = setInterval(() => {
        rankingPos++;
        if (rankingPos > allItems.length - 3) rankingPos = 0;
        innerEl.style.transform = `translateY(-${rankingPos * 88}px)`;
      }, 3000);
    }
  } catch (e) {
    rankingCarouselEl.innerHTML = '<div class="ranking-loading">排行榜加载失败</div>';
  }
}

// ===== API 数据加载:仅使用实时 API =====
const API_V1 = "/api/v1/news";

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
  // 无实时数据:清空,页面显示空状态
  newsData = [];
  dataSource = "live-json-api";
}

function formatToday() {
  const now = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 星期${week}`;
}

function renderStats() {
  // 与 renderNews("all") 渲染列表保持一致:合并收藏夹中不在当前新闻流里的旧收藏项
  const existingTitles = new Set(newsData.map(n => n.title));
  const extraFavs = getLocalFavorites().filter(f => !existingTitles.has(f.title));
  const allItems = [...newsData, ...extraFavs];

  const total = allItems.length;
  const importantCount = allItems.filter(item => item.important).length;
  const counts = { award: 0, product: 0, company: 0, research: 0 };
  allItems.forEach(item => { if (counts[item.type] !== undefined) counts[item.type]++; });
  // 一行式统计条:日期 + 总数 + 重要数 + 各分类计数 + 数据来源
  heroStatsEl.innerHTML = `
    <span class="st-date">${formatToday()}</span>
    <span><span class="st-num">${total}</span> 条新闻</span>
    <span><span class="st-num important">${importantCount}</span> 重要</span>
    ${Object.keys(counts).map(key => `
      <span class="st-cat"><i class="st-dot ${key}"></i>${categoryLabels[key] || key} ${counts[key]}</span>
    `).join("")}
    <span class="st-source">来源: 实时API (GDELT·Crossref·OpenAlex·PubMed)</span>
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

// 版面按重要性动态分配:important 的新闻跨满整行并使用大标题,普通新闻占一格
function newsTemplate(item, index) {
  const featured = !!item.important;
  const layoutClass = featured ? "story story-featured" : "story";
  const tagHtml = `<span class="story-tag ${item.type}">${categoryLabels[item.type] || item.type}</span>`;
  const importantHtml = featured ? `<span class="story-important">重要</span>` : "";
  const decoHtml = featured ? BENZENE_SVG : "";
  const favHtml = favBtnHtml(item, index);
  const title = displayName(item);
  const isTranslated = translatedState.has(item.title) && translationCache[item.title] && isEnglishTitle(item.title);
  const titleAttr = isTranslated ? ` title="原文: ${item.title}"` : "";
  const transBtn = translateBtnHtml(item);
  const explainBtn = explainBtnHtml(item);
  const explainPanel = explainPanelHtml(item);
  const titleClass = featured ? "story-title-xl" : "story-title-sm";
  const summaryClass = featured ? "story-summary-lg" : "story-summary";

  return `
    <article class="${layoutClass}" data-type="${item.type}">
      ${decoHtml}${favHtml}
      <div class="story-meta-line"><span class="story-time">${item.time}</span>${tagHtml}${importantHtml}</div>
      <h2 class="${titleClass}"${titleAttr}>${title}${transBtn}</h2>
      <p class="${summaryClass}">${item.summary}</p>
      <div class="story-foot"><span class="story-source">${item.source}</span><span class="story-foot-actions">${explainBtn}<a class="story-link" href="${item.url}" target="_blank" rel="noopener noreferrer">阅读全文 ↗</a></span></div>
      ${explainPanel}
    </article>`;
}

function renderNews(filter = "all") {
  currentFilter = filter;
  let list;
  if (searchIndices !== null) {
    // AI 语义搜索/标签云激活:只显示匹配的新闻(按相关度排序)
    list = searchIndices.map(i => newsData[i]).filter(Boolean);
  } else if (filter === "favorites") {
    const favs = getLocalFavorites();
    list = favs.map(f => ({ ...f, time: "★", important: false }));
  } else if (activeFilters.size > 0) {
    // 多选筛选:只显示选中的分类
    list = newsData.filter(item => activeFilters.has(item.type));
    // 追加localStorage中收藏但不在当前列表里的文章(且属于选中分类)
    const existingTitles = new Set(list.map(n => n.title));
    const favs = getLocalFavorites();
    favs.forEach(f => {
      if (!existingTitles.has(f.title) && activeFilters.has(f.type)) {
        list.push({ ...f, time: "★", important: false });
      }
    });
  } else {
    list = [...newsData];
    // 把localStorage中收藏但不在当前新闻列表里的文章追加到列表末尾
    const existingTitles = new Set(list.map(n => n.title));
    const favs = getLocalFavorites();
    favs.forEach(f => {
      if (!existingTitles.has(f.title)) {
        list.push({ ...f, time: "★", important: false });
      }
    });
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

// 刷新所有含翻译按钮的区域
function refreshAll() {
  renderNews(currentFilter);
  loadRanking();
  if (recommendVisible && lastAIIndices && lastAIIndices.length > 0) {
    renderAIRecommend(lastAIIndices);
  }
}

// 翻译按钮点击处理(中英文切换),绑定到所有含按钮的容器
async function handleTranslateClick(e) {
  const btn = e.target.closest(".translate-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const title = decodeURIComponent(btn.dataset.title);
  const showingZh = translatedState.has(title);

  // 已显示中文 -> 切回原文
  if (showingZh) {
    translatedState.delete(title);
    refreshAll();
    return;
  }

  // 已有翻译缓存 -> 直接切中文
  if (translationCache[title]) {
    translatedState.add(title);
    refreshAll();
    return;
  }

  // 无缓存 -> 调用 DeepSeek 翻译后切中文
  btn.textContent = "…";
  btn.disabled = true;
  try {
    const resp = await fetch("/api/ai/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles: [title] }),
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json.code === 200 && json.data && json.data[title]) {
        translationCache[title] = json.data[title];
        saveTranslationCache();
        translatedState.add(title);
      }
    }
  } catch (err) { console.log("翻译失败", err); }
  refreshAll();
}

masonryEl.addEventListener("click", handleTranslateClick);
rankingCarouselEl.addEventListener("click", handleTranslateClick);
aiGridEl.addEventListener("click", handleTranslateClick);

// 事件委托:卡片底部 AI 解读按钮
masonryEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".explain-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const title = decodeURIComponent(btn.dataset.title);

  // 已展开 -> 折叠
  if (expandedExplains.has(title)) {
    expandedExplains.delete(title);
    renderNews(currentFilter);
    return;
  }

  // 已有缓存 -> 直接展开
  if (explainCache[title]) {
    expandedExplains.add(title);
    renderNews(currentFilter);
    return;
  }

  // 无缓存 -> 调用 DeepSeek 解读
  btn.textContent = "解读中…";
  btn.disabled = true;
  try {
    const item = newsData.find(n => n.title === title);
    const resp = await fetch("/api/ai/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, summary: item ? item.summary : "" }),
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json.code === 200 && json.data) {
        explainCache[title] = json.data;
        saveExplainCache();
        expandedExplains.add(title);
      }
    }
  } catch (err) { console.log("解读失败", err); }
  renderNews(currentFilter);
});

// ===== AI 语义搜索 =====
async function runAISearch(query) {
  query = (query || "").trim();
  if (!query || newsData.length === 0) return;
  aiSearchBtn.disabled = true;
  aiSearchBtn.textContent = "搜索中…";
  try {
    const resp = await fetch("/api/ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        news: newsData.map(n => ({ title: n.title, summary: n.summary, type: n.type })),
      }),
    });
    const json = await resp.json();
    if (json.code === 200) {
      searchIndices = json.data || [];
      searchQueryText = query;
      // 退出分类筛选状态,避免与搜索冲突
      activeFilters.clear();
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      document.querySelector('[data-filter="all"]').classList.add("active");
      aiSearchClear.style.display = "inline-block";
      renderNews("all");
      if (searchIndices.length === 0) {
        emptyEl.textContent = `没有找到与「${query}」相关的新闻。`;
        emptyEl.style.display = "block";
      } else {
        emptyEl.textContent = "当前分类暂无新闻。";
      }
    }
  } catch (err) { console.log("搜索失败", err); }
  aiSearchBtn.disabled = false;
  aiSearchBtn.textContent = "搜索";
}

function clearAISearch() {
  searchIndices = null;
  searchQueryText = "";
  aiSearchInput.value = "";
  aiSearchClear.style.display = "none";
  emptyEl.textContent = "当前分类暂无新闻。";
  renderNews("all");
}

aiSearchBtn.addEventListener("click", () => runAISearch(aiSearchInput.value));
aiSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runAISearch(aiSearchInput.value);
});
aiSearchClear.addEventListener("click", clearAISearch);

// ===== AI 每日早报(开关式:点一下显示,再点收起) =====
let briefText = ""; // 已生成的早报缓存,收起再展开不重复调 API
aiBriefBtn.addEventListener("click", async () => {
  if (newsData.length === 0) return;
  // 已显示 -> 收起
  if (aiBriefBox.style.display !== "none" && briefText) {
    aiBriefBox.style.display = "none";
    aiBriefBtn.textContent = "📰 生成今日早报";
    return;
  }
  // 有缓存 -> 直接展开
  if (briefText) {
    aiBriefBox.innerHTML = `<div class="ai-brief-title">📰 今日化学早报</div><div class="ai-brief-text">${briefText}</div>`;
    aiBriefBox.style.display = "block";
    aiBriefBtn.textContent = "📰 收起早报";
    return;
  }
  // 无缓存 -> 调 DeepSeek 生成
  aiBriefBtn.disabled = true;
  aiBriefBtn.textContent = "📰 撰写中…";
  aiBriefBox.style.display = "block";
  aiBriefBox.innerHTML = '<div class="ai-brief-loading">DeepSeek 正在撰写今日早报…</div>';
  try {
    const resp = await fetch("/api/ai/dailybrief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        news: newsData.map(n => ({ title: n.title, summary: n.summary, type: n.type })),
      }),
    });
    const json = await resp.json();
    if (json.code === 200 && json.data) {
      briefText = json.data;
      aiBriefBox.innerHTML = `<div class="ai-brief-title">📰 今日化学早报</div><div class="ai-brief-text">${briefText}</div>`;
      aiBriefBtn.textContent = "📰 收起早报";
    } else {
      aiBriefBox.style.display = "none";
      aiBriefBtn.textContent = "📰 生成今日早报";
    }
  } catch (err) {
    aiBriefBox.style.display = "none";
    aiBriefBtn.textContent = "📰 生成今日早报";
  }
  aiBriefBtn.disabled = false;
});

// ===== AI 热点标签云(开关式:点一下显示,再点收起) =====
let currentTags = [];
let tagsVisible = false;
aiTagsBtn.addEventListener("click", async () => {
  if (newsData.length === 0) return;
  // 已显示 -> 收起
  if (tagsVisible) {
    aiTagCloud.style.display = "none";
    tagsVisible = false;
    aiTagsBtn.textContent = "🏷️ 提取热点标签";
    return;
  }
  // 有缓存 -> 直接展开
  if (currentTags.length > 0) {
    renderTagCloud();
    aiTagCloud.style.display = "flex";
    tagsVisible = true;
    aiTagsBtn.textContent = "🏷️ 收起标签";
    return;
  }
  // 无缓存 -> 调 DeepSeek 提炼
  aiTagsBtn.disabled = true;
  aiTagsBtn.textContent = "🏷️ 分析中…";
  aiTagCloud.style.display = "flex";
  aiTagCloud.innerHTML = '<div class="ai-brief-loading">DeepSeek 正在提炼热点…</div>';
  try {
    const resp = await fetch("/api/ai/hottags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        news: newsData.map(n => ({ title: n.title, summary: n.summary, type: n.type })),
      }),
    });
    const json = await resp.json();
    if (json.code === 200 && json.data && json.data.length > 0) {
      currentTags = json.data;
      renderTagCloud();
      tagsVisible = true;
      aiTagsBtn.textContent = "🏷️ 收起标签";
    } else {
      aiTagCloud.style.display = "none";
      aiTagsBtn.textContent = "🏷️ 提取热点标签";
    }
  } catch (err) {
    aiTagCloud.style.display = "none";
    aiTagsBtn.textContent = "🏷️ 提取热点标签";
  }
  aiTagsBtn.disabled = false;
});

function renderTagCloud(activeTag) {
  aiTagCloud.innerHTML = currentTags.map((t, i) =>
    `<button class="tag-chip ${activeTag === t.tag ? 'active' : ''}" data-tagidx="${i}">${t.tag}<span class="tag-count">${t.indices.length}</span></button>`
  ).join("");
}

// 点击标签:按标签筛选新闻(再点一次取消)
aiTagCloud.addEventListener("click", (e) => {
  const chip = e.target.closest(".tag-chip");
  if (!chip) return;
  const tag = currentTags[parseInt(chip.dataset.tagidx)];
  if (!tag) return;
  if (searchIndices !== null && searchQueryText === "tag:" + tag.tag) {
    clearAISearch();
    renderTagCloud();
    return;
  }
  searchIndices = tag.indices;
  searchQueryText = "tag:" + tag.tag;
  activeFilters.clear();
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  document.querySelector('[data-filter="all"]').classList.add("active");
  aiSearchClear.style.display = "inline-block";
  aiSearchClear.dataset.fromTag = "1";
  renderTagCloud(tag.tag);
  renderNews("all");
});

// 筛选按钮(多选)
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const f = btn.dataset.filter;
    // 点击任何分类筛选时退出 AI 搜索状态
    if (searchIndices !== null) {
      searchIndices = null;
      searchQueryText = "";
      aiSearchClear.style.display = "none";
      emptyEl.textContent = "当前分类暂无新闻。";
      renderTagCloud();
    }
    if (f === "favorites") {
      // 收藏夹:独立视图
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilters.clear();
      renderNews("favorites");
    } else if (f === "all") {
      // 全部:清空多选
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilters.clear();
      renderNews("all");
    } else {
      // 分类按钮:多选切换
      document.querySelector('[data-filter="all"]').classList.remove("active");
      document.querySelector('[data-filter="favorites"]').classList.remove("active");
      if (activeFilters.has(f)) {
        activeFilters.delete(f);
        btn.classList.remove("active");
      } else {
        activeFilters.add(f);
        btn.classList.add("active");
      }
      // 如果没有选中任何分类,回到"全部"
      if (activeFilters.size === 0) {
        document.querySelector('[data-filter="all"]').classList.add("active");
      }
      renderNews("all");
    }
  });
});

// ===== AI 智能推荐:基于收藏偏好由 DeepSeek 挑选(开关式) =====
let lastAIIndices = []; // 保存最近一次推荐结果,翻译切换/收起后展开用于刷新
let recommendVisible = false;
let recommendDesc = "";
const AI_DESC_DEFAULT = aiDescEl.textContent;
async function generateAIRecommend() {
  // 已显示 -> 收起
  if (recommendVisible) {
    aiGridEl.innerHTML = "";
    recommendVisible = false;
    aiGenBtn.textContent = "根据我的收藏生成推荐";
    aiDescEl.textContent = AI_DESC_DEFAULT;
    return;
  }
  // 有缓存 -> 直接展开,不重复调 API
  if (lastAIIndices.length > 0) {
    renderAIRecommend(lastAIIndices);
    aiDescEl.textContent = recommendDesc;
    recommendVisible = true;
    aiGenBtn.textContent = "收起推荐";
    return;
  }
  if (newsData.length === 0) {
    aiGridEl.innerHTML = '<div class="ai-empty">暂无新闻数据</div>';
    return;
  }
  const favTitles = getLocalFavorites().map(f => f.title);
  aiGenBtn.disabled = true;
  aiGenBtn.textContent = "AI 分析中…";
  aiGridEl.innerHTML = '<div class="ai-loading">DeepSeek 正在分析你的偏好…</div>';
  try {
    const resp = await fetch("/api/ai/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        favorites: favTitles,
        news: newsData.map(n => ({ title: n.title, summary: n.summary, type: n.type })),
      }),
    });
    const json = await resp.json();
    if (json.code === 200 && json.data && json.data.length > 0) {
      lastAIIndices = json.data;
      renderAIRecommend(json.data);
      recommendDesc = favTitles.length > 0
        ? `基于你收藏的 ${favTitles.length} 条新闻生成,共推荐 ${json.data.length} 条。`
        : `你还没有收藏,这是 AI 根据新闻重要性挑选的 ${json.data.length} 条。`;
      aiDescEl.textContent = recommendDesc;
      recommendVisible = true;
      aiGenBtn.textContent = "收起推荐";
    } else {
      aiGridEl.innerHTML = '<div class="ai-empty">未能生成推荐,请稍后再试。</div>';
      aiGenBtn.textContent = "根据我的收藏生成推荐";
    }
  } catch (e) {
    aiGridEl.innerHTML = '<div class="ai-empty">推荐生成失败,请稍后再试。</div>';
    aiGenBtn.textContent = "根据我的收藏生成推荐";
  }
  aiGenBtn.disabled = false;
}

function renderAIRecommend(indices) {
  const items = indices.map(i => newsData[i]).filter(Boolean);
  if (items.length === 0) {
    aiGridEl.innerHTML = '<div class="ai-empty">暂无推荐结果</div>';
    return;
  }
  aiGridEl.innerHTML = items.map((item, i) => {
    const title = displayName(item);
    const transBtn = translateBtnHtml(item);
    const tagHtml = `<span class="story-tag ${item.type}">${categoryLabels[item.type] || item.type}</span>`;
    return `
      <article class="ai-card">
        <div class="ai-card-rank">#${i + 1}</div>
        <div class="ai-card-body">
          <div class="story-meta-line"><span class="story-time">${item.time}</span>${tagHtml}</div>
          <h4 class="ai-card-title">${title}${transBtn}</h4>
          <p class="ai-card-summary">${item.summary || ''}</p>
          <div class="story-foot"><span class="story-source">${item.source || ''}</span><a class="story-link" href="${item.url}" target="_blank" rel="noopener noreferrer">阅读全文 ↗</a></div>
        </div>
      </article>`;
  }).join("");
}

aiGenBtn.addEventListener("click", generateAIRecommend);

// ===== AI 助手 Tab 切换(早报 / 热点标签 / 收藏推荐) =====
const aiPanels = {
  brief: document.getElementById("aiPanelBrief"),
  tags: document.getElementById("aiPanelTags"),
  recommend: document.getElementById("aiPanelRecommend"),
};
document.querySelectorAll(".ai-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".ai-tab").forEach(t => t.classList.toggle("active", t === tab));
    Object.entries(aiPanels).forEach(([name, panel]) => {
      panel.hidden = name !== tab.dataset.tab;
    });
  });
});

// 初始化
(async function init() {
  // 骨架屏占位,减少加载时的布局跳动
  masonryEl.innerHTML = Array.from({ length: 4 }, () => `
    <div class="story skeleton-card" aria-hidden="true">
      <div class="sk-line sk-tag"></div>
      <div class="sk-line sk-title"></div>
      <div class="sk-line sk-text"></div>
      <div class="sk-line sk-text"></div>
      <div class="sk-line sk-text short"></div>
    </div>`).join("");
  await loadNewsData();
  renderStats();
  renderNews("all");
  trackVisitor();
  loadRanking();
})();
