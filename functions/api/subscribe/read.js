// 将某客户端的全部订阅提醒标记为已读
// POST /api/subscribe/read  body: { client_id }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const clientId = (body.client_id || '').trim();

    if (!env.DB) {
      return new Response(JSON.stringify({ code: 200, message: 'D1 未绑定' }), { headers: CORS_HEADERS });
    }
    if (!clientId) {
      return new Response(JSON.stringify({ code: 400, message: '缺少 client_id' }), { status: 400, headers: CORS_HEADERS });
    }

    await env.DB.prepare('UPDATE notifications SET read = 1 WHERE client_id = ?').bind(clientId).run();
    return new Response(JSON.stringify({ code: 200, message: '已全部标记为已读' }), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), { headers: CORS_HEADERS });
  }
}
