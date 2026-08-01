/* =========================
   前景新闻渲染与筛选
   数据来源优先级: /api/external(真实RSS) > /api/news.json(本地API) > 内联数据(data.js)
   ========================= */
const masonryEl = document.getElementById("masonry");
const emptyEl = document.getElementById("emptyState");
const heroStatsEl = document.getElementById("heroStats");

// 当前生效的数据(初始化时从API加载)
let newsData = NEWS;
let categoryLabels = CATEGORY_LABEL;
let dataSource = "inline";

// API 端点
const API_EXTERNAL = "/api/external";
const API_LOCAL = "/api/news.json";

// 尝试从API获取数据,失败逐级回退
async function loadNewsData() {
  // 1. 尝试真实RSS API
  try {
    const resp = await fetch(API_EXTERNAL);
    if (resp.ok) {
      const json = await resp.json();
      if (json.code === 200 && json.data && json.data.news && json.data.news.length > 0) {
        newsData = json.data.news;
        categoryLabels = json.data.categories || CATEGORY_LABEL;
        dataSource = json.source || "live-rss";
        console.log(`[数据源] 真实RSS API: ${newsData.length} 条新闻`);
        return;
      }
    }
  } catch (e) {
    console.log("[数据源] 外部API不可用,尝试本地API...");
  }

  // 2. 尝试本地JSON API
  try {
    const resp = await fetch(API_LOCAL);
    if (resp.ok) {
      const json = await resp.json();
      if (json.code === 200 && json.data && json.data.news) {
        newsData = json.data.news;
        categoryLabels = json.data.categories || CATEGORY_LABEL;
        dataSource = "local-api";
        console.log(`[数据源] 本地API: ${newsData.length} 条新闻`);
        return;
      }
    }
  } catch (e) {
    console.log("[数据源] 本地API不可用,使用内联数据");
  }

  // 3. 回退到内联数据(data.js)
  dataSource = "inline";
  console.log(`[数据源] 内联数据: ${newsData.length} 条新闻`);
}

// 格式化今日日期
function formatToday() {
  const now = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 星期${week}`;
}

// 渲染统计卡片:今日日期 + 新闻总数 + 重要数量 + 分类条形图
function renderStats() {
  const total = newsData.length;
  const importantCount = newsData.filter(item => item.important).length;
  const counts = { award: 0, product: 0, company: 0, research: 0 };
  newsData.forEach(item => { if (counts[item.type] !== undefined) counts[item.type]++; });
  const maxCount = Math.max(...Object.values(counts), 1);

  const sourceLabel = dataSource === "live-rss" ? "实时RSS" : dataSource === "local-api" ? "本地API" : "内置数据";

  heroStatsEl.innerHTML = `
    <div class="stats-date">${formatToday()}</div>
    <div class="stats-numbers">
      <div class="stat-box">
        <div class="stat-label">新闻总数</div>
        <div class="stat-num">${total}</div>
      </div>
      <div class="stat-box important">
        <div class="stat-label">重要事件</div>
        <div class="stat-num">${importantCount}</div>
      </div>
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

// 旋转苯环SVG装饰(重要卡片右上角)
const BENZENE_SVG = `
  <svg class="molecule-deco" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <polygon points="50,10 86,30 86,70 50,90 14,70 14,30" fill="none" stroke="#fb7185" stroke-width="2"/>
    <circle cx="50" cy="10" r="6" fill="#fb7185"/>
    <circle cx="86" cy="30" r="6" fill="#fb7185"/>
    <circle cx="86" cy="70" r="6" fill="#fb7185"/>
    <circle cx="50" cy="90" r="6" fill="#fb7185"/>
    <circle cx="14" cy="70" r="6" fill="#fb7185"/>
    <circle cx="14" cy="30" r="6" fill="#fb7185"/>
  </svg>
`;

// 新闻卡片模板
function newsTemplate(item) {
  return `
    <article class="news-item ${item.important ? "important" : ""}" data-type="${item.type}">
      <div class="news-card">
        <span class="time-badge">${item.time}</span>
        ${item.important ? BENZENE_SVG : ""}
        <div class="meta">
          <span class="tag ${item.type}">${categoryLabels[item.type] || item.type}</span>
          ${item.important ? `<span class="important-badge">重要</span>` : ""}
        </div>
        <h2>${item.title}</h2>
        <p>${item.summary}</p>
        <div class="card-foot">
          <span class="source">来源:${item.source}</span>
          <a class="source-link" href="${item.url}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a>
        </div>
      </div>
    </article>
  `;
}

// 渲染新闻列表
function renderNews(filter = "all") {
  const list = filter === "all" ? newsData : newsData.filter(item => item.type === filter);
  masonryEl.innerHTML = list.map(newsTemplate).join("");
  emptyEl.style.display = list.length ? "none" : "block";
}

// 筛选按钮事件监听
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderNews(btn.dataset.filter);
  });
});

// 初始化:先加载API数据,再渲染
(async function init() {
  await loadNewsData();
  renderStats();
  renderNews("all");
})();
