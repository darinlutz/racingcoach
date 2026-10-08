import type { ButtonHTMLAttributes } from 'react';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';

const variants = {
  racing: 'bg-primary text-primary-foreground rounded-sm hover:bg-primary/85 uppercase font-semibold text-xs tracking-wider',
  racingOutline: 'border border-border bg-transparent text-foreground rounded-sm hover:bg-secondary uppercase font-semibold text-xs tracking-wider',
  default: 'bg-primary text-primary-foreground rounded-md shadow hover:bg-primary/90',
  outline: 'border border-border bg-background rounded-md shadow-sm hover:bg-accent',
  ghost: 'rounded-md hover:bg-accent',
};

const sizes = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
  icon: 'h-9 w-9',
};

// Racing variants are taller with wider padding at the default size
const racingSizes = {
  default: 'h-11 px-6',
  sm: 'h-9 px-4',
  icon: 'h-9 w-9',
};

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

// Class string for anything styled as a button, e.g. a Link
export function buttonVariants({ variant = 'default', size = 'default', className = '' }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  const sizing = variant === 'racing' || variant === 'racingOutline' ? racingSizes[size] : sizes[size];
  return [base, variants[variant], sizing, className].filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

export default function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonVariants({ variant, size, className })} {...props} />;
}
