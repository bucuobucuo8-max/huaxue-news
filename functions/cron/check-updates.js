// Cron 触发器:每 6 小时检查订阅关键词是否有新论文/新闻/撤稿
// 需要在 wrangler.toml 中配置 crons 和 D1 绑定

import { fetchGDELT, fetchCrossref } from '../api/external.js';

export async function onSchedule(event, env) {
  if (!env.DB) return;

  try {
    // 获取所有活跃订阅
    const { results: subs } = await env.DB.prepare(
      'SELECT * FROM subscriptions WHERE active = 1'
    ).all();

    if (!subs || subs.length === 0) return;

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
        }
      }

      // 更新最后通知时间
      await env.DB.prepare(
        'UPDATE subscriptions SET last_notified = datetime(\'now\') WHERE id = ?'
      ).bind(sub.id).run();
    }
  } catch (e) {
    console.error('Cron check failed:', e.message);
  }
}
