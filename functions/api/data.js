/* =========================
   Cloudflare Pages Function: 统一数据 API
   优先返回实时RSS数据,失败时返回本地数据
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
    // 尝试获取实时RSS数据
    const externalResp = await fetch(new Request('/api/external', context.request), context);
    if (externalResp.ok) {
      const data = await externalResp.json();
      if (data.code === 200 && data.data && data.data.news && data.data.news.length > 0) {
        return new Response(JSON.stringify(data), { headers: CORS_HEADERS });
      }
    }
  } catch (e) {
    // 外部API失败,继续尝试本地数据
  }

  // 回退:尝试本地JSON
  try {
    const localResp = await fetch(new Request('/api/news.json', context.request), context);
    if (localResp.ok) {
      const data = await localResp.json();
      return new Response(JSON.stringify(data), { headers: CORS_HEADERS });
    }
  } catch (e) {
    // 本地也失败
  }

  // 最终回退:返回空数据
  return new Response(JSON.stringify({
    code: 200,
    message: 'success (fallback)',
    source: 'fallback',
    bannerImage: '',
    data: {
      categories: { award: '奖项', product: '产品', company: '公司', research: '研究' },
      news: [],
    },
  }), { headers: CORS_HEADERS });
}
