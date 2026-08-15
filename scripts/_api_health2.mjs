// 后端 API 补充体检(带参数)
const base = 'https://huaxue-news.pages.dev';
const news = (await (await fetch(base + '/api/v1/news')).json()).news || [];
const first = news[0] || {};
const second = news[1] || {};

const apis = [
  ['POST', '/api/ai/translate', { titles: [first.title || 'test'], from: 'en', to: 'zh' }],
  ['POST', '/api/ai/hottags', { news: news.map(n => ({ title: n.title, summary: n.summary })).slice(0, 8) }],
  ['POST', '/api/ai/search', { query: 'catalyst', news: news.map(n => ({ title: n.title, summary: n.summary })).slice(0, 8) }],
  ['POST', '/api/experiment-report', { title: first.title || '', summary: first.summary || '', url: first.url || '' }],
  ['GET', '/api/subscribe?client_id=health-check', null],
  ['GET', '/api/track', null],
];

async function main() {
  const out = [];
  for (const [method, path, body] of apis) {
    try {
      const r = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      let summary;
      try {
        const j = JSON.parse(text);
        summary = 'code=' + j.code + ' ' + (j.message || '');
        if (path.includes('experiment')) summary += ' title=' + (j.data?.title || '');
        if (path.includes('hottags')) summary += ' tags=' + JSON.stringify(j.data).slice(0, 100);
      } catch { summary = text.slice(0, 100); }
      out.push(`${r.status} ${method} ${path} → ${summary}`);
    } catch (e) {
      out.push(`ERR ${method} ${path} → ${e.message}`);
    }
  }
  console.log(out.join('\n'));
}
main();
