import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ToastProvider } from './context/ToastContext';
import './styles/index.css';

const root = document.getElementById('admin-root');
if (!root) {
  throw new Error('Missing Weixin admin root');
}

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary
      onDiagnostics={() => {
        window.location.hash = '#diagnostics';
        window.location.reload();
      }}
      onReload={() => window.location.reload()}
    >
      <ToastProvider>
        <App />
      </ToastProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
document.documentElement.dataset.adminReady = 'true';
