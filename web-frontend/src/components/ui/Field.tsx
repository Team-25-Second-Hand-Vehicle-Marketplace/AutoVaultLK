import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type FieldProps = {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
};

export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 block text-sm font-medium text-slate">{label}</span>
      {children}
      {hint && !error ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : null}
    </label>
  );
}

const controlClass =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-slate outline-none transition placeholder:text-muted/70 focus:border-teal focus:ring-2 focus:ring-teal/20";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={controlClass} {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${controlClass} min-h-24 resize-y`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={controlClass} {...props} />;
}
