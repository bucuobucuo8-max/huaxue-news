// 后端 API 快速体检
const base = 'https://huaxue-news.pages.dev';
const apis = [
  ['GET', '/api/v1/news', null],
  ['GET', '/api/external', null],
  ['GET', '/api/data', null],
  ['GET', '/api/ranking', null],
  ['GET', '/api/ai/motd', null],
  ['GET', '/api/favorites?visitor_id=health-check', null],
  ['POST', '/api/ai/compound', { name: '咖啡因' }],
  ['POST', '/api/ai/explain', { title: 'test' }],
  ['POST', '/api/ai/translate', { text: 'hello' }],
  ['POST', '/api/ai/dailybrief', {}],
  ['POST', '/api/ai/hottags', {}],
  ['POST', '/api/ai/recommend', { favorites: [], news: [] }],
  ['POST', '/api/ai/search', { query: 'catalyst' }],
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
      let text = await r.text();
      let summary;
      try {
        const j = JSON.parse(text);
        summary = 'code=' + j.code + ' ' + (j.message || '');
        if (path.includes('ranking')) summary += ' data=' + JSON.stringify(j.data).slice(0, 120);
        if (path.includes('motd')) summary += ' data=' + JSON.stringify(j.data).slice(0, 160);
      } catch { summary = text.slice(0, 100); }
      out.push(`${r.status} ${method} ${path} → ${summary}`);
    } catch (e) {
      out.push(`ERR ${method} ${path} → ${e.message}`);
    }
  }
  console.log(out.join('\n'));
}
main();
