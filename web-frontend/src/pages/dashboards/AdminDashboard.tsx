import { ClipboardCheck, ShieldAlert, Users } from "lucide-react";
import { Tile } from "@/components/dashboard/Tile";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useAuth } from "@/context/AuthContext";

export function AdminDashboard() {
  const { user } = useAuth();

  return (
    <DashboardShell title="Administrator console">
      <p className="mb-8 max-w-2xl text-sm leading-relaxed text-muted">
        Welcome, {user?.name}. This portal is isolated from buyer and dealer login.
        Metrics, dealer approval, and audit logs will bind to the admin-service next.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <Tile
          icon={<Users className="h-5 w-5" />}
          title="User management"
          body="Approve, reject, or deactivate dealer and buyer accounts through internal auth APIs."
        />
        <Tile
          icon={<ClipboardCheck className="h-5 w-5" />}
          title="Pending dealers"
          body="Verification status lives on auth.dealer_profiles. Approvals write verified_by / verified_at."
        />
        <Tile
          icon={<ShieldAlert className="h-5 w-5" />}
          title="Audit log"
          body="Sensitive admin actions are recorded in admin.audit_logs for later search."
        />
      </div>
    </DashboardShell>
  );
}
