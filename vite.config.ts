import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { flovartBridge } from './tools/flovart/flovart-bridge.js';

// Tauri 期望固定端口，开发时失败则退出而非随机换端口
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => {
    return {
      // Cloudflare Pages / GitHub Pages 用绝对路径，Tauri 用相对路径。
      // 允许 VITE_BASE_PATH / CF_PAGES_BASEPATH / CLI --base 覆盖，
      // 不再把 base 写死成 "./"——否则部署到 /Flovart/ 子路径会白屏。
      base:
        process.env.VITE_BASE_PATH ||
        process.env.CF_PAGES_BASEPATH ||
        (process.env.CF_PAGES ? '/' : './'),
      server: {
        port: 3217,
        host: host || '127.0.0.1',
        strictPort: true,
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
      },
      plugins: [tailwindcss(), react(), flovartBridge()],
      // 排除独立 HTML 文件，避免 esbuild 扫描其内联脚本报错
      optimizeDeps: {
        entries: ['index.html'],
        esbuildOptions: {
          target: 'es2022',
          treeShaking: true,
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom'],
              'vendor-genai': ['@google/genai'],
              'vendor-tiptap': ['@tiptap/core', '@tiptap/react', '@tiptap/starter-kit', '@tiptap/extension-mention', '@tiptap/suggestion'],
              'vendor-ffmpeg': ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
            },
          },
        },
      },
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
      },
    };
});
