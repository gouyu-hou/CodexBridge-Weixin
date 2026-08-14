import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  icon?: ReactNode;
  variant?: ButtonVariant;
};

export function Button({
  busy = false,
  children,
  className = '',
  disabled,
  icon,
  type = 'button',
  variant = 'secondary',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`button button--${variant} ${className}`.trim()}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      <span className="button__icon" aria-hidden="true">
        {busy ? <LoaderCircle className="spin" /> : icon}
      </span>
      <span>{children}</span>
    </button>
  );
}
