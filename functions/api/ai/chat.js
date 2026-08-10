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

// ===== 联网检索 =====
async function fetchJson(url, ms) {
  const resp = await fetchWithTimeout(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'ChemistryAgent/1.0 (education)' },
  }, ms);
  if (!resp.ok) return null;
  try { return await resp.json(); } catch { return null; }
}

// 从 PubChem 识别化合物:queryKind 依次尝试,返回识别描述或空串
async function pubchemIdentify(q, kinds) {
  for (const kind of kinds) {
    try {
      const json = await fetchJson(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${kind}/${encodeURIComponent(q)}/property/IUPACName,MolecularFormula,MolecularWeight,SMILES/JSON`,
        5000
      );
      const p = json?.PropertyTable?.Properties?.[0];
      if (p) {
        return `用户给出的「${q}」经 PubChem 识别为:${p.IUPACName}(分子式 ${p.MolecularFormula},分子量 ${p.MolecularWeight} g/mol,SMILES ${p.SMILES || p.IsomericSMILES || ''},CID ${p.CID})。`;
      }
    } catch {}
  }
  return '';
}

// 识别用户输入中的结构式/分子式/SMILES(整句或句中 token)
async function identifyStructure(message) {
  const q = message.trim();
  const charset = /^[A-Za-z0-9@+\-\[\]()=#$\\/.%]+$/;
  const tryToken = async (token) => {
    if (token.length < 2 || token.length > 80) return '';
    if (/^([A-Z][a-z]?\d*)+$/.test(token)) return pubchemIdentify(token, ['fastformula', 'name', 'smiles']);
    if (/[()=#\[\]@\\]/.test(token)) return pubchemIdentify(token, ['smiles', 'name', 'fastformula']);
    if (/\d/.test(token) && /[A-Za-z]/.test(token)) return pubchemIdentify(token, ['smiles', 'fastformula', 'name']);
    return '';
  };
  // 整句就是结构式(无空格、无中文)
  if (!/\s/.test(q) && charset.test(q)) {
    const hit = await tryToken(q);
    if (hit) return hit;
  }
  // 句中含结构式 token(如"这个 CH3COOH 是什么")
  const tokens = q.match(/[A-Za-z0-9@+\-\[\]()=#$\\/.%]{3,80}/g) || [];
  for (const t of tokens) {
    if (!/\d/.test(t) && !/[()=#\[\]@\\]/.test(t)) continue; // 必须含数字或 SMILES 特征字符
    const hit = await tryToken(t);
    if (hit) return hit;
  }
  return '';
}

// Wikipedia 摘要检索(先中文后英文),返回摘要或空串
async function searchWikipedia(query) {
  const q = query.slice(0, 60);
  for (const lang of ['zh', 'en']) {
    try {
      const s = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1`, 4000);
      const title = s?.query?.search?.[0]?.title;
      if (!title) continue;
      const e = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&redirects=1&format=json&titles=${encodeURIComponent(title)}`, 4000);
      const pages = e?.query?.pages || {};
      const page = Object.values(pages)[0];
      let extract = (page?.extract || '').trim().slice(0, 700);
      // action API 无摘要时,回退 REST summary 接口
      if (!extract) {
        const r = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, 4000);
        extract = (r?.extract || '').trim().slice(0, 700);
      }
      if (extract) return `Wikipedia(${lang === 'zh' ? '中文' : '英文'})「${page?.title || title}」摘要:${extract}`;
    } catch {}
  }
  return '';
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

    // 联网检索:结构识别(PubChem)+ Wikipedia 摘要,并行执行,失败不影响主流程
    const [structureInfo, wikiInfo] = await Promise.all([
      identifyStructure(message),
      searchWikipedia(message),
    ]);
    const webContext = [structureInfo, wikiInfo].filter(Boolean).join('\n');

    const systemPrompt =
      '你是「化学智能体」,一位面向化学专业学生与研究员的 AI 助手,运行在一个化学新闻简讯网站上。' +
      '请用简体中文回答,风格:专业但通俗,适当使用 emoji,化学式/代号/人名保留原文。' +
      '回答要求:1) 直接回答问题,不要说"作为AI";2) 一般问题控制在 200 字以内,需要详细解释时可适当延长;' +
      '3) 如果问题与今日新闻相关,主动引用下方新闻清单中的条目(用「标题」格式引用);' +
      '4) 与化学/材料/化工无关的问题,简短回答后引导回化学话题;' +
      '5) 本平台支持分子结构可视化:当用户想看某化合物的结构式/分子式/分子模型/结构图(任意表述,如"生成…的可视化图像""画一下…"),' +
      '正常用文字回答,并在回复末尾单独一行输出标记 [MOL]化合物英文名或SMILES[/MOL],前端会自动渲染结构图;' +
      '不要说自己无法生成图像;一次最多输出一个 [MOL] 标记;' +
      '6) 书写化学方程式/化学式时,必须使用 mhchem 语法:方程式整体放在 \\[ \\] 中,式内用 \\ce{} 书写(如 \\[ \\ce{2H2 + O2 -> 2H2O} \\]),反应条件写在箭头上(如 \\ce{->[催化剂]}),前端会用 MathJax 渲染为标准化学排版,不要输出图片或纯文本方程式;' +
      '7) 每次回复末尾必须单独一行输出推荐追问标记 [SUGGEST]问题1|问题2|问题3[/SUGGEST]:3 个用户可能感兴趣的后续问题,用 | 分隔,每条 20 字以内,具体且与化学/今日新闻/当前话题相关(例如"布洛芬的结构式""今日热点有哪些""这条新闻的意义"),前端会渲染为可点击的推荐按钮。' +
      (attachSection
        ? '\n8) 用户附加了文献,请优先依据文献网页内容回答,并在回答开头注明依据的是哪篇文献(如「根据《标题》…」);若网页内容抓取失败,基于标题与摘要回答并说明;此时推荐追问应围绕附加文献。'
        : '') +
      (webContext
        ? '\n9) 下方附有联网检索结果,请优先依据它回答并自然注明来源(如"据 Wikipedia");若包含 PubChem 结构识别结果,说明该物质是什么、有何用途,并在回复末尾输出对应的 [MOL] 标记(使用识别结果中的 SMILES 或英文名)以便前端渲染结构图。'
        : '') +
      (newsDigest ? `\n\n今日化学新闻清单:\n${newsDigest}` : '') +
      (webContext ? `\n\n联网检索结果:\n${webContext}` : '') +
      (attachSection ? `\n\n用户附加的文献:\n${attachSection}` : '');

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMsgs,
      { role: 'user', content: message.slice(0, 2000) },
    ];

    // 流式调用 DeepSeek(SSE),转发为纯文本流,前端打字机渲染
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        stream: true,
        temperature: 0.7,
      }),
    });

    if (!resp.ok || !resp.body) {
      return new Response(JSON.stringify({
        code: 502,
        message: `DeepSeek 接口错误: ${resp.status}`,
        data: null,
      }), { status: 502, headers: CORS_HEADERS });
    }

    // 解析 DeepSeek SSE,逐段输出 delta.content
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const upstream = resp.body.getReader();
    const stream = new ReadableStream({
      async start(controller) {
        let buf = '';
        try {
          while (true) {
            const { done, value } = await upstream.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              for (const line of chunk.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                try {
                  const json = JSON.parse(payload);
                  const delta = json.choices?.[0]?.delta?.content || '';
                  if (delta) controller.enqueue(encoder.encode(delta));
                } catch { /* 跳过不完整分片 */ }
              }
            }
          }
        } finally {
          controller.close();
        }
      },
      cancel() { upstream.cancel(); },
    });

    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (e) {
    return new Response(JSON.stringify({
      code: 500,
      message: e.message,
      data: null,
    }), { status: 500, headers: CORS_HEADERS });
  }
}
