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
    // 提示注入防护:移除可能操控 AI 行为的指令性文本
    const sanitizedMessage = message
      .replace(/\[SYSTEM\]|\[INST\]|\[\/INST\]|ignore (previous|above) instructions|忽略(以上|之前)指令|你现在是|pretend you are/gi, '')
      .trim();
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
      identifyStructure(sanitizedMessage),
      searchWikipedia(sanitizedMessage),
    ]);
    const webContext = [structureInfo, wikiInfo].filter(Boolean).join('\n');

    // 检测特殊模式
    const isDeepRead = /深度阅读|解读论文|拆解这篇|详细分析这|精读/.test(sanitizedMessage) && articles.length > 0;
    const isCompare = /对比分析|比较这|对比这|证据矩阵|综合对比/.test(sanitizedMessage) && articles.length >= 2;
    const isHypothesis = /提出假设|生成假设|假说|可验证假设/.test(sanitizedMessage);
    const isExperiment = /实验设计|设计实验|实验方案|实验计划/.test(sanitizedMessage);
    const isTimeline = /时间线|演变|发展历程|如何演变|观点演变/.test(sanitizedMessage);
    const isControversy = /争议|矛盾|相互冲突|分歧/.test(sanitizedMessage);
    const isAgentTask = /找出.{0,20}(进展|论文|研究).{0,20}(排除|比较|生成|报告|总结)|帮我.{0,10}(调研|检索|搜索|查).{0,20}(论文|文献|研究)/.test(sanitizedMessage);

    const systemPrompt =
      '你是「化学智能体」,一位面向化学专业学生与研究员的 AI 助手,运行在一个化学新闻简讯网站上。' +
      '请用简体中文回答,风格:专业但通俗,适当使用 emoji,化学术语保留英文原文并附中文解释(如 "catalyst(催化剂)""electrophile(亲电试剂)"),避免翻译损失专业含义。' +
      '回答要求:1) 直接回答问题,不要说"作为AI";2) 一般问题控制在 200 字以内,需要详细解释时可适当延长;' +
      '3) 如果问题与今日新闻相关,主动引用下方新闻清单中的条目(用「标题」格式引用);' +
      '4) 与化学/材料/化工无关的问题,简短回答后引导回化学话题;' +
      '5) 本平台支持分子结构可视化:当用户想看某化合物的结构式/分子式/分子模型/结构图(任意表述,如"生成…的可视化图像""画一下…"),' +
      '正常用文字回答,并在回复末尾单独一行输出标记 [MOL]化合物英文名或SMILES[/MOL],前端会自动渲染结构图;' +
      '不要说自己无法生成图像;一次最多输出一个 [MOL] 标记;' +
      '6) 书写化学方程式/化学式时,必须使用 mhchem 语法:方程式整体放在 \\[ \\] 中,式内用 \\ce{} 书写(如 \\[ \\ce{2H2 + O2 -> 2H2O} \\]),反应条件写在箭头上(如 \\ce{->[催化剂]}),前端会用 MathJax 渲染为标准化学排版,不要输出图片或纯文本方程式;' +
      '7) 每次回复末尾必须单独一行输出推荐追问标记 [SUGGEST]问题1|问题2|问题3[/SUGGEST]:3 个用户可能感兴趣的后续问题,用 | 分隔,每条 20 字以内,具体且与化学/今日新闻/当前话题相关(例如"布洛芬的结构式""今日热点有哪些""这条新闻的意义"),前端会渲染为可点击的推荐按钮。' +
      '\n11) 【证据级引用】每个关键结论后标注引用来源,格式 [1] [2]。在回复末尾(SUGGEST标记之前)输出参考文献块 [REFS]每条占一行: [n] 来源标题 - URL[/REFS]。附加文献按顺序编号 [1][2][3],联网检索继续编号。每个关键结论用括号标注证据类型:(文献事实) (模型推断) (存在争议)。' +
      (isDeepRead
        ? '\n12) 【论文深度阅读模式】对附加文献结构化解读,用以下板块(**加粗标题**开头): **研究问题与假设** / **实验方法** / **关键数据**(数值和统计显著性) / **主要结论** / **局限性** / **可复现步骤** / **"作者声称" vs "数据实际支持"**(区分过度解读与数据支撑)。每板块标注引用[1]。'
        : '') +
      (isCompare
        ? '\n12) 【对比分析模式】生成 Markdown 证据矩阵表格(用|分隔),列: 论文|研究问题|方法|样本/条件|关键结果|局限性|证据等级(A/B/C)。表格后用文字解释结果一致或冲突及差异来源。标注引用[1][2]。'
        : '') +
      (isHypothesis
        ? '\n13) 【假设生成器】基于知识库和已知文献,提出 2-3 个可验证的科学假设。每个假设包含: 假设陈述 / 依据(引用[1]) / 潜在反证 / 建议的验证实验(变量、对照、预期结果)。明确标注(模型推断)。'
        : '') +
      (isExperiment
        ? '\n13) 【实验设计助手】输出结构化实验设计方案: 研究目标 / 自变量与因变量 / 实验组与对照组 / 样本量与重复 / 测量指标与方法 / 潜在混杂因素及控制 / 数据分析方案 / 所需仪器试剂。'
        : '') +
      (isTimeline
        ? '\n13) 【结论时间线】按年份梳理某个科学观点/技术/发现的演变历程,输出 Markdown 时间线: **年份** - 关键事件/发现(引用来源) - 当时学界态度。标注哪些观点被后续推翻或修正。'
        : '') +
      (isControversy
        ? '\n13) 【争议雷达】识别当前话题中相互矛盾的研究结论,输出: 争议焦点 / 支持方观点与证据(引用) / 反对方观点与证据(引用) / 差异来源分析(方法差异/样本差异/条件差异) / 当前共识(如有)。'
        : '') +
      (isAgentTask
        ? '\n13) 【科研 Agent 工作流】用户提出了研究任务,请按步骤执行: 1. 搜索(基于今日新闻和知识库) 2. 去重筛选 3. 提取关键信息 4. 验证引用 5. 生成结构化报告。每步标注进度,允许用户检查。最终输出含引用的研究简报。'
        : '') +
      '\n14) 【证据等级评分】当评估文献或研究结论时,给出多维证据评分(不只是一个总分): 样本规模(大/中/小) / 研究类型(综述/RCT/观察/个案) / 期刊影响力 / 重复验证情况 / 撤稿记录。用表格展示。' +
      (attachSection
        ? '\n8) 用户附加了文献,请优先依据文献网页内容回答,并在回答开头注明依据的是哪篇文献(如「根据《标题》…」);若网页内容抓取失败,基于标题与摘要回答并说明;若附加了多篇文献,可以跨文献综合、对比、归纳回答;此时推荐追问应围绕附加文献。'
        : '') +
      (webContext
        ? '\n9) 下方附有联网检索结果,请优先依据它回答并自然注明来源(如"据 Wikipedia");若包含 PubChem 结构识别结果,说明该物质是什么、有何用途,并在回复末尾输出对应的 [MOL] 标记(使用识别结果中的 SMILES 或英文名)以便前端渲染结构图。'
        : '') +
      '\n10) 当回复涉及具体化学反应(你写出了 \\ce 方程式)时,在回复末尾输出反应演示标记 [RXN]反应物SMILES>>生成物SMILES[/RXN]:反应物与生成物用合法 SMILES 书写,多个物质用小数点分隔(如 [RXN]CH4.O=O>>C(=O)=O.O[/RXN]),不含系数、条件和箭头;若不确定任一物质的合法 SMILES,则不要输出该标记;前端会渲染球棍模型动态演示。' +
      (newsDigest ? `\n\n今日化学新闻清单:\n${newsDigest}` : '') +
      (webContext ? `\n\n联网检索结果:\n${webContext}` : '') +
      (attachSection ? `\n\n用户附加的文献:\n${attachSection}` : '');

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMsgs,
      { role: 'user', content: sanitizedMessage.slice(0, 2000) },
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
          controller.close();
        } catch (e) {
          // 流中断时发送错误信号,避免客户端收到不完整回复
          controller.error(e);
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
