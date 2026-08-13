import type { ReactNode } from "react";

export function Tile({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-line">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-navy text-teal-bright">
        {icon}
      </div>
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-navy">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </article>
  );
}
