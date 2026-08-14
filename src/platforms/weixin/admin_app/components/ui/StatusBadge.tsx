import type { ReactNode } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Info,
} from 'lucide-react';

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusTone;
};

const toneIcons = {
  error: AlertCircle,
  info: Info,
  neutral: Circle,
  success: CheckCircle2,
  warning: AlertTriangle,
} as const;

export function StatusBadge({ children, tone = 'neutral' }: StatusBadgeProps) {
  const Icon = toneIcons[tone];
  return (
    <span className="status-badge" data-tone={tone}>
      <Icon data-testid="status-icon" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
