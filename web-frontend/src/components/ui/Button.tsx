import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  fullWidth?: boolean;
};

const variants = {
  primary:
    "bg-teal text-white hover:bg-teal-bright shadow-sm disabled:bg-line disabled:text-muted",
  secondary:
    "bg-navy text-white hover:bg-navy-soft disabled:bg-navy/40",
  ghost:
    "bg-transparent text-slate ring-1 ring-line hover:bg-line/60",
  danger: "bg-danger text-white hover:opacity-90",
};

export function Button({
  variant = "primary",
  fullWidth,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${
        fullWidth ? "w-full" : ""
      } ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
