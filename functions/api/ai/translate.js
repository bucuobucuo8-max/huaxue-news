/* =========================
   Cloudflare Pages Function: DeepSeek AI 标题翻译
   POST /api/ai/translate
   body: { "titles": ["english title 1", "english title 2", ...] }
   返回: { code: 200, data: { "原文标题": "中文翻译", ... } }

   密钥通过环境变量 DEEPSEEK_API_KEY 注入,不会进入代码仓库。
   设置方式:
     wrangler pages secret put DEEPSEEK_API_KEY --project-name huaxue-news
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
    const titles = Array.isArray(body.titles) ? body.titles : [];

    if (titles.length === 0) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 titles 参数',
        data: {},
      }), { status: 400, headers: CORS_HEADERS });
    }

    // 限制单次翻译数量,控制成本
    const batch = titles.slice(0, 30);

    // 构造带编号的列表,便于模型对应输出
    const listed = batch.map((t, i) => `${i}. ${t}`).join('\n');

    const messages = [
      {
        role: 'system',
        content: '你是一位专业的化学与科技新闻翻译。将用户提供的英文新闻标题翻译为简体中文。翻译规则:1) 专有名词、化学分子式、化合物代号、人名、公司名、期刊名、机构名一律保留原文,不要翻译,例如 "MgFe2O4" "Polθ" "BASF" "Dion–Jacobson" "EPDM" "Nature Chemistry" 等;2) 难以准确翻译的化学结构名、符号(如 "J12" "J13" "PCA" "CdTe")保留原文;3) 其余内容翻译为通顺的简体中文;4) 仅输出 JSON 对象,键为编号字符串,值为翻译结果,不要任何解释文字。'
      },
      {
        role: 'user',
        content: `请翻译以下新闻标题,输出 JSON 对象 {"0":"中文","1":"中文",...}:\n\n${listed}`
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
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({
        code: 502,
        message: `DeepSeek 接口错误: ${resp.status}`,
        data: null,
      }), { status: 502, headers: CORS_HEADERS });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';

    let translatedMap = {};
    try {
      translatedMap = JSON.parse(content);
    } catch (e) {
      // 兜底:尝试从文本中提取 JSON 对象
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { translatedMap = JSON.parse(match[0]); } catch (_) { translatedMap = {}; }
      }
    }

    // 组装 原文 -> 中文 映射
    const result = {};
    batch.forEach((t, i) => {
      const zh = translatedMap[String(i)];
      if (zh && typeof zh === 'string') result[t] = zh.trim();
    });

    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data: result,
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: null,
    }), { status: 500, headers: CORS_HEADERS });
  }
}
