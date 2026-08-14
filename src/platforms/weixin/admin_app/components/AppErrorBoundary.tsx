import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Activity, RotateCw } from 'lucide-react';
import { sanitizeAdminError } from '../api/adminApi';
import { Button } from './ui/Button';

type AppErrorBoundaryProps = {
  children: ReactNode;
  onDiagnostics: () => void;
  onReload: () => void;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Weixin admin render failure', sanitizeAdminError(error.message), info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error" role="alert">
        <div className="app-error__panel">
          <span className="app-error__mark"><Activity aria-hidden="true" /></span>
          <h1>管理页面暂时无法显示</h1>
          <p>{sanitizeAdminError(this.state.error.message)}</p>
          <div className="app-error__actions">
            <Button icon={<Activity />} onClick={this.props.onDiagnostics}>运行诊断</Button>
            <Button variant="primary" icon={<RotateCw />} onClick={this.props.onReload}>重新加载</Button>
          </div>
        </div>
      </main>
    );
  }
}
