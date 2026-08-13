import { Link } from "react-router-dom";
import logoMark from "@/assets/logo-mark.svg";

type LogoProps = {
  to?: string;
  inverted?: boolean;
};

export function Logo({ to = "/", inverted = false }: LogoProps) {
  return (
    <Link to={to} className="inline-flex items-center gap-2.5 no-underline">
      <img
        src={logoMark}
        alt=""
        className="h-10 w-10 rounded-2xl object-cover ring-1 ring-teal/30"
      />
      <span className="leading-tight">
        <span
          className={`block text-lg font-semibold tracking-tight ${
            inverted ? "text-white" : "text-navy"
          }`}
        >
          AutoVault
        </span>
        <span
          className={`block text-[11px] uppercase tracking-[0.22em] ${
            inverted ? "text-teal-bright" : "text-teal"
          }`}
        >
          Sri Lanka
        </span>
      </span>
    </Link>
  );
}
