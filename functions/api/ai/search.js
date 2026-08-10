/* =========================
   Cloudflare Pages Function: DeepSeek AI 语义搜索
   POST /api/ai/search
   body: {
     "query": "电池相关的研究",
     "news": [ { "title", "summary", "type" }, ... ]
   }
   返回: { code: 200, data: [2, 5, 0, ...] }  // 匹配新闻的下标,按相关度排序
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
      data: [],
    }), { status: 500, headers: CORS_HEADERS });
  }

  try {
    const body = await request.json();
    const query = (body.query || '').trim();
    const news = Array.isArray(body.news) ? body.news : [];

    if (!query || news.length === 0) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 query 或 news 参数',
        data: [],
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 控制候选数量与成本
    const candidates = news.slice(0, 40);
    const candidateList = candidates.map((n, i) =>
      `${i}. [${n.type || ''}] ${n.title}${n.summary ? ' - ' + String(n.summary).slice(0, 60) : ''}`
    ).join('\n');

    const messages = [
      {
        role: 'system',
        content: '你是一位化学新闻检索助手,擅长理解自然语言查询并做语义匹配。你的匹配策略是宽松的:只要新闻主题与查询有任何合理关联(同义词、上下位概念、同领域、应用相关)都算匹配。只输出 JSON 对象,不要任何解释文字。'
      },
      {
        role: 'user',
        content: `用户搜索:${query}

候选新闻列表(编号. [分类] 标题 - 摘要):
${candidateList}

请逐条判断哪些新闻与搜索意图相关。判断标准(宽松):
- 直接相关、间接相关、同领域、应用场景沾边的都算匹配
- 例如搜"电池",涉及电极、电解质、储能、锂、钠的都要算
- 例如搜"癌症",涉及肿瘤、细胞、药物、抗体的都要算

要求:
- 按相关度从高到低排序,最多返回 10 条
- 只要列表中存在哪怕一条沾边的新闻,就必须返回它,禁止在存在相关新闻时返回空数组
- 仅输出 JSON 对象,格式 {"indices":[编号,编号,...]}`
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
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({
        code: 502,
        message: `DeepSeek 接口错误: ${resp.status}`,
        data: [],
      }), { status: 502, headers: CORS_HEADERS });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';

    let indices = [];
    try {
      const parsed = JSON.parse(content);
      indices = parsed.indices || [];
    } catch (e) {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { indices = JSON.parse(match[0]).indices || []; } catch (_) { indices = []; }
      }
    }

    const valid = [];
    const seen = new Set();
    (Array.isArray(indices) ? indices : []).forEach(i => {
      const idx = typeof i === 'number' ? i : parseInt(i);
      if (!isNaN(idx) && idx >= 0 && idx < candidates.length && !seen.has(idx)) {
        valid.push(idx);
        seen.add(idx);
      }
    });

    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data: valid.slice(0, 10),
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: [],
    }), { status: 500, headers: CORS_HEADERS });
  }
}
