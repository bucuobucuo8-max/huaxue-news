// 将 Vite 构建产物(dist/)并入站点根目录,便于 wrangler pages deploy . 一起上传
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');

const htmlSrc = resolve(dist, 'assistant-src', 'index.html');
if (!existsSync(htmlSrc)) {
  console.error('[copy-static] 未找到 dist/assistant-src/index.html,请先运行 npm run build');
  process.exit(1);
}

// 助手页 HTML(其内部已引用 /assets/* 绝对路径,复制到根目录即可)
cpSync(htmlSrc, resolve(root, 'assistant.html'));

// 静态资源(js/css)
const assetsDist = resolve(dist, 'assets');
const assetsRoot = resolve(root, 'assets');
rmSync(assetsRoot, { recursive: true, force: true });
if (existsSync(assetsDist)) {
  mkdirSync(assetsRoot, { recursive: true });
  cpSync(assetsDist, assetsRoot, { recursive: true });
}

console.log('[copy-static] 已同步 assistant.html 与 assets/ 到站点根目录');
