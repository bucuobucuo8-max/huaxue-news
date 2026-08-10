/* =========================
   Cloudflare Pages Function: DeepSeek 化学智能体对话
   POST /api/ai/chat
   body: {
     "message": "用户问题",
     "history": [{ "role": "user"|"assistant", "content": "..." }],  // 最近对话,最多保留10条
     "news": [{ "title": "...", "summary": "...", "type": "..." }],    // 今日新闻上下文(可选)
     "articles": [{ "title": "...", "url": "...", "summary": "...", "source": "..." }]  // 用户附加的文献(可选,最多3篇)
   }
   附加文献时,服务端会抓取网页正文(HTMLRewriter 提取),注入提示词供 Agent 阅读后作答。
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

// 粗提取:HTML → 纯文本(正则兜底用)
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// 途径一:DOI 链接走官方 API(Zenodo / Crossref),稳定不怕反爬
async function fetchViaDoiApi(url) {
  const m = url.match(/doi\.org\/(10\.\d{4,9}\/\S+)/i);
  if (!m) return '';
  const doi = m[1].replace(/[.\s]+$/, '');
  try {
    // Zenodo 数据集/预印本:Records API 含完整描述
    const zm = doi.match(/^10\.5281\/zenodo\.(\d+)$/i);
    if (zm) {
      const resp = await fetchWithTimeout(`https://zenodo.org/api/records/${zm[1]}`, {
        headers: { 'Accept': 'application/json' },
      }, 6000);
      if (resp.ok) {
        const json = await resp.json();
        const desc = htmlToText(json.metadata?.description || '');
        const title = json.metadata?.title || '';
        const text = (title + '\n' + desc).trim();
        if (text.length > 50) return text.slice(0, 3000);
      }
      return '';
    }
    // 通用 DOI:Crossref 元数据(部分含摘要)
    const resp = await fetchWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { 'Accept': 'application/json' },
    }, 6000);
    if (resp.ok) {
      const json = await resp.json();
      const msg = json.message || {};
      const abstract = htmlToText(msg.abstract || '');
      const title = (msg.title || [])[0] || '';
      const text = (title + '\n' + abstract).trim();
      if (text.length > 50) return text.slice(0, 3000);
    }
  } catch {}
  return '';
}

// 途径二:直接抓取网页,HTMLRewriter 提取正文;内容太少时正则全文兜底
async function fetchDirect(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  try {
    const resp = await fetchWithTimeout(url, { redirect: 'follow', headers }, 6000);
    if (!resp.ok) return '';
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return '';
    let text = '';
    const rewritten = new HTMLRewriter()
      .on('p, h1, h2, h3, li, blockquote', {
        text(t) {
          text += t.text;
          if (t.lastInTextNode) text += '\n';
        },
      })
      .transform(resp);
    await rewritten.text(); // 消费流,触发提取
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length >= 200) return text.slice(0, 3000);
    // 结构化提取内容太少:重新抓取原始 HTML 做全文粗提取
    const raw = await fetchWithTimeout(url, { redirect: 'follow', headers }, 6000);
    if (raw.ok) {
      const fallback = htmlToText(await raw.text());
      if (fallback.length > text.length) return fallback.slice(0, 3000);
    }
    return text;
  } catch {
    return '';
  }
}

// 抓取文献内容:DOI API 与直接抓取并行,取内容更长者
async function fetchPageText(url) {
  const [viaApi, direct] = await Promise.all([fetchViaDoiApi(url), fetchDirect(url)]);
  return (viaApi.length >= direct.length ? viaApi : direct).slice(0, 3000);
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

    // 用户附加的文献:抓取网页正文(并行),供 Agent 阅读后作答
    const articles = Array.isArray(body.articles) ? body.articles.slice(0, 3) : [];
    let attachSection = '';
    if (articles.length > 0) {
      const pages = await Promise.all(articles.map(a => (a && a.url) ? fetchPageText(a.url) : ''));
      attachSection = articles.map((a, i) => {
        const content = pages[i]
          ? `网页正文节选:\n${pages[i]}`
          : (a.summary ? `(网页抓取失败,以下为已有摘要)\n${String(a.summary).slice(0, 500)}` : '(网页抓取失败,仅有标题)');
        return `【文献${i + 1}】${a.title}\n来源: ${a.source || '未知'} ${a.url || ''}\n${content}`;
      }).join('\n\n');
    }

    const systemPrompt =
      '你是「化学智能体」,一位面向化学专业学生与研究员的 AI 助手,运行在一个化学新闻简讯网站上。' +
      '请用简体中文回答,风格:专业但通俗,适当使用 emoji,化学式/代号/人名保留原文。' +
      '回答要求:1) 直接回答问题,不要说"作为AI";2) 一般问题控制在 200 字以内,需要详细解释时可适当延长;' +
      '3) 如果问题与今日新闻相关,主动引用下方新闻清单中的条目(用「标题」格式引用);' +
      '4) 与化学/材料/化工无关的问题,简短回答后引导回化学话题;' +
      '5) 本平台支持分子结构可视化:当用户想看某化合物的结构式/分子式/分子模型/结构图(任意表述,如"生成…的可视化图像""画一下…"),' +
      '正常用文字回答,并在回复末尾单独一行输出标记 [MOL]化合物英文名或SMILES[/MOL],前端会自动渲染结构图;' +
      '不要说自己无法生成图像;一次最多输出一个 [MOL] 标记;' +
      '6) 书写化学方程式/化学式时,必须使用 mhchem 语法:方程式整体放在 \\[ \\] 中,式内用 \\ce{} 书写(如 \\[ \\ce{2H2 + O2 -> 2H2O} \\]),反应条件写在箭头上(如 \\ce{->[催化剂]}),前端会用 MathJax 渲染为标准化学排版,不要输出图片或纯文本方程式。' +
      (attachSection
        ? '\n7) 用户附加了文献,请优先依据文献网页内容回答,并在回答开头注明依据的是哪篇文献(如「根据《标题》…」);若网页内容抓取失败,基于标题与摘要回答并说明。'
        : '') +
      (newsDigest ? `\n\n今日化学新闻清单:\n${newsDigest}` : '') +
      (attachSection ? `\n\n用户附加的文献:\n${attachSection}` : '');

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
