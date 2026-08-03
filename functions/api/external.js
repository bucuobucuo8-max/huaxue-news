/* =========================
   Cloudflare Pages Function: 真实化学新闻 API
   使用免费JSON API(无需注册/无需API Key)
   1. GDELT Project  - 全球化学新闻
   2. Crossref       - 化学学术论文
   3. OpenAlex       - 化学研究(概念过滤)
   4. PubMed         - 生物医学化学文献
   ========================= */

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=300',
};

function cleanHtml(text) {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function classifyNews(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  if (/award|prize|medal|winner|honor|lecture|recogni|荣誉|奖|获奖/.test(text)) return 'award';
  if (/launch|product|new material|nanomaterial|catalyst|polymer|coating|resin|biobased|recycl|nanocrystal|nanoparticle|推出|发布|新品|材料/.test(text)) return 'product';
  if (/company|expand|invest|build|partner|agreement|announce|facility|plant|acquir|merger|funding|inaugurat|nuclear|hydrogen plant|公司|扩建|投资|合作/.test(text)) return 'company';
  return 'research';
}

function isImportant(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  return /breakthrough|milestone|nobel|first|critical|discovery|unprecedent|record|defy|crack|stumped|突破|首次|重大|里程碑/.test(text);
}

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

// 过滤无效文章
function isValidArticle(title, url) {
  if (!title || title.length < 10) return false;
  if (/title pending|untitled|no title/i.test(title)) return false;
  if (!url || url.length < 10) return false;
  return true;
}

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
    { q: '"chemistry" OR "chemical" OR "petrochemical"', source: 'GDELT' },
    { q: '"chemical plant" OR "chemical industry" OR "new material"', source: 'GDELT Industry' },
  ];
  const results = [];
  for (const query of queries) {
    try {
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query.q)}&mode=artlist&maxrecords=10&format=json&sort=date&timespan=1week`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
        cf: { cacheTtl: 300 },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.articles) {
        data.articles.forEach((art, i) => {
          const title = cleanHtml(art.title);
          const url = art.url || '';
          if (!isValidArticle(title, url)) return;
          results.push({
            time: formatTime(art.seendate ? `${art.seendate.substring(0,4)}-${art.seendate.substring(4,6)}-${art.seendate.substring(6,8)}T${art.seendate.substring(8,10)}:${art.seendate.substring(10,12)}:${art.seendate.substring(12,14)}Z` : null, i),
            type: classifyNews(title, art.domain || ''),
            title,
            summary: `${art.domain || 'Chemistry News'} - ${art.sourcecountry || 'Global'}`,
            source: query.source,
            url,
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
// 2. Crossref API - 化学学术论文(按期刊过滤)
// =========================
async function fetchCrossref() {
  try {
    // 用化学相关关键词 + 期刊类型过滤
    const url = 'https://api.crossref.org/works?query=chemistry+OR+catalysis+OR+polymer+OR+materials+science&filter=type:journal-article&rows=15&sort=published&order=desc&mailto=info@huaxue-news.pages.dev';
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = data.message?.items || [];
    const results = [];
    for (const item of items) {
      const title = cleanHtml(item.title?.[0] || '');
      const doi = item.DOI || '';
      const url = doi ? `https://doi.org/${doi}` : (item.URL || '');
      if (!isValidArticle(title, url)) continue;
      const abstract = cleanHtml(item.abstract || '').substring(0, 200);
      const journal = item['container-title']?.[0] || 'Academic Journal';
      const dateParts = item.published?.['date-parts']?.[0];
      const dateStr = dateParts ? `${dateParts[0]}-${String(dateParts[1]||1).padStart(2,'0')}-${String(dateParts[2]||1).padStart(2,'0')}` : null;
      results.push({
        time: formatTime(dateStr, results.length + 10),
        type: classifyNews(title, abstract),
        title,
        summary: abstract || journal,
        source: journal,
        url,
        important: isImportant(title, abstract),
      });
      if (results.length >= 8) break;
    }
    return results;
  } catch (e) { return []; }
}

// =========================
// 3. OpenAlex API - 化学研究(概念ID精确过滤)
// =========================
async function fetchOpenAlex() {
  try {
    // C178790648 = Chemistry 概念
    const url = 'https://api.openalex.org/works?filter=concepts.id:C178790648,publication_year:2025-2026,type:article&sort=publication_date:desc&per_page=8&mailto=info@huaxue-news.pages.dev';
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const results = [];
    for (const item of (data.results || [])) {
      const title = cleanHtml(item.title || '');
      const doi = item.doi || '';
      const url = doi ? doi : (item.id || '');
      if (!isValidArticle(title, url)) continue;
      // OpenAlex的abstract_inverted_index需要重建
      let abstract = '';
      if (item.abstract_inverted_index) {
        const words = [];
        for (const [word, positions] of Object.entries(item.abstract_inverted_index)) {
          positions.forEach(pos => { words[pos] = word; });
        }
        abstract = words.filter(w => w).join(' ').substring(0, 200);
      }
      const journal = item.host_venue?.display_name || item.primary_location?.source?.display_name || 'OpenAlex';
      const dateStr = item.publication_date || '';
      results.push({
        time: formatTime(dateStr, results.length + 20),
        type: classifyNews(title, abstract),
        title,
        summary: abstract || journal,
        source: journal,
        url,
        important: isImportant(title, abstract),
      });
    }
    return results;
  } catch (e) { return []; }
}

// =========================
// 4. PubMed API - 生物医学化学文献
// =========================
async function fetchPubMed() {
  try {
    const searchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=chemistry+OR+chemical+synthesis&retmax=8&retmode=json&sort=pub_date';
    const searchResp = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
    });
    if (!searchResp.ok) return [];
    const searchData = await searchResp.json();
    const ids = searchData.esearchresult?.idlist || [];
    if (ids.length === 0) return [];

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
      const url = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
      if (!isValidArticle(title, url)) return;
      const journal = item.fulljournalname || 'PubMed';
      const pubDate = item.pubdate || '';
      news.push({
        time: formatTime(pubDate, i + 30),
        type: classifyNews(title, journal),
        title,
        summary: journal,
        source: 'PubMed',
        url,
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
    const [gdeltNews, crossrefNews, openalexNews, pubmedNews] = await Promise.all([
      fetchGDELT(),
      fetchCrossref(),
      fetchOpenAlex(),
      fetchPubMed(),
    ]);

    let allNews = [...gdeltNews, ...crossrefNews, ...openalexNews, ...pubmedNews];

    // 去重(按标题前50字符)
    const seen = new Set();
    allNews = allNews.filter(n => {
      const key = n.title.toLowerCase().substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (allNews.length > 0) {
      allNews = balanceCategories(allNews);
    }

    allNews.sort((a, b) => b.time.localeCompare(a.time));
    allNews = allNews.slice(0, 20);

    // 获取banner图片
    let bannerImage = '';
    const withImage = allNews.find(n => n.image);
    if (withImage) {
      bannerImage = withImage.image;
    }

    return new Response(JSON.stringify({
      code: 200,
      message: allNews.length > 0 ? 'success' : 'no live data available',
      source: 'live-json-api',
      apis: ['GDELT', 'Crossref', 'OpenAlex', 'PubMed'],
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
