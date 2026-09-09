import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri 期望固定端口；CLI source bootstrap 通过 FLOVART_DYNAMIC_WEB_PORT
// 显式启用动态端口，避免把用户带到无关的 localhost 服务。
const host = process.env.TAURI_DEV_HOST;
const dynamicPort = process.env.FLOVART_DYNAMIC_WEB_PORT === '1';
const configuredPort = Number(process.env.FLOVART_WEB_PORT);

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
        port: configuredPort > 0 ? configuredPort : 37522,
        host: host || '127.0.0.1',
        strictPort: !dynamicPort,
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cache-Control': 'no-store',
        },
      },
      plugins: [tailwindcss(), react()],
      // 排除独立 HTML 文件，避免 esbuild 扫描其内联脚本报错
      optimizeDeps: {
        entries: ['index.html'],
        esbuildOptions: {
          target: 'es2022',
          treeShaking: true,
        },
      },
      resolve: {
        // 优先加载 .tsx/.ts 源文件，避免陈旧未跟踪 .js 副本遮蔽源码
        extensions: ['.tsx', '.ts', '.jsx', '.js', '.json', '.mjs'],
        // dsh-plugin pins an independent RC8 dev graph; host tests still need
        // one shared React dispatcher.
        dedupe: ['react', 'react-dom'],
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
        // Windows hosts can exhaust fork/handle resources at Vitest's
        // auto-detected worker count; four workers keep the full suite
        // deterministic without changing test isolation.
        maxWorkers: 4,
      },
    };
});
