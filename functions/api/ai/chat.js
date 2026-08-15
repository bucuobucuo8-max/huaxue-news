/* =========================
   Cloudflare Pages Function: DeepSeek 化学智能体对话(支持工具调用 / function calling)
   POST /api/ai/chat
   body: {
     "message": "用户问题",
     "history": [{ "role": "user"|"assistant", "content": "..." }],
     "news": [{ "title": "...", "summary": "...", "type": "..." }],
     "knowledge": [{ "title": "...", "url": "...", "summary": "...", "source": "..." }],
     "articles": [{ "title": "...", "url": "...", "summary": "...", "source": "..." }]
   }
   服务端以 Agent 循环调用 DeepSeek 工具(tool_calls),流式返回 SSE:
     data: {"type":"tool","name":"...","args":{...}}   // 正在调用某工具
     data: {"type":"text","delta":"..."}               // 最终回答片段(打字机)
     data: {"type":"done","toolCalls":[...]}           // 结束
     data: {"type":"error","message":"..."}
   ========================= */

const CORS_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
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

async function fetchJson(url, ms) {
  const resp = await fetchWithTimeout(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'ChemistryAgent/1.0 (education)' },
  }, ms);
  if (!resp.ok) return null;
  try { return await resp.json(); } catch { return null; }
}

// 途径一:DOI 链接走官方 API(Zenodo / Crossref),稳定不怕反爬
async function fetchViaDoiApi(url) {
  const m = url.match(/doi\.org\/(10\.\d{4,9}\/\S+)/i);
  if (!m) return '';
  const doi = m[1].replace(/[.\s]+$/, '');
  try {
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
    await rewritten.text();
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length >= 200) return text.slice(0, 3000);
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
        return `「${q}」经 PubChem 识别为:${p.IUPACName}(分子式 ${p.MolecularFormula},分子量 ${p.MolecularWeight} g/mol,SMILES ${p.SMILES || p.IsomericSMILES || ''},CID ${p.CID})。`;
      }
    } catch {}
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
      if (!extract) {
        const r = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, 4000);
        extract = (r?.extract || '').trim().slice(0, 700);
      }
      if (extract) return `Wikipedia(${lang === 'zh' ? '中文' : '英文'})「${page?.title || title}」摘要:${extract}`;
    } catch {}
  }
  return '';
}

// ===== 工具实现 =====
async function toolSearchCompound(q) {
  const query = String(q || '').trim();
  if (!query) return '缺少化合物名称/分子式/SMILES';
  const info = await pubchemIdentify(query, ['fastformula', 'name', 'smiles']);
  return info || `未能在 PubChem 中识别「${query}」。`;
}

async function toolSimilarity(smiles) {
  const s = String(smiles || '').trim();
  if (!s) return '缺少 SMILES';
  const data = await fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastsimilarity/smiles/${encodeURIComponent(s)}/cids/JSON?MaxRecords=5&Threshold=80`, 6000);
  const cids = data?.IdentifierList?.CID || [];
  if (!cids.length) return '未找到相似化合物。';
  const props = await Promise.all(cids.map(cid =>
    fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/IUPACName,MolecularFormula,MolecularWeight/JSON`, 5000)
  ));
  const lines = props.map((p, i) => {
    const x = p?.PropertyTable?.Properties?.[0];
    return x ? `${i + 1}. ${x.IUPACName}(${x.MolecularFormula}, ${x.MolecularWeight} g/mol, CID ${cids[i]})` : `${i + 1}. CID ${cids[i]}`;
  });
  return lines.join('\n') || '未找到相似化合物。';
}

async function toolSubstructure(smiles) {
  const s = String(smiles || '').trim();
  if (!s) return '缺少 SMILES';
  const data = await fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastsubstructure/smiles/${encodeURIComponent(s)}/cids/JSON?MaxRecords=5`, 6000);
  const cids = data?.IdentifierList?.CID || [];
  if (!cids.length) return '未找到包含该子结构的化合物。';
  const props = await Promise.all(cids.map(cid =>
    fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/IUPACName,MolecularFormula,MolecularWeight/JSON`, 5000)
  ));
  const lines = props.map((p, i) => {
    const x = p?.PropertyTable?.Properties?.[0];
    return x ? `${i + 1}. ${x.IUPACName}(${x.MolecularFormula}, ${x.MolecularWeight} g/mol, CID ${cids[i]})` : `${i + 1}. CID ${cids[i]}`;
  });
  return lines.join('\n') || '未找到包含该子结构的化合物。';
}

