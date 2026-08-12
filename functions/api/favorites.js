/* =========================
   Cloudflare Pages Function: 收藏 API
   POST   /api/favorites  添加收藏
   DELETE /api/favorites  取消收藏
   ========================= */

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ code: 200, message: 'D1 未绑定' }), { headers: CORS_HEADERS });
  }
  try {
    const { visitor_id, news_title, news_url, news_source, news_type, news_summary } = await request.json();
    if (!visitor_id || !news_title) {
      return new Response(JSON.stringify({ code: 400, message: '缺少 visitor_id 或 news_title' }), { status: 400, headers: CORS_HEADERS });
    }
    await env.DB.prepare(
      'INSERT OR IGNORE INTO favorites (client_id, title, url, source) VALUES (?, ?, ?, ?)'
    ).bind(visitor_id, news_title, news_url || '', news_source || '').run();
    return new Response(JSON.stringify({ code: 200, message: 'favorited' }), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), { status: 500, headers: CORS_HEADERS });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ code: 200, message: 'D1 未绑定' }), { headers: CORS_HEADERS });
  }
  try {
    const { visitor_id, news_title } = await request.json();
    if (!visitor_id || !news_title) {
      return new Response(JSON.stringify({ code: 400, message: '缺少参数' }), { status: 400, headers: CORS_HEADERS });
    }
    await env.DB.prepare(
      'DELETE FROM favorites WHERE client_id = ? AND title = ?'
    ).bind(visitor_id, news_title).run();
    return new Response(JSON.stringify({ code: 200, message: 'unfavorited' }), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), { status: 500, headers: CORS_HEADERS });
  }
}
