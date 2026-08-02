/* =========================
   Cloudflare Pages Function: v1/news API
   支持查询参数:category, limit, important
   示例:
     /api/v1/news               获取全部新闻
     /api/v1/news?category=research   只获取研究类
     /api/v1/news?limit=3        只获取3条
     /api/v1/news?important=true 只获取重要新闻
     /api/v1/news?category=award&limit=2  组合查询
   ========================= */

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
    // 先尝试获取实时数据
    let newsData = [];
    let categories = { award: '奖项', product: '产品', company: '公司', research: '研究' };
    let source = 'live-rss';
    let bannerImage = '';

    try {
      const extResp = await fetch(new Request('/api/external', context.request), context);
      if (extResp.ok) {
        const extJson = await extResp.json();
        if (extJson.code === 200 && extJson.data && extJson.data.news && extJson.data.news.length > 0) {
          newsData = extJson.data.news;
          categories = extJson.data.categories || categories;
          bannerImage = extJson.bannerImage || '';
        }
      }
    } catch (e) {
      source = 'local';
    }

    // 实时数据为空时回退本地
    if (newsData.length === 0) {
      try {
        const localResp = await fetch(new Request('/api/news.json', context.request), context);
        if (localResp.ok) {
          const localJson = await localResp.json();
          if (localJson.code === 200 && localJson.data && localJson.data.news) {
            newsData = localJson.data.news;
            categories = localJson.data.categories || categories;
            source = 'local';
          }
        }
      } catch (e) {
        source = 'empty';
      }
    }

    // 解析查询参数
    const url = new URL(context.request.url);
    const category = url.searchParams.get('category');
    const limit = parseInt(url.searchParams.get('limit')) || null;
    const important = url.searchParams.get('important');

    // 按分类筛选
    let filtered = newsData;
    if (category && categories[category]) {
      filtered = filtered.filter(n => n.type === category);
    }

    // 按重要筛选
    if (important === 'true') {
      filtered = filtered.filter(n => n.important === true);
    }

    // 按数量限制
    if (limit && limit > 0) {
      filtered = filtered.slice(0, limit);
    }

    // 返回结果
    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      source,
      count: filtered.length,
      bannerImage,
      query: {
        category: category || null,
        limit: limit || null,
        important: important || null,
      },
      data: {
        categories,
        news: filtered,
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
