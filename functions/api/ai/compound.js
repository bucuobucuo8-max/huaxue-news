/* =========================
   Cloudflare Pages Function: 中文化合物名 → 英文名 + SMILES
   POST /api/ai/compound
   body: { "name": "布洛芬" }
   返回: { code: 200, data: { "english": "ibuprofen", "smiles": "CC(C)CC1=CC=C(C=C1)C(C)C(=O)O" } }
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
    const name = (body.name || '').trim();
    if (!name) {
      return new Response(JSON.stringify({
        code: 400,
        message: '缺少 name 参数',
        data: null,
      }), { status: 400, headers: CORS_HEADERS });
    }

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: false,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是化学命名专家。把用户给出的化合物名(可能是中文俗名、商品名或缩写)转换为标准英文名和 SMILES。只输出 JSON:{"english":"小写英文通用名","smiles":"标准SMILES"}。若无法确定,输出 {"english":"","smiles":""}。不要输出任何其他文字。',
          },
          { role: 'user', content: name.slice(0, 100) },
        ],
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
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }

    if (!parsed || (!parsed.english && !parsed.smiles)) {
      return new Response(JSON.stringify({
        code: 404,
        message: '无法识别该化合物名称',
        data: null,
      }), { status: 404, headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data: {
        english: (parsed.english || '').trim(),
        smiles: (parsed.smiles || '').trim(),
      },
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: null,
    }), { status: 500, headers: CORS_HEADERS });
  }
}
