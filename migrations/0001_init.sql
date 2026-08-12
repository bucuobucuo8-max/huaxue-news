-- 化学智能体学习站 D1 数据库迁移
-- 在 Cloudflare 控制台创建 D1 后执行此 SQL

-- 订阅表:用户关注的关键词/DOI/作者/靶点
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,           -- 匿名客户端 ID(localStorage 生成)
  keyword TEXT NOT NULL,             -- 订阅关键词
  type TEXT DEFAULT 'keyword',       -- keyword | doi | author | target | molecule
  created_at TEXT DEFAULT (datetime('now')),
  last_notified TEXT,                -- 上次通知时间
  active INTEGER DEFAULT 1
);

-- 通知记录:已推送的更新
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  subscription_id INTEGER,
  title TEXT NOT NULL,
  url TEXT,
  snippet TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  read INTEGER DEFAULT 0,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

-- 收藏持久化(替代/补充 D1)
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, title)
);

-- 访问统计
CREATE TABLE IF NOT EXISTS visit_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  visits INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  UNIQUE(date)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_sub_client ON subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_notif_client ON notifications(client_id);
CREATE INDEX IF NOT EXISTS idx_fav_client ON favorites(client_id);
