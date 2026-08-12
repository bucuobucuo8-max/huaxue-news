// 订阅管理 API - 关键词/DOI/作者/靶点/分子监控
// 需要 D1 数据库绑定(未绑定时降级为内存模式,仅当前会话有效)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') || '';

  if (!env.DB) {
    return new Response(JSON.stringify({ code: 200, data: [], message: 'D1 未绑定,订阅功能降级' }), { headers: CORS_HEADERS });
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT s.*, (SELECT COUNT(*) FROM notifications n WHERE n.subscription_id = s.id AND n.read = 0) as unread FROM subscriptions s WHERE s.client_id = ? AND s.active = 1 ORDER BY s.created_at DESC'
    ).bind(clientId).all();

    return new Response(JSON.stringify({ code: 200, data: results || [] }), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message, data: [] }), { headers: CORS_HEADERS });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json();
  const { client_id, keyword, type = 'keyword' } = body;

  if (!client_id || !keyword) {
    return new Response(JSON.stringify({ code: 400, message: '缺少 client_id 或 keyword' }), { headers: CORS_HEADERS });
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ code: 200, data: { id: 0, keyword, type }, message: 'D1 未绑定,订阅仅当前会话有效' }), { headers: CORS_HEADERS });
  }

  try {
    const result = await env.DB.prepare(
      'INSERT INTO subscriptions (client_id, keyword, type) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
    ).bind(client_id, keyword, type).run();

    return new Response(JSON.stringify({ code: 200, data: { id: result.meta?.last_row_id, keyword, type } }), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), { headers: CORS_HEADERS });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const subId = url.searchParams.get('id');
  const clientId = url.searchParams.get('client_id');

  if (!env.DB || !subId) {
    return new Response(JSON.stringify({ code: 200, message: '已移除(D1 未绑定)' }), { headers: CORS_HEADERS });
  }

  try {
    await env.DB.prepare('UPDATE subscriptions SET active = 0 WHERE id = ? AND client_id = ?').bind(subId, clientId).run();
    return new Response(JSON.stringify({ code: 200, message: '已取消订阅' }), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), { headers: CORS_HEADERS });
  }
}
