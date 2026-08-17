// 站内 AI 助手后端 —— 使用 Vercel AI SDK Core (streamText + tool)
// POST /api/ai/assistant
// body: { messages: UIMessage[] }  (useChat 默认协议)

import {
  streamText,
  tool,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  isStepCount,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const SYSTEM = `你是本化学新闻资料站的 AI 助手,同时具备扎实的化学专业知识。

【工具使用纪律 - 严格遵守】
- 默认直接回答,绝不调用任何工具。
- 只有用户明确表达「站内检索」意图时(如「站内有哪些xx相关」「帮我找/搜/查一下xx」「标题带xx」「有关于xx的新闻吗」「推荐几篇」)才调用 searchItems。
- 纯化学知识问答(元素、化合物、反应、机理、方程式、性质、用途等)一律直接回答,禁止调用任何工具。
- 与站内检索、化学都无关的问题,直接简短回答并引导回站内内容或化学话题,禁止调用工具。
- 禁止为了凑答案而调用工具:检索结果为空就明确告知未找到,绝不强行引用无关条目,绝不「联合检索」无关关键词。

【站内检索】
- 站内新闻条目的标题与摘要多为英文。调用 searchItems 时,把中文关键词翻译成英文再搜(如「催化剂」→ catalyst、「电池」→ battery、「蛋白质」→ protein);只引用工具返回的真实标题与链接,不要编造 id 或标题;空结果明确告知未找到并建议换英文关键词。

【阅读网页】
- 当用户发送网页链接/URL 并希望阅读该网页时,调用 readUrl 抓取正文再回答;只基于抓取到的正文总结,不要编造正文没有的信息。

【多轮对话与话题切换 - 严格遵守】
- 每次回答前先判断用户最新消息与前面对话的关系:
  - 若用户提出了与前面话题无关的全新问题(换了一个完全不同的话题),必须把该问题当作独立的、全新的问题直接回答。严禁延续上一话题的语境、引用上一话题的内容、把两个话题强行比较或联系起来。
  - 若用户是在追问前面的内容(如「它」「这个分子」「再说详细点」「刚才那个问题」),才可以基于前文上下文回答。
  - 判断不明确时,优先当作全新问题回答,不要生硬沿用前文语境。

【回答风格】
- 回答简洁,中文优先;站内检索可列 1~5 条结果并附标题与链接。`;

// 站内新闻条目缓存(5 分钟),避免每次工具调用都重复抓取外部源
let newsCache = null;
let newsCacheTs = 0;

async function getNewsItems(origin) {
  const now = Date.now();
  if (newsCache && now - newsCacheTs < 300000) return newsCache;
  try {
    const resp = await fetch(origin + '/api/v1/news');
    const json = await resp.json();
    const items = (json.news || []).map(n => ({
      id: String(n.id ?? ''),
      title: String(n.title || ''),
      url: String(n.url || ''),
      summary: String(n.summary || ''),
      category: String(n.category?.label || n.category?.key || ''),
    }));
    if (items.length) {
      newsCache = items;
      newsCacheTs = now;
    }
    return items;
  } catch {
    return newsCache || [];
  }
}

// 粗提取:HTML → 纯文本(正则兜底)
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

// 直接抓取网页正文:HTMLRewriter 提取,内容太少时正则全文兜底
async function fetchDirect(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  try {
    const resp = await fetch(url, { redirect: 'follow', headers, signal: AbortSignal.timeout(6000) });
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
    const raw = await fetch(url, { redirect: 'follow', headers, signal: AbortSignal.timeout(6000) });
    if (raw.ok) {
      const fallback = htmlToText(await raw.text());
      if (fallback.length > text.length) return fallback.slice(0, 3000);
    }
    return text;
  } catch {
    return '';
  }
}

// DOI 链接走 Crossref/Zenodo 官方 API,稳定不怕反爬
async function fetchViaDoiApi(url) {
  const m = url.match(/doi\.org\/(10\.\d{4,9}\/\S+)/i);
  if (!m) return '';
  const doi = m[1].replace(/[.\s]+$/, '');
  try {
    const zm = doi.match(/^10\.5281\/zenodo\.(\d+)$/i);
    if (zm) {
      const resp = await fetch(`https://zenodo.org/api/records/${zm[1]}`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (resp.ok) {
        const json = await resp.json();
        const text = (json.metadata?.title || '') + '\n' + htmlToText(json.metadata?.description || '');
        if (text.trim().length > 50) return text.trim().slice(0, 3000);
      }
      return '';
    }
    const resp = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) });
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

// 抓取网页正文(用于 readUrl 工具):DOI 优先走官方 API,否则直接抓取,取内容更长者
async function fetchPageText(url) {
  const [viaApi, direct] = await Promise.all([fetchViaDoiApi(url), fetchDirect(url)]);
  return (viaApi.length >= direct.length ? viaApi : direct).slice(0, 3000);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DEEPSEEK_API_KEY) {
    return new Response(JSON.stringify({ error: '未配置 DEEPSEEK_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json();
    // 限制历史轮数(最多最近 20 条),防止上下文过长
    const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];

    const openai = createOpenAI({
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    });
    const model = openai('deepseek-chat');
    const origin = new URL(request.url).origin;

    // Tool 1(必做):站内条目搜索
    const searchItems = tool({
      description: '仅在用户明确要求查找「站内新闻/资料」时使用(如:站内有哪些xx相关、帮我搜/找/查一下xx新闻、标题带xx的条目)。这是站内资料检索工具,不是通用搜索。普通化学知识问答、与站内资料无关的问题,不要调用本工具。按关键词在标题/摘要/分类中匹配,返回匹配条目的标题、链接与分类;无匹配时返回空数组 []。',
      inputSchema: z.object({
        query: z.string().describe('搜索关键词(中文关键词请先翻译成英文,如催化剂→catalyst)'),
        limit: z.number().int().min(1).max(10).optional().describe('返回条数上限,默认 5'),
      }),
      execute: async ({ query, limit }) => {
        const lim = Math.min(Math.max(limit || 5, 1), 10);
        const items = await getNewsItems(origin);
        const q = String(query || '').toLowerCase().trim();
        // 匹配:精确子串优先;英文词再做词根匹配,覆盖 catalyst/catalysis/catalyzed 等词形变化
        const matches = (text) => {
          const t = String(text || '').toLowerCase();
          if (!q) return false;
          if (t.includes(q)) return true;
          const words = q.match(/[a-z]{4,}/g) || [];
          return words.some((w) => t.includes(w.length > 6 ? w.slice(0, 6) : w));
        };
        // 空结果返回 [],交由模型明确告知「未找到」,绝不回退到无关条目
        const hits = items.filter(it => matches(it.title + ' ' + it.summary + ' ' + it.category));
        return hits.slice(0, lim).map(it => ({ id: it.id, title: it.title, url: it.url, category: it.category }));
      },
    });

    // Tool 2(强烈建议):按 id 取单条详情
    const getItemById = tool({
      description: '根据 id 获取单条站内新闻条目的详情(标题、链接、摘要、分类)。不存在返回 null。',
      inputSchema: z.object({
        id: z.union([z.string(), z.number()]).describe('条目 id'),
      }),
      execute: async ({ id }) => {
        const items = await getNewsItems(origin);
        const it = items.find(x => String(x.id) === String(id));
        return it ? { id: it.id, title: it.title, url: it.url, summary: it.summary, category: it.category } : null;
      },
    });

    // Tool 3:读取网页正文(用户把网页/新闻链接发给助手时使用)
    const readUrl = tool({
      description: '抓取指定 URL 的网页正文文本,用于阅读用户发送的网页、新闻或文献详情。抓取失败返回提示文本。',
      inputSchema: z.object({
        url: z.string().describe('要读取的网页 URL(以 http:// 或 https:// 开头)'),
      }),
      execute: async ({ url }) => {
        const u = String(url || '').trim();
        if (!/^https?:\/\//i.test(u)) return '无效的 URL,请提供以 http(s):// 开头的完整链接。';
        const text = await fetchPageText(u);
        return text ? text.slice(0, 3000) : '网页抓取失败或无正文(可能需要登录、反爬,或不是 HTML 页面)。';
      },
    });

    const result = streamText({
      model,
      instructions: SYSTEM,
      messages: await convertToModelMessages(messages),
      tools: { searchItems, getItemById, readUrl },
      stopWhen: isStepCount(5),
      temperature: 0.3,
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
