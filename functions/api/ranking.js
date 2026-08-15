/* =========================
   Cloudflare Pages Function: 收藏排行榜 API
   GET /api/ranking
   查询 news_stats 表按 favorite_count 降序返回前10条
   ========================= */

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 处理 CORS 预检请求
export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  try {
    const { env } = context;

    // 直接统计 favorites 表(真实结构 client_id/title/url/source),按不同访客去重计数
    const { results } = await env.DB.prepare(
      `SELECT title AS news_title, MAX(url) AS news_url, MAX(source) AS news_source,
              COUNT(DISTINCT client_id) AS favorite_count
       FROM favorites
       GROUP BY title
       ORDER BY favorite_count DESC
       LIMIT 10`
    ).all();

    // 为每条记录添加排名序号
    const ranking = results.map((item, index) => ({
      rank: index + 1,
      news_title: item.news_title,
      news_url: item.news_url,
      news_source: item.news_source,
      news_type: '',
      favorite_count: item.favorite_count,
    }));

    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data: ranking,
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: [],
    }), { status: 500, headers: CORS_HEADERS });
  }
}
