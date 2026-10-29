
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterHost } from './RouterHost';
import { bootstrapRuntimeCredentials } from './services/bootstrapRuntimeCredentials';
import { installCrashLog } from './utils/crashLog';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles/index.css';
import './styles/adaptive.css';

installCrashLog();

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
