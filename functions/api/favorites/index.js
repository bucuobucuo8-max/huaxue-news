/* =========================
   Cloudflare Pages Function: 收藏管理 API
   GET    /api/favorites?visitor_id=xxx  查询指定用户的所有收藏
   POST   /api/favorites                 新增收藏(去重)
   DELETE /api/favorites                 取消收藏
   说明:使用线上 D1 favorites 表真实结构 (client_id, title, url, source)
   ========================= */

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 处理 CORS 预检请求
export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

// 查询指定访客的所有收藏
export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const visitor_id = url.searchParams.get('visitor_id') || url.searchParams.get('client_id');

    if (!visitor_id) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 visitor_id 参数',
        data: [],
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 查询该访客的所有收藏记录(真实列: client_id/title/url/source)
    const { results } = await env.DB.prepare(
      'SELECT id, client_id, title, url, source, created_at FROM favorites WHERE client_id = ? ORDER BY created_at DESC'
    ).bind(visitor_id).all();

    // 映射为对外统一的 news_* 字段
    const data = results.map(r => ({
      id: r.id,
      visitor_id: r.client_id,
      news_title: r.title,
      news_url: r.url,
      news_source: r.source,
      news_type: '',
      news_summary: '',
      created_at: r.created_at,
    }));

    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data,
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: [],
    }), { status: 500, headers: CORS_HEADERS });
  }
}

// 新增收藏(同一访客重复收藏同一条新闻时去重,不重复计数)
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    // 兼容前端字段:visitor_id/news_title 与 client_id/title 都接受
    const client_id = body.visitor_id || body.client_id;
    const title = body.news_title || body.title;
    const url = body.news_url || body.url || '';
    const source = body.news_source || body.source || '';

    if (!client_id || !title) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 visitor_id 或 news_title',
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 去重:已收藏则直接返回,不再插入
    const existing = await env.DB.prepare(
      'SELECT id FROM favorites WHERE client_id = ? AND title = ? LIMIT 1'
    ).bind(client_id, title).first();
    if (existing) {
      return new Response(JSON.stringify({
        code: 200,
        message: 'already favorited',
      }), { headers: CORS_HEADERS });
    }

    await env.DB.prepare(
      'INSERT INTO favorites (client_id, title, url, source) VALUES (?, ?, ?, ?)'
    ).bind(client_id, title, url, source).run();

    return new Response(JSON.stringify({
      code: 200,
      message: 'favorited',
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
    }), { status: 500, headers: CORS_HEADERS });
  }
}

// 取消收藏
export async function onRequestDelete(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const client_id = body.visitor_id || body.client_id;
    const title = body.news_title || body.title;

    if (!client_id || !title) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 visitor_id 或 news_title',
      }), { status: 400, headers: CORS_HEADERS });
    }

    await env.DB.prepare(
      'DELETE FROM favorites WHERE client_id = ? AND title = ?'
    ).bind(client_id, title).run();

    return new Response(JSON.stringify({
      code: 200,
      message: 'unfavorited',
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
    }), { status: 500, headers: CORS_HEADERS });
  }
}
