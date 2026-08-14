import type { ButtonHTMLAttributes, ReactNode } from 'react';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> & {
  children: ReactNode;
  label: string;
  tone?: 'neutral' | 'danger';
};

export function IconButton({
  children,
  className = '',
  label,
  tone = 'neutral',
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      className={`icon-button icon-button--${tone} ${className}`.trim()}
      type={type}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
