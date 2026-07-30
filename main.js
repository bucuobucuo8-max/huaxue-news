/* =========================
   前景新闻渲染与筛选
   ========================= */
const masonryEl = document.getElementById("masonry");
const emptyEl = document.getElementById("emptyState");
const heroStatsEl = document.getElementById("heroStats");

// 格式化今日日期
function formatToday() {
  const now = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 星期${week}`;
}

// 渲染统计卡片:今日日期 + 新闻总数 + 重要数量 + 分类条形图
function renderStats() {
  const total = NEWS.length;
  const importantCount = NEWS.filter(item => item.important).length;
  const counts = { award: 0, product: 0, company: 0, research: 0 };
  NEWS.forEach(item => counts[item.type]++);
  const maxCount = Math.max(...Object.values(counts), 1);

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
          <span class="chart-label">${CATEGORY_LABEL[key]}</span>
          <div class="chart-bar"><div class="chart-fill ${key}" style="width:${(counts[key] / maxCount * 100).toFixed(0)}%"></div></div>
          <span class="chart-val">${counts[key]}</span>
        </div>
      `).join("")}
    </div>
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
          <span class="tag ${item.type}">${CATEGORY_LABEL[item.type]}</span>
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
  const list = filter === "all" ? NEWS : NEWS.filter(item => item.type === filter);
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

// 初始化
renderStats();
renderNews("all");