async function toolSearchPapers(q) {
  const query = String(q || '').trim();
  if (!query) return '缺少检索关键词';
  const [cr, oa] = await Promise.all([
    fetchJson(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=5&select=DOI,title,container-title,published&mailto=info@huaxue-news.pages.dev`, 7000),
    fetchJson(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=5&mailto=info@huaxue-news.pages.dev`, 7000),
  ]);
  const out = [];
  for (const it of (cr?.message?.items || []).slice(0, 5)) {
    const t = String(it.title?.[0] || '').replace(/<[^>]+>/g, '');
    if (t) out.push(`[Crossref] ${t}${it.DOI ? ' — https://doi.org/' + it.DOI : ''}`);
  }
  for (const it of (oa?.results || []).slice(0, 5)) {
    const t = String(it.title || '');
    if (t) out.push(`[OpenAlex] ${t} (${it.publication_year || ''})${it.doi ? ' — https://doi.org/' + it.doi : ''}`);
  }
  return out.length ? out.join('\n') : `未检索到「${query}」相关论文。`;
}

function toolSearchNews(q, news) {
  const list = Array.isArray(news) ? news : [];
  const ql = String(q || '').toLowerCase();
  let hits = list.filter(n => ((n.title || '') + (n.summary || '')).toLowerCase().includes(ql));
  if (!hits.length) hits = list.slice(0, 5);
  if (!hits.length) return '暂无新闻数据。';
  return hits.map((n, i) => `${i + 1}. [${n.type || ''}] ${n.title}${n.summary ? ' — ' + String(n.summary).slice(0, 80) : ''}`).join('\n');
}

function toolSearchKnowledge(q, kb) {
  const list = Array.isArray(kb) ? kb : [];
  const ql = String(q || '').toLowerCase();
  let hits = list.filter(k => ((k.title || '') + (k.summary || '')).toLowerCase().includes(ql));
  if (!hits.length) hits = list.slice(0, 5);
  if (!hits.length) return '知识库为空。';
  return hits.map((k, i) => `${i + 1}. ${k.title}${k.summary ? ' — ' + String(k.summary).slice(0, 80) : ''}${k.url ? ' (' + k.url + ')' : ''}`).join('\n');
}

// ===== 工具注册表(DeepSeek function calling schema) =====
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_compound',
      description: '在 PubChem 中识别化合物。输入化合物英文名、分子式或 SMILES,返回 IUPAC 名称、分子式、分子量、SMILES 和 CID。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '化合物英文名、分子式或 SMILES' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'similarity_search',
      description: '按 SMILES 检索与目标化合物结构相似的化合物(PubChem 相似性搜索)。',
      parameters: { type: 'object', properties: { smiles: { type: 'string', description: '参考化合物的 SMILES' } }, required: ['smiles'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'substructure_search',
      description: '按 SMILES 检索包含该子结构的化合物(PubChem 子结构搜索)。',
      parameters: { type: 'object', properties: { smiles: { type: 'string', description: '子结构 SMILES' } }, required: ['smiles'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '通过 Wikipedia 联网检索某个概念/物质的摘要信息(中英文)。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '检索词' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_papers',
      description: '检索学术论文(Crossref + OpenAlex),返回论文标题、DOI、年份。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '论文检索关键词' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_webpage',
      description: '抓取指定 URL 的网页正文文本(用于阅读文献/新闻详情)。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '网页 URL' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_news',
      description: '检索今日化学新闻(基于站内已加载的新闻列表)。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '新闻检索关键词' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: '检索用户收藏的知识库文献。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '检索关键词' } }, required: ['query'] },
    },
  },
];

async function executeTool(name, args, ctx) {
  switch (name) {
    case 'search_compound': return await toolSearchCompound(args.query);
    case 'similarity_search': return await toolSimilarity(args.smiles);
    case 'substructure_search': return await toolSubstructure(args.smiles);
    case 'web_search': return (await searchWikipedia(String(args.query || '').trim())) || '未检索到相关信息。';
    case 'search_papers': return await toolSearchPapers(args.query);
    case 'fetch_webpage': return await fetchPageText(String(args.url || '').trim()) || '网页抓取失败或无正文。';
    case 'search_news': return toolSearchNews(args.query, ctx.news);
    case 'search_knowledge': return toolSearchKnowledge(args.query, ctx.knowledge);
    default: return '未知工具: ' + name;
  }
}

// 调用 DeepSeek(非流式,用于工具循环)
async function callDeepSeek(env, messages, tools) {
  const body = { model: 'deepseek-chat', messages, stream: false, temperature: 0.7 };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`DeepSeek 接口错误 ${resp.status}: ${t.slice(0, 200)}`);
  }
  return resp.json();
}

