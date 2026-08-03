/* =========================
   Cloudflare Pages Function: 收藏管理 API
   GET  /api/favorites?visitor_id=xxx  查询指定用户的所有收藏
   POST /api/favorites                 新增收藏并更新统计
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
    const visitor_id = url.searchParams.get('visitor_id');

    if (!visitor_id) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 visitor_id 参数',
        data: [],
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 查询该访客的所有收藏记录
    const { results } = await env.DB.prepare(
      'SELECT id, visitor_id, news_title, news_url, news_source, news_type, news_summary, created_at FROM favorites WHERE visitor_id = ? ORDER BY created_at DESC'
    ).bind(visitor_id).all();

    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data: results,
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: [],
    }), { status: 500, headers: CORS_HEADERS });
  }
}

// 新增收藏,同时更新新闻统计表
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const { visitor_id, news_title, news_url, news_source, news_type, news_summary } = body;

    if (!visitor_id || !news_title) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 visitor_id 或 news_title',
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 插入收藏记录到 favorites 表
    await env.DB.prepare(
      'INSERT INTO favorites (visitor_id, news_title, news_url, news_source, news_type, news_summary) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(visitor_id, news_title, news_url || '', news_source || '', news_type || '', news_summary || '').run();

    // 使用 UPSERT 更新 news_stats 表:存在则 favorite_count+1,不存在则新建并置为1
    await env.DB.prepare(
      `INSERT INTO news_stats (news_title, news_url, news_source, news_type, favorite_count, updated_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'))
       ON CONFLICT(news_title) DO UPDATE SET
         favorite_count = favorite_count + 1,
         news_url = excluded.news_url,
         news_source = excluded.news_source,
         news_type = excluded.news_type,
         updated_at = datetime('now')`
    ).bind(news_title, news_url || '', news_source || '', news_type || '').run();

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

// 取消收藏,同时更新统计表
export async function onRequestDelete(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const { visitor_id, news_title } = body;

    if (!visitor_id || !news_title) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 visitor_id 或 news_title',
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 删除 favorites 表中的记录
    await env.DB.prepare(
      'DELETE FROM favorites WHERE visitor_id = ? AND news_title = ?'
    ).bind(visitor_id, news_title).run();

    // news_stats 表 favorite_count - 1(不低于0)
    await env.DB.prepare(
      `UPDATE news_stats SET favorite_count = MAX(favorite_count - 1, 0), updated_at = datetime('now') WHERE news_title = ?`
    ).bind(news_title).run();

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
