import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CarFront,
  ShieldCheck,
  Store,
} from "lucide-react";
import heroShowroom from "@/assets/hero-showroom.png";
import heroClassic from "@/assets/hero-classic.png";
import { PublicHeader } from "@/components/layout/PublicHeader";

const steps = [
  {
    title: "Browse verified stock",
    body: "Search live listings with filters or natural language. Guests can look; saving favourites needs a buyer account.",
  },
  {
    title: "Register the right role",
    body: "Buyers start immediately after email verification. Dealers submit documents and wait for administrator approval.",
  },
  {
    title: "Buy, list, or administer",
    body: "Each role lands in its own workspace — favourites for buyers, inventory for dealers, approvals for admins.",
  },
];

export function LandingPage() {
  return (
    <div className="bg-navy text-white">
      <section className="relative min-h-svh overflow-hidden">
        <img
          src={heroShowroom}
          alt="Used cars on a lot under cool teal showroom lights"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/80 to-navy/30" />
        <PublicHeader />
        <div className="relative mx-auto flex min-h-svh max-w-6xl flex-col justify-end px-5 pb-16 pt-32">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-bright">
            Second-hand vehicle marketplace
          </p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
            Find the next car. List the last one. All inside one vault.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75">
            AutoVault LK connects buyers with verified dealers across Sri Lanka.
            Sign in with the account type that matches how you use the platform.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth/register/buyer"
              className="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-3 text-sm font-semibold text-white no-underline hover:bg-teal-bright"
            >
              Create buyer account <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/auth/register/dealer"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/20 no-underline hover:bg-white/15"
            >
              Register as a dealer
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-canvas text-slate">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-16 lg:grid-cols-3">
          <RoleCard
            icon={<CarFront className="h-6 w-6" />}
            title="Buyers"
            body="Search listings, open vehicle details, and keep a personal favourites list once you are signed in."
            to="/auth/login"
            action="Buyer sign in"
          />
          <RoleCard
            icon={<Store className="h-6 w-6" />}
            title="Dealers"
            body="Create a pending dealership, verify your email, then wait for admin approval before listing stock."
            to="/auth/login?role=dealer"
            action="Dealer sign in"
          />
          <RoleCard
            icon={<ShieldCheck className="h-6 w-6" />}
            title="Administrators"
            body="Seeded staff accounts use a separate login. Approve dealers, review users, and watch the audit trail."
            to="/auth/login/admin"
            action="Admin portal"
          />
        </div>
      </section>

      <section className="bg-canvas text-slate">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-20 lg:grid-cols-2">
          <img
            src={heroClassic}
            alt="Used hatchback on a Colombo street at blue hour"
            className="h-[420px] w-full rounded-3xl object-cover shadow-xl ring-1 ring-line"
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal">
              How it works
            </p>
            <h2 className="mt-2 text-4xl font-semibold tracking-tight text-navy">
              Three doors. One marketplace.
            </h2>
            <ol className="mt-8 space-y-5">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-teal-bright">
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-navy">{step.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-navy-soft">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} AutoVault LK · Group 25</p>
          <p className="inline-flex items-center gap-1.5">
            <BadgeCheck className="h-4 w-4 text-success" />
            Dealer verification required before listings go live
          </p>
        </div>
      </footer>
    </div>
  );
}

function RoleCard({
  icon,
  title,
  body,
  to,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  to: string;
  action: string;
}) {
  return (
    <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-line">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-navy text-teal-bright">
        {icon}
      </div>
      <h3 className="mt-4 text-2xl font-semibold tracking-tight text-navy">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      <Link
        to={to}
        className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-teal no-underline hover:text-teal-bright"
      >
        {action} <ArrowRight className="h-4 w-4" />
      </Link>
    </article>
  );
}
