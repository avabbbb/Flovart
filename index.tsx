
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterHost } from './RouterHost';
import './styles/index.css';

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
