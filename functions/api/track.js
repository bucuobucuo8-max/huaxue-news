/* =========================
   Cloudflare Pages Function: 访客追踪 API
   POST /api/track
   记录访客信息到 visitors 表
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

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // 从请求体获取前端数据
    const body = await request.json();
    const { visitor_id, page, referrer } = body;

    if (!visitor_id) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 visitor_id',
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 从请求头获取国家与浏览器信息
    const country = request.headers.get('CF-IPCountry') || '';
    const userAgent = request.headers.get('user-agent') || '';

    // 插入访客记录到 visitors 表
    await env.DB.prepare(
      'INSERT INTO visitors (visitor_id, user_agent, page, referrer, country) VALUES (?, ?, ?, ?, ?)'
    ).bind(visitor_id, userAgent, page || '', referrer || '', country).run();

    return new Response(JSON.stringify({
      code: 200,
      message: 'tracked',
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
    }), { status: 500, headers: CORS_HEADERS });
  }
}
