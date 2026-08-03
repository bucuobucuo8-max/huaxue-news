/* =========================
   Cloudflare Pages Function: 真实化学新闻 API
   使用免费JSON API(无需注册/无需API Key)
   1. GDELT Project  - 全球化学新闻
   2. Crossref       - 化学学术论文
   3. PubMed         - 生物医学化学文献
   ========================= */

// CORS 头
const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=300',
};

// 清理HTML标签
function cleanHtml(text) {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// 智能分类
function classifyNews(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  if (/award|prize|medal|winner|honor|lecture|recogni|荣誉|奖|获奖/.test(text)) return 'award';
  if (/launch|product|new material|new .+film|catalyst|release|unveil|introduc|coating|resin|polymer|biobased|bio-based|recycl|nanocrystal|nanoparticle|推出|发布|新品|材料/.test(text)) return 'product';
  if (/company|expand|invest|build|partner|sign|agreement|announce|facility|plant|acquir|merger|funding|inaugurat|nuclear|hydrogen plant|公司|扩建|投资|合作/.test(text)) return 'company';
  if (/study|research|discover|method|analysis|mechanism|synthes|reaction|cataly|spectr|crystal|bond|electron|molecul|atom|ion|acid|protein|enzyme|DNA|RNA|cell|energetic|thermochem|quantum|photovoltaic|heterojunction|研究|发现|方法|分析|机理/.test(text)) return 'research';
  return 'research';
}

// 判断重要性
function isImportant(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  return /breakthrough|milestone|nobel|first|critical|discovery|unprecedent|record|defy|crack|stumped|突破|首次|重大|里程碑/.test(text);
}

// 格式化时间为 HH:MM
function formatTime(dateStr, fallbackIndex) {
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const h = d.getUTCHours();
      const m = d.getUTCMinutes();
      if (h !== 0 || m !== 0) {
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }
    }
  }
  const now = new Date();
  let h = now.getUTCHours();
  let m = now.getUTCMinutes() - fallbackIndex * 12;
  while (m < 0) { m += 60; h = (h - 1 + 24) % 24; }
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// 确保分类均衡
function balanceCategories(news) {
  const types = ['award', 'product', 'company', 'research'];
  const counts = {};
  types.forEach(t => counts[t] = 0);
  news.forEach(n => { if (counts[n.type] !== undefined) counts[n.type]++; });
  types.forEach(t => {
    if (t !== 'research' && counts[t] === 0) {
      const researchItems = news.filter(n => n.type === 'research' && counts['research'] > 1);
      if (researchItems.length > 0) {
        researchItems[0].type = t;
        counts['research']--;
        counts[t]++;
      }
    }
  });
  return news;
}

// =========================
// 1. GDELT API - 全球化学新闻
// =========================
async function fetchGDELT() {
  const queries = [
    { q: '"chemical" OR "chemistry" OR "petrochemical"', type: 'research', source: 'GDELT' },
    { q: '"chemical plant" OR "chemical industry" OR "chemical engineering"', type: 'company', source: 'GDELT Industry' },
    { q: '"new material" OR "nanomaterial" OR "catalyst" OR "polymer"', type: 'product', source: 'GDELT Materials' },
    { q: '"chemistry award" OR "chemistry prize" OR "nobel chemistry"', type: 'award', source: 'GDELT Awards' },
  ];
  const results = [];
  for (const query of queries) {
    try {
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query.q)}&mode=artlist&maxrecords=5&format=json&sort=date&timespan=1week`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
        cf: { cacheTtl: 300 },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.articles) {
        data.articles.forEach((art, i) => {
          const title = cleanHtml(art.title);
          if (!title || title.length < 5) return;
          results.push({
            time: formatTime(art.seendate ? `${art.seendate.substring(0,4)}-${art.seendate.substring(4,6)}-${art.seendate.substring(6,8)}T${art.seendate.substring(8,10)}:${art.seendate.substring(10,12)}:${art.seendate.substring(12,14)}Z` : null, i),
            type: classifyNews(title, art.domain || ''),
            title,
            summary: `${art.domain || 'Chemistry News'} - ${art.sourcecountry || 'Global'}`,
            source: query.source,
            url: art.url || '',
            important: isImportant(title, art.domain || ''),
            image: art.socialimage || '',
          });
        });
      }
    } catch (e) { /* 忽略 */ }
  }
  return results;
}

// =========================
// 2. Crossref API - 化学学术论文
// =========================
async function fetchCrossref() {
  try {
    const url = 'https://api.crossref.org/works?query=chemistry+materials+catalysis+synthesis&rows=10&sort=published&order=desc&mailto=info@huaxue-news.pages.dev';
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = data.message?.items || [];
    return items.slice(0, 8).map((item, i) => {
      const title = cleanHtml(item.title?.[0] || '');
      if (!title) return null;
      const abstract = cleanHtml(item.abstract || '').substring(0, 200);
      const journal = item['container-title']?.[0] || 'Academic Journal';
      const dateParts = item.published?.['date-parts']?.[0];
      const dateStr = dateParts ? `${dateParts[0]}-${String(dateParts[1]||1).padStart(2,'0')}-${String(dateParts[2]||1).padStart(2,'0')}` : null;
      return {
        time: formatTime(dateStr, i + 10),
        type: classifyNews(title, abstract),
        title,
        summary: abstract || journal,
        source: journal,
        url: item.DOI ? `https://doi.org/${item.DOI}` : (item.URL || ''),
        important: isImportant(title, abstract),
      };
    }).filter(n => n !== null);
  } catch (e) { return []; }
}

