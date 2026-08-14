import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { StatusTone } from './StatusBadge';

type InlineAlertProps = {
  children: ReactNode;
  title: string;
  tone?: Exclude<StatusTone, 'neutral'>;
};

const alertIcons = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
} as const;

export function InlineAlert({ children, title, tone = 'info' }: InlineAlertProps) {
  const Icon = alertIcons[tone];
  return (
    <div className="inline-alert" data-tone={tone} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <div><strong>{title}</strong><p>{children}</p></div>
    </div>
  );
}
