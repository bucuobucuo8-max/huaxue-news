/* =========================
   Cloudflare Pages Function: 今日分子(从站内新闻提取)
   GET /api/ai/motd
   流程:拉取当天新闻 → DeepSeek 提取一个小分子 → PubChem 验证有 3D 坐标 → 返回
   返回: { code: 200, data: { name, q, fact, reason, from_news } } 或 { code: 404, data: null }
   ========================= */

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=3600',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';

// 验证 PubChem 是否存在该分子的 3D 坐标(SDF)
async function has3D(query) {
  try {
    const resp = await fetch(`${PUBCHEM}/name/${encodeURIComponent(query)}/SDF?record_type=3d`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return false;
    const text = await resp.text();
    return text && text.length > 50;
  } catch { return false; }
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DEEPSEEK_API_KEY) {
    return new Response(JSON.stringify({ code: 500, message: '未配置 DEEPSEEK_API_KEY', data: null }), { status: 500, headers: CORS_HEADERS });
  }

  try {
    // 1. 拉取站内新闻
    const origin = new URL(request.url).origin;
    const newsResp = await fetch(origin + '/api/v1/news');
    const newsJson = await newsResp.json();
    const news = (newsJson.news || []).slice(0, 15);
    if (!news.length) {
      return new Response(JSON.stringify({ code: 404, message: '无新闻数据', data: null }), { status: 404, headers: CORS_HEADERS });
    }

    // 2. DeepSeek 从新闻标题+摘要中提取一个小分子
    const newsText = news.map((n, i) => `${i + 1}. ${n.title}\n   ${n.summary || ''}`).join('\n');
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: false,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `你是化学编辑。从下面给出的化学新闻列表中,挑选一个**具体的小分子化合物**(必须是 PubChem 能查到 3D 结构的常见小分子,如咖啡因/葡萄糖/尿素等,不要选蛋白质/聚合物/纳米材料/混合物/笼统类别如"催化剂")。
只输出 JSON:
{"name":"中文名","english":"PubChem 可检索的英文通用名(小写)","fact":"一句有趣的化学事实(20字内)","reason":"为什么从这条新闻选它(15字内)","news_index":数字}
若新闻中没有合适的小分子,输出 {"name":"","english":"","fact":"","reason":"","news_index":0}。
不要输出任何其他文字。`,
          },
          { role: 'user', content: newsText },
        ],
      }),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ code: 502, message: `DeepSeek 错误: ${resp.status}`, data: null }), { status: 502, headers: CORS_HEADERS });
    }

    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }

    if (!parsed || !parsed.english) {
      return new Response(JSON.stringify({ code: 404, message: '新闻中无合适小分子', data: null }), { status: 404, headers: CORS_HEADERS });
    }

    // 3. 验证 PubChem 有 3D 结构,没有则回退
    const english = String(parsed.english).trim().toLowerCase();
    const ok3d = await has3D(english);
    if (!ok3d) {
      return new Response(JSON.stringify({ code: 404, message: '该分子无 3D 结构', data: null }), { status: 404, headers: CORS_HEADERS });
    }

    const newsIndex = Math.max(0, Math.min(news.length - 1, (parseInt(parsed.news_index) || 1) - 1));
    const fromNews = news[newsIndex];

    return new Response(JSON.stringify({
      code: 200,
      message: 'success',
      data: {
        name: String(parsed.name || english).trim(),
        q: english,
        fact: String(parsed.fact || '').trim(),
        reason: String(parsed.reason || '').trim(),
        from_news: fromNews ? { title: fromNews.title, url: fromNews.url } : null,
      },
    }), { headers: CORS_HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message, data: null }), { status: 500, headers: CORS_HEADERS });
  }
}