// =========================
// 3. PubMed API - 生物医学化学文献
// =========================
async function fetchPubMed() {
  try {
    // Step 1: 搜索获取ID
    const searchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=chemistry+OR+chemical+synthesis&retmax=5&retmode=json&sort=pub_date';
    const searchResp = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
    });
    if (!searchResp.ok) return [];
    const searchData = await searchResp.json();
    const ids = searchData.esearchresult?.idlist || [];
    if (ids.length === 0) return [];

    // Step 2: 获取摘要
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryResp = await fetch(summaryUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
    });
    if (!summaryResp.ok) return [];
    const summaryData = await summaryResp.json();
    const result = summaryData.result || {};
    const news = [];
    ids.forEach((id, i) => {
      const item = result[id];
      if (!item) return;
      const title = cleanHtml(item.title || '');
      if (!title) return;
      const journal = item.fulljournalname || 'PubMed';
      const pubDate = item.pubdate || '';
      news.push({
        time: formatTime(pubDate, i + 20),
        type: classifyNews(title, journal),
        title,
        summary: journal,
        source: 'PubMed',
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        important: isImportant(title, journal),
      });
    });
    return news;
  } catch (e) { return []; }
}

// =========================
// 主函数
// =========================
export async function onRequestGet(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    // 并行获取3个API的数据
    const [gdeltNews, crossrefNews, pubmedNews] = await Promise.all([
      fetchGDELT(),
      fetchCrossref(),
      fetchPubMed(),
    ]);

    let allNews = [...gdeltNews, ...crossrefNews, ...pubmedNews];

    // 去重(按标题)
    const seen = new Set();
    allNews = allNews.filter(n => {
      const key = n.title.toLowerCase().substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 确保分类均衡
    if (allNews.length > 0) {
      allNews = balanceCategories(allNews);
    }

    // 按时间降序排序,截取前20条
    allNews.sort((a, b) => b.time.localeCompare(a.time));
    allNews = allNews.slice(0, 20);

    // 获取banner图片(优先从GDELT的socialimage)
    let bannerImage = '';
    const withImage = allNews.find(n => n.image);
    if (withImage) {
      bannerImage = withImage.image;
    } else if (allNews.length > 0 && allNews[0].url) {
      try {
        const artResp = await fetch(allNews[0].url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
          cf: { cacheTtl: 3600 },
        });
        if (artResp.ok) {
          const html = await artResp.text();
          const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
          if (ogMatch) bannerImage = ogMatch[1];
        }
      } catch (e) { /* 忽略 */ }
    }

    return new Response(JSON.stringify({
      code: 200,
      message: allNews.length > 0 ? 'success' : 'no live data available',
      source: 'live-json-api',
      apis: ['GDELT', 'Crossref', 'PubMed'],
      count: allNews.length,
      bannerImage,
      fetchedAt: new Date().toISOString(),
      data: {
        categories: { award: '奖项', product: '产品', company: '公司', research: '研究' },
        news: allNews,
      },
    }), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: null,
    }), { status: 500, headers: CORS_HEADERS });
  }
}
