
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterHost } from './RouterHost';
import { bootstrapRuntimeCredentials } from './services/bootstrapRuntimeCredentials';
import { installCrashLog } from './utils/crashLog';
import { installDshEmbedBridge } from './services/dshEmbedBridge';
import { installLlmCorsProxy } from './services/llmCorsProxy';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles/index.css';
import './styles/adaptive.css';
import './styles/dshEmbed.css';

installCrashLog();
installDshEmbedBridge();
// Web 端：OpenCode Go 等不支持浏览器 CORS 的网关走同源代理 /api/llm-proxy。
installLlmCorsProxy();

void bootstrapRuntimeCredentials().catch(() => {
  // Browser builds and unavailable Desktop IPC keep using the encrypted Web Vault.
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <RouterHost />
    </AppErrorBoundary>
  </React.StrictMode>
);

// Readiness marker for smoke/e2e harnesses: set only after the module has
// executed and React has mounted, so a bare HTML fetch cannot pass early on
// a cold Vite compile.
document.body?.setAttribute('data-flovart-mounted', '1');
