// 实验报告生成 API
// 从新闻中提取实验信息:标题/时间/团队、试剂器材、反应机理/方程式、注意事项

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// 简化版网页抓取:HTMLRewriter 提取正文
async function fetchPageText(url) {
  if (!url) return '';
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return '';
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return '';
    let text = '';
    const rewritten = new HTMLRewriter()
      .on('p, h1, h2, h3, li, blockquote, td', {
        text(t) { text += t.text; if (t.lastInTextNode) text += '\n'; },
      })
      .transform(resp);
    await rewritten.text();
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return text.slice(0, 3000);
  } catch { return ''; }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

// 归一化:保证字段类型正确,避免前端渲染崩溃
function toStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(' ');
  return String(v);
}
function toArray(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (v == null) return [];
  if (typeof v === 'string') return v.split(/\n+|;|；|,|，/).map(s => s.trim()).filter(Boolean);
  return [String(v)];
}
function normalizeReport(r) {
  return {
    title: toStr(r.title),
    time: toStr(r.time),
    team: toStr(r.team),
    reagents: toArray(r.reagents),
    equipment: toArray(r.equipment),
    mechanism: toStr(r.mechanism),
    notes: toArray(r.notes),
  };
}

// 从 AI 输出中提取最外层 JSON 对象(去掉 markdown 围栏与前后杂文)
function extractJson(text) {
  let t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return t;
  return t.slice(start, end + 1);
}

// 修复 LaTeX 在 JSON 字符串中的非法转义:单个反斜杠(如 \[ \ce) → 双反斜杠
function fixLatexEscapes(s) {
  return String(s).replace(/(?<!\\)\\(?![\\\/bfnrtu"'])/g, '\\\\');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DEEPSEEK_API_KEY) {
    return new Response(JSON.stringify({ code: 500, message: '未配置 DEEPSEEK_API_KEY' }), { status: 500, headers: CORS_HEADERS });
  }

  try {
    const body = await request.json();
    const { title, url, summary, source, time } = body;

    if (!title) {
      return new Response(JSON.stringify({ code: 400, message: '缺少新闻标题' }), { status: 400, headers: CORS_HEADERS });
    }

    // 抓取网页正文
    const pageContent = await fetchPageText(url);

    const systemPrompt = String.raw`你是一位化学实验报告撰写专家。请根据以下新闻内容,生成一份结构化实验报告。

新闻标题: ${title}
来源: ${source || '未知'}
时间: ${time || '未知'}
摘要: ${summary || ''}
网页正文: ${pageContent ? pageContent.substring(0, 3000) : '(网页抓取失败,请基于标题和摘要推断)'}

请严格按照以下 JSON 格式输出(不要输出任何其他内容,不要 markdown 代码块,直接输出纯 JSON):
{
  "title": "新闻标题",
  "time": "新闻时间",
  "team": "工作团队或研究人员",
  "reagents": ["试剂1", "试剂2"],
  "equipment": ["器材1", "器材2"],
  "mechanism": "反应机理描述,方程式用 \[ 与 \] 包裹",
  "notes": ["注意事项1", "注意事项2"]
}

要求:
1. team:从网页中提取研究团队、机构、作者;未提及则写"未提及"
2. reagents:从网页提取试剂名称和规格;未提及则根据反应类型合理推断(必须是数组)
3. equipment:从网页提取器材;未提及则根据实验类型推断常见器材(烧杯、容量瓶、磁力搅拌器、色谱柱等)(必须是数组)
4. mechanism:从网页提取真实反应机理。若涉及化学方程式,使用 mhchem 语法,每个方程式用 \[ 与 \] 包裹(最终显示为 \[ \ce{2H2 + O2 -> 2H2O} \])。若新闻不涉及化学反应,写"本新闻不涉及化学反应"。
5. notes:基于实验内容给出安全操作要点(毒性、易燃性、温控、防护等)(必须是数组)
6. 全部用中文,化学术语保留英文

【JSON 转义规则·务必遵守】JSON 字符串中的反斜杠必须写成两个反斜杠 \\ 来转义,否则 JSON 非法、无法解析。输出时:
- 要表示 \[ 请写 \\[
- 要表示 \ce{...} 请写 \\ce{...}
正确示例: "mechanism": "反应机理... \\[ \\ce{2H2 + O2 -> 2H2O} \\]"`;

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: systemPrompt }],
        temperature: 0.3,
        stream: false,
      }),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ code: 502, message: `DeepSeek 错误: ${resp.status}` }), { status: 502, headers: CORS_HEADERS });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 多级容错解析:直接解析 → 提取 JSON 对象 → 修复 LaTeX 非法转义后再解析
    let report = null;
    try { report = JSON.parse(content.trim()); } catch {}
    if (!report) { try { report = JSON.parse(extractJson(content)); } catch {} }
    if (!report) { try { report = JSON.parse(fixLatexEscapes(extractJson(content))); } catch {} }
    if (!report) { try { report = JSON.parse(fixLatexEscapes(content.trim())); } catch {} }

    if (!report) {
      return new Response(JSON.stringify({ code: 500, message: 'AI 输出格式解析失败,请重试', raw: content.substring(0, 500) }), { status: 500, headers: CORS_HEADERS });
    }

    report = normalizeReport(report);
    return new Response(JSON.stringify({ code: 200, data: report }), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), { status: 500, headers: CORS_HEADERS });
  }
}
