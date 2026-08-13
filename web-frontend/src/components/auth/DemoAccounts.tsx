type DemoAccountsProps = {
  variant: "public" | "admin";
};

const PUBLIC_ACCOUNTS = [
  { role: "Buyer", email: "buyer@autovault.lk" },
  { role: "Dealer", email: "dealer@autovault.lk" },
];

export function DemoAccounts({ variant }: DemoAccountsProps) {
  const rows =
    variant === "admin"
      ? [{ role: "Admin", email: "admin@autovault.lk" }]
      : PUBLIC_ACCOUNTS;

  return (
    <div className="rounded-2xl border border-line bg-white p-4 text-left text-xs text-muted">
      <p className="font-semibold text-navy">Local demo accounts</p>
      <p className="mt-1">Password for all: Password1</p>
      <ul className="mt-2 space-y-1">
        {rows.map((row) => (
          <li key={row.email}>
            <span className="font-medium text-slate">{row.role}:</span> {row.email}
          </li>
        ))}
      </ul>
    </div>
  );
}