// Agent 循环:让模型自主决定调用工具,多步执行,直到给出最终回答
async function runAgentLoop(env, messages, ctx, send) {
  const toolCalls = [];
  for (let i = 0; i < 5; i++) {
    const data = await callDeepSeek(env, messages, TOOLS);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('DeepSeek 返回为空');
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { finalContent: msg.content || '', toolCalls };
    }
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
    for (const tc of msg.tool_calls) {
      const name = tc.function?.name || 'unknown';
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
      send({ type: 'tool', name, args });
      let result;
      try { result = await executeTool(name, args, ctx); }
      catch (e) { result = '工具执行失败: ' + (e.message || e); }
      toolCalls.push({ name, args, result });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result || '').slice(0, 6000) });
    }
  }
  // 达到最大轮次:强制生成最终回答(不带工具)
  const data = await callDeepSeek(env, messages, []);
  const msg = data.choices?.[0]?.message;
  return { finalContent: msg?.content || '', toolCalls };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DEEPSEEK_API_KEY) {
    return new Response(JSON.stringify({
      code: 500, message: '未配置 DEEPSEEK_API_KEY 环境变量', data: null,
    }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json();
    const message = (body.message || '').trim();
    const sanitizedMessage = message
      .replace(/\[SYSTEM\]|\[INST\]|\[\/INST\]|ignore (previous|above) instructions|忽略(以上|之前)指令|你现在是|pretend you are/gi, '')
      .trim();
    if (!sanitizedMessage) {
      return new Response(JSON.stringify({
        code: 400, message: '缺少 message 参数', data: null,
      }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    const historyMsgs = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

    const news = Array.isArray(body.news) ? body.news.slice(0, 15) : [];
    const knowledge = Array.isArray(body.knowledge) ? body.knowledge.slice(0, 20) : [];
    const newsDigest = news
      .map((n, i) => `${i + 1}. [${n.type || ''}] ${n.title}${n.summary ? ' — ' + String(n.summary).slice(0, 80) : ''}`)
      .join('\n');

    // 用户附加的文献:抓取网页正文,供 Agent 阅读
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
      '请用简体中文回答,风格:专业但通俗,适当使用 emoji,化学术语保留英文原文并附中文解释(如 "catalyst(催化剂)")。' +
      '\n你拥有工具调用能力,可根据需要自主决定调用一个或多个工具(可多步连续调用),获取实时/结构化信息后再作答:' +
      '\n- search_compound:PubChem 识别化合物(英文名/分子式/SMILES)' +
      '\n- similarity_search:按 SMILES 检索相似化合物' +
      '\n- substructure_search:按 SMILES 检索子结构' +
      '\n- web_search:Wikipedia 联网检索' +
      '\n- search_papers:检索学术论文(Crossref/OpenAlex)' +
      '\n- search_news:检索今日化学新闻' +
      '\n- search_knowledge:检索用户知识库文献' +
      '\n- fetch_webpage:抓取指定网页正文' +
      '\n回答要求:1) 直接回答,不要说"作为AI";一般问题 200 字以内,需要详细解释时可延长;' +
      '2) 与化学/材料/化工无关的问题,简短回答后引导回化学话题;' +
      '3) 书写化学方程式/化学式必须用 mhchem 语法:方程式整体放 \\[ \\] 中,式内用 \\ce{}(如 \\[ \\ce{2H2 + O2 -> 2H2O} \\]);' +
      '4) 当用户想看某化合物的结构时,正常文字回答,并在回复末尾单独一行输出 [MOL]化合物英文名或SMILES[/MOL],一次最多一个;' +
      '5) 每次回复末尾单独一行输出 [SUGGEST]问题1|问题2|问题3[/SUGGEST],3 个推荐追问,用 | 分隔,各 20 字以内;' +
      '6) 关键结论标注引用 [1] [2],并在回复末尾(SUGGEST 之前)输出 [REFS]每行 [n] 来源标题 - URL[/REFS];' +
      '7) 涉及具体反应(写出 \\ce 方程式)时,在末尾输出 [RXN]反应物SMILES>>生成物SMILES[/RXN],不确定 SMILES 则不要输出该标记;' +
      (attachSection
        ? '\n8) 用户附加了文献,请优先依据文献网页内容回答,并在回答开头注明依据哪篇文献(如「根据《标题》…」)。'
        : '') +
      (newsDigest ? `\n\n今日化学新闻清单:\n${newsDigest}` : '') +
      (attachSection ? `\n\n用户附加的文献:\n${attachSection}` : '');

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMsgs,
      { role: 'user', content: sanitizedMessage.slice(0, 2000) },
    ];

    const ctx = { news, knowledge };
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj) => controller.enqueue(encoder.encode('data: ' + JSON.stringify(obj) + '\n\n'));
        try {
          const { finalContent, toolCalls } = await runAgentLoop(env, messages, ctx, send);
          const text = finalContent || '';
          const step = 6;
          for (let i = 0; i < text.length; i += step) {
            send({ type: 'text', delta: text.slice(i, i + step) });
            await new Promise(r => setTimeout(r, 12));
          }
          send({ type: 'done', toolCalls: toolCalls.map(t => ({ name: t.name, args: t.args, result: String(t.result || '').slice(0, 200) })) });
        } catch (e) {
          send({ type: 'error', message: e.message || String(e) });
        } finally {
          controller.close();
        }
      },
      cancel() {},
    });

    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      code: 500, message: e.message, data: null,
    }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
}
