-- 访客追踪表
CREATE TABLE IF NOT EXISTS visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  page TEXT,
  referrer TEXT,
  country TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 收藏表
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  news_title TEXT NOT NULL,
  news_url TEXT,
  news_source TEXT,
  news_type TEXT,
  news_summary TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 新闻统计表(缓存收藏数,提高查询效率)
CREATE TABLE IF NOT EXISTS news_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  news_title TEXT UNIQUE NOT NULL,
  news_url TEXT,
  news_source TEXT,
  news_type TEXT,
  favorite_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_favorites_visitor ON favorites(visitor_id);
CREATE INDEX IF NOT EXISTS idx_favorites_title ON favorites(news_title);
CREATE INDEX IF NOT EXISTS idx_visitors_visitor ON visitors(visitor_id);
CREATE INDEX IF NOT EXISTS idx_news_stats_count ON news_stats(favorite_count DESC);
