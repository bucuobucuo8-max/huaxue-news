/* =========================
   Cloudflare Pages Function: 真实化学新闻 API
   从多个化学新闻 RSS 源获取实时数据
   ========================= */

// RSS 源配置 - 多源确保分类多样化
const RSS_SOURCES = [
  { url: 'https://www.nature.com/nchem.rss', type: 'research', source: 'Nature Chemistry' },
  { url: 'https://www.chemistryworld.com/rss/chemistryworld.rss', type: 'research', source: 'Chemistry World' },
  { url: 'https://www.acs.org/content/acs/en/pressroom.rss', type: 'company', source: 'ACS' },
  { url: 'https://cen.acs.org/rss', type: 'product', source: 'C&EN' },
  { url: 'https://www.rsc.org/rss/news/', type: 'award', source: 'RSC' },
];

// 从 RSS item 中提取字段(支持 CDATA)
function extractField(item, tag) {
  const cdata = item.match(new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
  if (cdata) return cdata[1].trim();
  const plain = item.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i'));
  if (plain) return plain[1].trim();
  return '';
}

// 支持 pubDate 和 dc:date 两种时间格式
function parseTime(item, fallbackIndex) {
  let dateStr = extractField(item, 'pubDate');
  if (!dateStr) {
    const dc = item.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
    if (dc) dateStr = dc[1].trim();
  }
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const h = d.getUTCHours();
      const m = d.getUTCMinutes();
      // 如果解析出 00:00,可能是只有日期没有时间的 RSS,使用 fallback
      if (h !== 0 || m !== 0) {
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }
    }
  }
  // fallback:基于当前 UTC 时间生成递减序列
  const now = new Date();
  let h = now.getUTCHours();
  let m = now.getUTCMinutes() - fallbackIndex * 12;
  while (m < 0) { m += 60; h = (h - 1 + 24) % 24; }
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// 清理 HTML 标签和实体
function cleanHtml(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// 根据标题+描述关键词智能分类
function classifyNews(title, desc, defaultType) {
  const text = (title + ' ' + desc).toLowerCase();
  // 奖项类
  if (/award|prize|medal|winner|honor|lecture|recogni|荣誉|奖|获奖/.test(text)) return 'award';
  // 产品类
  if (/launch|product|new material|new .+film|catalyst|release|unveil|introduc| coating|resin|polymer|biobased|bio-based|recycl|推出|发布|新品|材料/.test(text)) return 'product';
  // 公司类
  if (/company|expand|invest|build|partner|sign|agreement|announce|facility|plant|acquir|merger|funding|round|公司|扩建|投资|合作|签署|收购/.test(text)) return 'company';
  // 研究类
  if (/study|research|discover|method|analysis|mechanism|synthes|reaction|cataly|spectr|crystal|bond|electron|molecul|atom|ion|acid|protein|enzyme|DNA|RNA|cell| 研究|发现|方法|分析|机理/.test(text)) return 'research';
  return defaultType;
}

// 提取文章链接(支持 RDF:about 属性 fallback)
function extractLink(item) {
  let link = extractField(item, 'link');
  // 如果 link 为空或指向 RSS feed,尝试 rdf:about 属性
  if (!link || link.includes('/rss/') || link.includes('feeds.nature.com')) {
    const about = item.match(/rdf:about="([^"]+)"/i);
    if (about && about[1]) link = about[1];
  }
  return link || '';
}

// 提取描述(支持 content:encoded / dc:description)
function extractDescription(item) {
  let desc = extractField(item, 'description');
  if (!desc) desc = extractField(item, 'content:encoded');
  if (!desc) {
    const dcDesc = item.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);
    if (dcDesc) desc = dcDesc[1];
  }
  return desc || '';
}

// 判断重要性
function isImportant(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  return /breakthrough|milestone|nobel|first|critical|discovery|unprecedent|record|突破|首次|重大|里程碑/.test(text);
}

// 解析 RSS XML 为新闻数组(支持 RSS 2.0 和 RDF/RSS 1.0)
function parseRSS(xml, defaultType, sourceName, startIndex) {
  const items = [];
  // 匹配 <item> 和 <item rdf:about="...">,不匹配 <items>
  const itemRegex = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match;
  let count = 0;
  while ((match = itemRegex.exec(xml)) !== null && count < 5) {
    const item = match[1];
    const title = cleanHtml(extractField(item, 'title'));
    if (!title || title.length < 5) continue;
    const link = cleanHtml(extractLink(item));
    const rawDesc = extractDescription(item);
    const desc = cleanHtml(rawDesc).substring(0, 200);
    const time = parseTime(item, startIndex + count);
    const type = classifyNews(title, desc, defaultType);
    const important = isImportant(title, desc);
    items.push({
      time,
      type,
      title,
      summary: desc || title,
      source: sourceName,
      url: link,
      important,
    });
    count++;
  }
  return items;
}

// 确保分类均衡:如果某分类缺失,从research中轮转分配
function balanceCategories(news) {
  const types = ['award', 'product', 'company', 'research'];
  const typeCounts = {};
  types.forEach(t => typeCounts[t] = 0);
  news.forEach(n => { if (typeCounts[n.type] !== undefined) typeCounts[n.type]++; });

  // 如果某分类为0,从research类中抽取补充
  types.forEach(t => {
    if (t !== 'research' && typeCounts[t] === 0) {
      const researchItems = news.filter(n => n.type === 'research' && typeCounts['research'] > 1);
      if (researchItems.length > 0) {
        researchItems[0].type = t;
        typeCounts['research']--;
        typeCounts[t]++;
      }
    }
  });
  return news;
}

// CORS 头
const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=300',
};

export async function onRequestGet(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    let indexCounter = 0;
    const fetchPromises = RSS_SOURCES.map(async (source) => {
      try {
        const resp = await fetch(source.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
          cf: { cacheTtl: 300 },
        });
        if (!resp.ok) return [];
        const xml = await resp.text();
        const items = parseRSS(xml, source.type, source.source, indexCounter);
        indexCounter += items.length;
        return items;
      } catch (e) {
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    let allNews = results.flat();

    // 确保分类均衡
    if (allNews.length > 0) {
      allNews = balanceCategories(allNews);
    }

    // 按时间降序排序
    allNews.sort((a, b) => b.time.localeCompare(a.time));

    return new Response(JSON.stringify({
      code: 200,
      message: allNews.length > 0 ? 'success' : 'no live data available, fallback to local',
      source: 'live-rss',
      count: allNews.length,
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
    }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
