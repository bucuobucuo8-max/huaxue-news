/* =========================
   Cloudflare Pages Function: DeepSeek AI 每日早报
   POST /api/ai/dailybrief
   body: { "news": [ { "title", "summary", "type" }, ... ] }
   返回: { code: 200, data: "早报文本" }
   ========================= */

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DEEPSEEK_API_KEY) {
    return new Response(JSON.stringify({
      code: 500,
      message: '未配置 DEEPSEEK_API_KEY 环境变量',
      data: null,
    }), { status: 500, headers: CORS_HEADERS });
  }

  try {
    const body = await request.json();
    const news = Array.isArray(body.news) ? body.news : [];

    if (news.length === 0) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 news 参数',
        data: null,
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 控制成本,最多取前 25 条
    const listed = news.slice(0, 25).map((n, i) =>
      `${i}. [${n.type || ''}] ${n.title}`
    ).join('\n');

    const messages = [
      {
        role: 'system',
        content: '你是一位化学行业晨间新闻主播。根据提供的今日化学新闻列表,写一段中文早报。要求:1) 开头一句总览(今日共几条、哪个方向最热);2) 挑3-5条最值得关注的,每条一句话概括,保留化学式/代号/公司名/期刊名原文;3) 结尾一句点评今日趋势;4) 总长度250字以内,语气明快专业;5) 直接输出早报正文,不要标题、编号和解释性文字。'
      },
      {
        role: 'user',
        content: `今日新闻列表:\n${listed}`
      }
    ];

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        stream: false,
        temperature: 0.6,
      }),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({
        code: 502,
        message: `DeepSeek 接口错误: ${resp.status}`,
        data: null,
      }), { status: 502, headers: CORS_HEADERS });
    }

    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();

    if (!text) {
      return new Response(JSON.stringify({
        code: 502,
        message: 'DeepSeek 返回空内容',
        data: null,
      }), { status: 502, headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data: text,
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: null,
    }), { status: 500, headers: CORS_HEADERS });
  }
}
