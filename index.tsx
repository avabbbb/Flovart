
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterHost } from './RouterHost';
import { bootstrapRuntimeCredentials } from './services/bootstrapRuntimeCredentials';
import './styles/index.css';

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
    <RouterHost />
  </React.StrictMode>
);
