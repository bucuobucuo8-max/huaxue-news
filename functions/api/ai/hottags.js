/* =========================
   Cloudflare Pages Function: DeepSeek AI 热点标签云
   POST /api/ai/hottags
   body: { "news": [ { "title", "summary", "type" }, ... ] }
   返回: { code: 200, data: [ { "tag": "固态电池", "indices": [0,3] }, ... ] }
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
    const news = Array.isArray(body.news) ? body.news : [];

    if (news.length === 0) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 news 参数',
        data: [],
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 控制成本
    const candidates = news.slice(0, 30);
    const listed = candidates.map((n, i) => `${i}. ${n.title}`).join('\n');

    const messages = [
      {
        role: 'system',
        content: '你是一位化学新闻编辑,擅长提炼热点主题。只输出 JSON 对象,不要任何解释文字。'
      },
      {
        role: 'user',
        content: `新闻标题列表(编号. 标题):
${listed}

请提炼今日新闻的 6-8 个热点主题标签(简体中文,每个标签2-6字,如"固态电池""催化剂""诺贝尔奖""AI制药"),并给出每个标签对应的新闻编号。
要求:
- 标签覆盖尽可能多的新闻,相同主题合并为一个标签
- 化学专有名词可保留原文(如 "MOF" "钙钛矿")
- 仅输出 JSON 对象,格式 {"tags":[{"tag":"标签名","indices":[编号,...]},...]}`
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
        temperature: 0.4,
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

    let tags = [];
    try {
      tags = JSON.parse(content).tags || [];
    } catch (e) {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { tags = JSON.parse(match[0]).tags || []; } catch (_) { tags = []; }
      }
    }

    // 校验清洗:标签为字符串,下标有效去重
    const valid = [];
    (Array.isArray(tags) ? tags : []).forEach(t => {
      if (!t || typeof t.tag !== 'string' || !t.tag.trim()) return;
      const idxs = [];
      const seen = new Set();
      (Array.isArray(t.indices) ? t.indices : []).forEach(i => {
        const idx = typeof i === 'number' ? i : parseInt(i);
        if (!isNaN(idx) && idx >= 0 && idx < candidates.length && !seen.has(idx)) {
          idxs.push(idx);
          seen.add(idx);
        }
      });
      if (idxs.length > 0) valid.push({ tag: t.tag.trim(), indices: idxs });
    });

    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data: valid.slice(0, 8),
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: [],
    }), { status: 500, headers: CORS_HEADERS });
  }
}
