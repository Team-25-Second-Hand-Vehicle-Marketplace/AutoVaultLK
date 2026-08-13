import { Link } from "react-router-dom";

type RoleTabsProps = {
  active: "buyer" | "dealer" | "admin";
  mode: "login" | "register";
};

export function RoleTabs({ active, mode }: RoleTabsProps) {
  const buyerTo = mode === "login" ? "/auth/login" : "/auth/register/buyer";
  const dealerTo =
    mode === "login" ? "/auth/login?role=dealer" : "/auth/register/dealer";

  return (
    <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-line/70 p-1">
      <Link
        to={buyerTo}
        className={`rounded-xl px-3 py-2 text-center text-sm font-semibold no-underline ${
          active === "buyer" ? "bg-white text-navy shadow-sm" : "text-muted"
        }`}
      >
        Buyer
      </Link>
      <Link
        to={dealerTo}
        className={`rounded-xl px-3 py-2 text-center text-sm font-semibold no-underline ${
          active === "dealer" ? "bg-white text-navy shadow-sm" : "text-muted"
        }`}
      >
        Dealer
      </Link>
    </div>
  );
}
