// 订阅监控:每 6 小时检查订阅关键词是否有新论文/新闻/撤稿
// 调用方式:定时 Worker(huaxue-news-cron)POST /cron/check-updates 触发
// (Cloudflare Pages Functions 不支持原生 Cron Triggers,由独立 Worker 定时请求本接口)

import { fetchGDELT, fetchCrossref } from '../api/external.js';

async function runCheck(env) {
  if (!env.DB) return { ok: true, inserted: 0, skipped: true };

  let inserted = 0;
  try {
    // 获取所有活跃订阅
    const { results: subs } = await env.DB.prepare(
      'SELECT * FROM subscriptions WHERE active = 1'
    ).all();

    if (!subs || subs.length === 0) return { ok: true, inserted: 0, skipped: true };

    // 获取最新新闻作为匹配源
    const gdeltNews = await fetchGDELT().catch(() => []);
    const crossrefNews = await fetchCrossref().catch(() => []);
    const allNews = [...gdeltNews, ...crossrefNews];

    // 对每个订阅,检查是否有新匹配
    for (const sub of subs) {
      const keyword = sub.keyword.toLowerCase();
      const matches = allNews.filter(n =>
        (n.title || '').toLowerCase().includes(keyword) ||
        (n.summary || '').toLowerCase().includes(keyword)
      );

      // 检查撤稿:标题含 retract/withdraw
      const retractions = allNews.filter(n =>
        /retract|withdraw/i.test(n.title) &&
        (n.title || '').toLowerCase().includes(keyword)
      );

      const newMatches = [...matches, ...retractions].slice(0, 5);

      for (const match of newMatches) {
        // 避免重复通知
        const existing = await env.DB.prepare(
          'SELECT id FROM notifications WHERE client_id = ? AND title = ? AND url = ?'
        ).bind(sub.client_id, match.title, match.url).first();

        if (!existing) {
          await env.DB.prepare(
            'INSERT INTO notifications (client_id, subscription_id, title, url, snippet) VALUES (?, ?, ?, ?, ?)'
          ).bind(sub.client_id, sub.id, match.title, match.url, (match.summary || '').substring(0, 200)).run();
          inserted++;
        }
      }

      // 更新最后通知时间
      await env.DB.prepare(
        'UPDATE subscriptions SET last_notified = datetime(\'now\') WHERE id = ?'
      ).bind(sub.id).run();
    }
  } catch (e) {
    console.error('Cron check failed:', e.message);
    return { ok: false, inserted, error: e.message };
  }
  return { ok: true, inserted };
}

// 由定时 Worker 通过 HTTP 调用
export async function onRequestPost(context) {
  const result = await runCheck(context.env);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// 保留 scheduled 语义(当前 Cloudflare Pages 不派发 scheduled 事件,仅供文档说明)
export async function onSchedule(event, env) {
  await runCheck(env);
}
