import { ClipboardList, Upload, Warehouse } from "lucide-react";
import { Tile } from "@/components/dashboard/Tile";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useAuth } from "@/context/AuthContext";

export function DealerDashboard() {
  const { user } = useAuth();

  return (
    <DashboardShell title="Dealer workspace">
      <div className="mb-8 rounded-3xl border border-success/20 bg-success/10 px-5 py-4 text-sm text-slate">
        Signed in as <span className="font-semibold text-navy">{user?.email}</span>.
        This demo dealership is verified — listings and bulk upload can be wired next.
        Pending dealers would see an amber notice instead.
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Tile
          icon={<Warehouse className="h-5 w-5" />}
          title="My listings"
          body="Create, edit, and deactivate your own vehicles once the account is verified."
        />
        <Tile
          icon={<Upload className="h-5 w-5" />}
          title="Bulk upload"
          body="Business dealers upload CSV/JSON plus a ZIP of images through the ingest API."
        />
        <Tile
          icon={<ClipboardList className="h-5 w-5" />}
          title="Job status"
          body="Poll upload jobs and download row-level rejection reports after ETL runs."
        />
      </div>
    </DashboardShell>
  );
}
