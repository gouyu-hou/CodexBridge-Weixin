import type { ReactNode } from 'react';

type PanelProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  subtitle?: string;
  title?: string;
};

export function Panel({ actions, children, className = '', subtitle, title }: PanelProps) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <header className="panel__header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}
