/* =========================
   Cloudflare Pages Function: 真实化学新闻 API
   使用免费JSON API(无需注册/无需API Key)
   1. GDELT Project  - 全球化学新闻
   2. Crossref       - 化学学术论文(按期刊ISSN精确过滤)
   3. OpenAlex       - 化学研究(概念ID精确过滤)
   4. PubMed         - 生物医学化学文献(MeSH词过滤)
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

// 化学相关性检测:标题+摘要+期刊名必须包含化学关键词
function isChemistryRelated(title, summary, journal) {
  const text = (title + ' ' + summary + ' ' + journal).toLowerCase();
  // 非化学主题黑名单
  if (/nursing|music therapy|maternal body mass|attachment style|spiritual intell|drought stress|soil salinity|effluent|contour based|real time multiple object|client-centered|relaxing music|life distress/.test(text)) return false;
  // 化学关键词白名单
  const chemKeywords = [
    'chemistr', 'chemical', 'molecule', 'molecular', 'catalys', 'synthesi',
    'polymer', 'compound', 'element', 'bond', 'ion', 'acid', 'base',
    'organic', 'inorganic', 'biochem', 'electrochem', 'spectroscop',
    'crystal', 'nano', 'material', 'reaction', 'oxid', 'reduc',
    'hydrogen', 'carbon', 'nitrogen', 'oxygen', 'metal', 'ligand',
    'enzyme', 'protein', 'dna', 'rna', 'pharma', 'drug',
    'photochem', 'thermochem', 'quantum chem', 'computational chem',
    'analytical chem', 'organic chem', 'physic chem',
    'doi.org', 'acs', 'rsc', 'nature chem', 'wiley', 'angewandte',
    'jacs', 'catalysis', 'surfactant', 'monomer', 'copolymer',
    'nanoparticle', 'nanocrystal', 'nanowire', 'nanosheet',
    'electrode', 'battery', 'fuel cell', 'solar cell', 'photovoltaic',
    'semiconductor', 'superconductor', 'magnet', 'ceramic',
    'composit', 'alloy', 'corrosion', 'coating', 'thin film',
    'chromatography', 'mass spectrom', 'nmr', 'x-ray', 'diffract',
    'crystalliz', 'solubility', 'viscosity', 'density', 'surface tension',
    'micelle', 'emulsion', 'colloid', 'gel', 'aerogel',
    'porous', 'mesoporous', 'zeolite', 'mof', 'cof',
    'perovskite', 'graphene', 'carbon nanotube', 'fullerene',
    'electrolysis', 'electrochem', 'photoelectrochem',
    'chemisorpt', 'physisorp', 'adsorption', 'desorption',
  ];
  return chemKeywords.some(kw => text.includes(kw));
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

// 时间格式:北京时间(UTC+8)的 YYYY-MM-DD HH:MM
function formatTime(dateStr, fallbackIndex) {
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const TZ = 8 * 3600 * 1000; // 北京时间偏移

  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const bj = new Date(d.getTime() + TZ);
      // 若原数据只有日期(时间为00:00),时间部分用当前时间递减代替
      if (d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0) {
        return fmt(bj);
      }
      const bjDate = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`;
      const fallback = new Date(Date.now() + TZ - fallbackIndex * 12 * 60000);
      return `${bjDate} ${pad(fallback.getUTCHours())}:${pad(fallback.getUTCMinutes())}`;
    }
  }
  // 无日期:用当前北京时间递减生成
  const fallback = new Date(Date.now() + TZ - fallbackIndex * 12 * 60000);
  return fmt(fallback);
}

// 验证URL是否有效
function isValidUrl(url) {
  if (!url || url.length < 15) return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  return true;
}

// 验证文章是否有效
function isValidArticle(title, url) {
  if (!title || title.length < 10) return false;
  if (/title pending|untitled|no title/i.test(title)) return false;
  if (!isValidUrl(url)) return false;
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
  // 两个查询并行,各 8 秒超时兜底
  const settled = await Promise.allSettled(queries.map(async (query) => {
    const list = [];
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query.q)}&mode=artlist&maxrecords=10&format=json&sort=date&timespan=1week`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return list;
    const data = await resp.json();
    if (data.articles) {
      data.articles.forEach((art, i) => {
        const title = cleanHtml(art.title);
        const url = art.url || '';
        if (!isValidArticle(title, url)) return;
        if (!isChemistryRelated(title, art.domain || '', '')) return;
        list.push({
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
    return list;
  }));
  return settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

// =========================
// 2. Crossref API - 按化学期刊ISSN精确获取
// =========================
async function fetchCrossref() {
  // 知名化学期刊ISSN列表
  const chemistryISSNs = [
    '1755-4330', // Nature Chemistry
    '0002-7863', // JACS
    '0009-2665', // Chemical Reviews
    '1433-7851', // Angewandte Chemie
    '2041-6520', // Chemical Science
    '1936-0851', // ACS Nano
    '2155-5435', // ACS Catalysis
    '0897-4756', // Chemistry of Materials
    '0020-1669', // Inorganic Chemistry
    '1523-7060', // Organic Letters
    '0003-2700', // Analytical Chemistry
  ];
  const results = [];
  // 随机选4个期刊,并行查询,各 8 秒超时兜底
  const selectedISSNs = chemistryISSNs.sort(() => Math.random() - 0.5).slice(0, 4);
  const settled = await Promise.allSettled(selectedISSNs.map(async (issn) => {
    const list = [];
    const url = `https://api.crossref.org/journals/${issn}/works?filter=type:journal-article&rows=3&sort=published&order=desc&mailto=info@huaxue-news.pages.dev`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return list;
    const data = await resp.json();
    const items = data.message?.items || [];
    for (const item of items) {
      const title = cleanHtml(item.title?.[0] || '');
      const doi = item.DOI || '';
      const url = doi ? `https://doi.org/${doi}` : '';
      if (!isValidArticle(title, url)) continue;
      const abstract = cleanHtml(item.abstract || '').substring(0, 200);
      const journal = item['container-title']?.[0] || 'Chemistry Journal';
      if (!isChemistryRelated(title, abstract, journal)) continue;
      const dateParts = item.published?.['date-parts']?.[0];
      const dateStr = dateParts ? `${dateParts[0]}-${String(dateParts[1]||1).padStart(2,'0')}-${String(dateParts[2]||1).padStart(2,'0')}` : null;
      list.push({
        time: formatTime(dateStr, list.length + 10),
        type: classifyNews(title, abstract),
        title,
        summary: abstract || journal,
        source: journal,
        url,
        important: isImportant(title, abstract),
      });
    }
    return list;
  }));
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      for (const n of r.value) {
        results.push(n);
        if (results.length >= 8) break;
      }
    }
    if (results.length >= 8) break;
  }
  return results;
}

// =========================
// 3. OpenAlex API - 化学概念精确过滤
// =========================
async function fetchOpenAlex() {
  try {
    // C178790648 = Chemistry, C185592680 = Materials science
    const url = 'https://api.openalex.org/works?filter=concepts.id:C178790648|C185592680,publication_year:2025-2026,type:article&sort=publication_date:desc&per_page=10&mailto=info@huaxue-news.pages.dev';
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const results = [];
    for (const item of (data.results || [])) {
      const title = cleanHtml(item.title || '');
      const doi = item.doi || '';
      const url = doi ? doi : '';
      if (!isValidArticle(title, url)) continue;
      let abstract = '';
      if (item.abstract_inverted_index) {
        const words = [];
        for (const [word, positions] of Object.entries(item.abstract_inverted_index)) {
          positions.forEach(pos => { words[pos] = word; });
        }
        abstract = words.filter(w => w).join(' ').substring(0, 200);
      }
      const journal = item.host_venue?.display_name || item.primary_location?.source?.display_name || 'OpenAlex';
      if (!isChemistryRelated(title, abstract, journal)) continue;
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
      if (results.length >= 8) break;
    }
    return results;
  } catch (e) { return []; }
}

// =========================
// 4. PubMed API - 化学相关文献(MeSH词精确过滤)
// =========================
async function fetchPubMed() {
  try {
    // 用MeSH词精确搜索化学文献
    const searchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=%22Chemistry%22[MeSH]+OR+%22Chemical+Phenomena%22[MeSH]+OR+%22Chemical+Actions%22[MeSH]&retmax=8&retmode=json&sort=pub_date';
    const searchResp = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!searchResp.ok) return [];
    const searchData = await searchResp.json();
    const ids = searchData.esearchresult?.idlist || [];
    if (ids.length === 0) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryResp = await fetch(summaryUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
      cf: { cacheTtl: 300 },
      signal: AbortSignal.timeout(8000),
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
      if (!isChemistryRelated(title, journal, journal)) return;
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

  // 整包缓存:15分钟内直接返回缓存结果,避免每次都等 4 个外部 API
  const cache = caches.default;
  const cacheKey = new Request(new URL(context.request.url).origin + '/api/external');
  try {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch (e) { /* 缓存不可用时继续走实时抓取 */ }

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

    let bannerImage = '';
    const withImage = allNews.find(n => n.image);
    if (withImage) {
      bannerImage = withImage.image;
    } else if (allNews.length > 0 && allNews[0].url) {
      // 从第一条新闻页面抓取 og:image(4秒超时,避免拖慢整体响应)
      try {
        const artResp = await fetch(allNews[0].url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
          cf: { cacheTtl: 3600 },
          signal: AbortSignal.timeout(4000),
        });
        if (artResp.ok) {
          const html = await artResp.text();
          const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
          if (ogMatch) bannerImage = ogMatch[1];
        }
      } catch (e) { /* 忽略 */ }
    }

    const response = new Response(JSON.stringify({
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
    }), {
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=900', // 15分钟
      },
    });

    // 写入整包缓存,后续请求直接命中,不阻塞本次返回
    try {
      context.waitUntil(cache.put(cacheKey, response.clone()));
    } catch (e) { /* 忽略 */ }

    return response;
  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: null,
    }), { status: 500, headers: CORS_HEADERS });
  }
}
