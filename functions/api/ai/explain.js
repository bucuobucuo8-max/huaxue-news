/* =========================
   Cloudflare Pages Function: DeepSeek AI 一键解读新闻
   POST /api/ai/explain
   body: { "title": "新闻标题", "summary": "新闻摘要" }
   返回: { code: 200, data: "通俗解读文本" }
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
    const title = (body.title || '').trim();
    const summary = (body.summary || '').trim();

    if (!title) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 title 参数',
        data: null,
      }), { status: 400, headers: CORS_HEADERS });
    }

    const messages = [
      {
        role: 'system',
        content: '你是一位擅长科普的化学老师。用简体中文向非专业读者解读一条化学/材料/化工新闻。要求:1) 先说"这条新闻讲了什么"(1-2句);2) 再说"为什么重要"(1-2句);3) 涉及的专业术语用括号简单解释;4) 化学式、代号、人名、公司名保留原文;5) 总长度150字以内,直接输出解读文本,不要标题和解释性文字。'
      },
      {
        role: 'user',
        content: `标题:${title}\n摘要:${summary || '(无摘要,请基于标题解读)'}`
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
        temperature: 0.5,
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
