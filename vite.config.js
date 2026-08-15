import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 多页构建:助手页作为独立入口,输出为 dist/assistant-src/index.html,再由 copy-static 复制到根目录 assistant.html
// 源目录命名为 assistant-src,避免与线上 assistant.html 的 clean URL(/assistant) 冲突
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        assistant: fileURLToPath(new URL('./assistant-src/index.html', import.meta.url)),
      },
    },
  },
});
