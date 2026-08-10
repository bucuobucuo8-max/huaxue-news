/* =========================
   Cloudflare Pages Function: DeepSeek AI 智能推荐
   POST /api/ai/recommend
   body: {
     "favorites": ["收藏标题1", "收藏标题2", ...],   // 可为空数组
     "news": [ { "title", "summary", "type" }, ... ]  // 候选新闻池
   }
   返回: { code: 200, data: [0, 3, 5, ...] }  // 推荐新闻在 news 数组中的下标,按优先级排序

   密钥通过环境变量 DEEPSEEK_API_KEY 注入。
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
    const favorites = Array.isArray(body.favorites) ? body.favorites : [];
    const news = Array.isArray(body.news) ? body.news : [];

    if (news.length === 0) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 news 参数',
        data: [],
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 控制候选数量与成本,最多取前 40 条
    const candidates = news.slice(0, 40);
    const candidateList = candidates.map((n, i) =>
      `${i}. [${n.type || ''}] ${n.title}${n.summary ? ' - ' + String(n.summary).slice(0, 60) : ''}`
    ).join('\n');

    const favText = favorites.length > 0
      ? favorites.map(f => `- ${f}`).join('\n')
      : '(用户暂无收藏)';

    const topN = Math.min(5, candidates.length);

    const messages = [
      {
        role: 'system',
        content: '你是一位化学新闻编辑助手,擅长根据读者偏好推荐相关新闻。只输出 JSON 对象,不要任何解释文字。'
      },
      {
        role: 'user',
        content: `用户收藏过的新闻标题:
${favText}

候选新闻列表(编号. [分类] 标题 - 摘要):
${candidateList}

请根据用户收藏偏好,从候选新闻中挑选最相关的 ${topN} 条推荐给该用户。
要求:
- 不要推荐与用户已收藏标题完全相同的新闻
- 兼顾相关性与重要性,按推荐优先级排序
- 仅输出 JSON 对象,格式 {"indices":[编号,编号,...]},编号取自上面的列表`
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
        temperature: 0.3,
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
      indices = parsed.indices || parsed.index || parsed.data || [];
    } catch (e) {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          indices = parsed.indices || [];
        } catch (_) { indices = []; }
      }
    }

    // 过滤无效下标并去重、限长
    const valid = [];
    const seen = new Set();
    (Array.isArray(indices) ? indices : []).forEach(i => {
      const idx = typeof i === 'number' ? i : parseInt(i);
      if (!isNaN(idx) && idx >= 0 && idx < candidates.length && !seen.has(idx)) {
        valid.push(idx);
        seen.add(idx);
      }
    });

    // 若模型返回不足,不额外补全,保持 AI 选择纯粹
    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data: valid.slice(0, topN),
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: [],
    }), { status: 500, headers: CORS_HEADERS });
  }
}
