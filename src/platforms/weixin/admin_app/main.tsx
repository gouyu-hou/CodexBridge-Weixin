import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

const root = document.getElementById('admin-root');
if (!root) {
  throw new Error('Missing Weixin admin root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
document.documentElement.dataset.adminReady = 'true';
