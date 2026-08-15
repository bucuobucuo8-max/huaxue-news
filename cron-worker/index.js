// 订阅监控定时器:每 6 小时请求站内的 /cron/check-updates 接口
// (Cloudflare Pages Functions 不支持原生 Cron,由本 Worker 的 Cron 定时触发)
export default {
  async scheduled(controller, env, ctx) {
    try {
      const res = await fetch('https://huaxue-news.pages.dev/cron/check-updates', {
        method: 'POST',
      });
      console.log(`[check-updates] HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      console.error('[check-updates] failed:', e.message);
    }
  },
};
