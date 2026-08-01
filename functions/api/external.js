/* =========================
   Cloudflare Pages Function: 真实化学新闻 API
   从多个化学新闻 RSS 源获取实时数据
   ========================= */

// RSS 源配置
const RSS_SOURCES = [
  { url: 'https://www.nature.com/nchem.rss', type: 'research', source: 'Nature Chemistry' },
  { url: 'https://www.chemistryworld.com/rss/chemistryworld.rss', type: 'research', source: 'Chemistry World' },
  { url: 'https://www.acs.org/content/acs/en/pressroom.rss', type: 'company', source: 'ACS' },
];

// 从 RSS item 中提取字段(支持 CDATA)
function extractField(item, tag) {
  const cdata = item.match(new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
  if (cdata) return cdata[1].trim();
  const plain = item.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i'));
  if (plain) return plain[1].trim();
  return '';
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

// 根据标题关键词分类
function classifyNews(title, defaultType) {
  const lower = title.toLowerCase();
  if (/award|prize|奖|荣誉/.test(lower)) return 'award';
  if (/launch|product|推出|发布|新品|material|film|catalyst/.test(lower)) return 'product';
  if (/company|公司|announce|expand|sign|partner|建|合作/.test(lower)) return 'company';
  return defaultType;
}

// 解析 RSS XML 为新闻数组
function parseRSS(xml, defaultType, sourceName) {
  const items = [];
  const itemRegex = /<item[\s\S]*?>([\s\S]*?)<\/item>/gi;
  let match;
  let count = 0;
  while ((match = itemRegex.exec(xml)) !== null && count < 5) {
    const item = match[1];
    const title = cleanHtml(extractField(item, 'title'));
    if (!title) continue;
    const link = extractField(item, 'link') || extractField(item, 'guid');
    const desc = cleanHtml(extractField(item, 'description')).substring(0, 200);
    const pubDate = extractField(item, 'pubDate');
    let time = '';
    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime())) {
        time = d.toTimeString().substring(0, 5);
      }
    }
    const type = classifyNews(title, defaultType);
    const important = /breakthrough|milestone|nobel|first|突破|首次|重大|critical|discovery/.test(title.toLowerCase());
    items.push({ time: time || '--:--', type, title, summary: desc || '点击查看详情', source: sourceName, url: link, important });
    count++;
  }
  return items;
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
  // 处理预检请求
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    // 并行获取所有 RSS 源
    const fetchPromises = RSS_SOURCES.map(async (source) => {
      try {
        const resp = await fetch(source.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChemistryNewsBot/1.0)' },
          cf: { cacheTtl: 300 },
        });
        if (!resp.ok) return [];
        const xml = await resp.text();
        return parseRSS(xml, source.type, source.source);
      } catch (e) {
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    const allNews = results.flat();

    // 按时间降序排序
    allNews.sort((a, b) => b.time.localeCompare(a.time));

    // 如果全部获取失败,返回空数组(前端会回退到本地数据)
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
