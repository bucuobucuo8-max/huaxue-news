/* =========================
   Cloudflare Pages Function: DeepSeek 化学智能体对话
   POST /api/ai/chat
   body: {
     "message": "用户问题",
     "history": [{ "role": "user"|"assistant", "content": "..." }],  // 最近对话,最多保留10条
     "news": [{ "title": "...", "summary": "...", "type": "..." }]    // 今日新闻上下文(可选)
   }
   返回: { code: 200, data: "AI 回复文本" }
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
    const message = (body.message || '').trim();
    if (!message) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 message 参数',
        data: null,
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 对话历史:只保留最近 10 条,防止 token 膨胀
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    const historyMsgs = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

    // 今日新闻上下文:压缩成标题清单,让 Agent 能结合最新资讯回答
    const news = Array.isArray(body.news) ? body.news.slice(0, 15) : [];
    const newsDigest = news
      .map((n, i) => `${i + 1}. [${n.type || ''}] ${n.title}${n.summary ? ' — ' + String(n.summary).slice(0, 80) : ''}`)
      .join('\n');

    const systemPrompt =
      '你是「化学智能体」,一位面向化学专业学生与研究员的 AI 助手,运行在一个化学新闻简讯网站上。' +
      '请用简体中文回答,风格:专业但通俗,适当使用 emoji,化学式/代号/人名保留原文。' +
      '回答要求:1) 直接回答问题,不要说"作为AI";2) 一般问题控制在 200 字以内,需要详细解释时可适当延长;' +
      '3) 如果问题与今日新闻相关,主动引用下方新闻清单中的条目(用「标题」格式引用);' +
      '4) 与化学/材料/化工无关的问题,简短回答后引导回化学话题。' +
      (newsDigest ? `\n\n今日化学新闻清单:\n${newsDigest}` : '');

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMsgs,
      { role: 'user', content: message.slice(0, 2000) },
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
        temperature: 0.7,
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
