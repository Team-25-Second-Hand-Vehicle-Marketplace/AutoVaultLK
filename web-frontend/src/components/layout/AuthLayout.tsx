import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import heroClassic from "@/assets/hero-classic.png";
import { Logo } from "@/components/brand/Logo";

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-navy lg:block">
        <img
          src={heroClassic}
          alt="Used hatchback on a Colombo street at blue hour"
          className="h-full w-full object-cover opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/50 to-navy/20" />
        <div className="absolute inset-x-0 bottom-0 p-10 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-bright">
            AutoVault LK
          </p>
          <p className="mt-3 text-3xl font-semibold leading-snug tracking-tight">
            Verified listings. Trusted dealers. One place for Sri Lanka’s next car.
          </p>
        </div>
      </div>

      <div className="flex flex-col bg-canvas px-5 py-8 sm:px-10">
        <div className="mb-8 flex items-center justify-between">
          <Logo />
          <Link
            to="/"
            className="text-sm text-muted no-underline hover:text-navy"
          >
            Back to home
          </Link>
        </div>
        <div className="mx-auto w-full max-w-md flex-1">
          <h1 className="text-3xl font-semibold tracking-tight text-navy">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8 text-sm text-muted">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
