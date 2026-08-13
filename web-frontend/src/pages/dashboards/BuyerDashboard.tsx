import { Heart, Search, UserRound } from "lucide-react";
import { Tile } from "@/components/dashboard/Tile";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useAuth } from "@/context/AuthContext";

export function BuyerDashboard() {
  const { user } = useAuth();

  return (
    <DashboardShell title={`Hello, ${user?.name.split(" ")[0] ?? "buyer"}`}>
      <p className="mb-8 max-w-2xl text-sm leading-relaxed text-muted">
        Your buyer workspace is ready. Search and favourites will attach to the
        marketplace APIs next; this screen is the post-login home for FR-16 and FR-17.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <Tile
          icon={<Search className="h-5 w-5" />}
          title="Browse listings"
          body="Open the public catalogue. Saving a favourite will prompt guests to log in."
        />
        <Tile
          icon={<Heart className="h-5 w-5" />}
          title="Favourites"
          body="Authenticated buyers can save and remove vehicles from a personal list."
        />
        <Tile
          icon={<UserRound className="h-5 w-5" />}
          title="Profile"
          body={`${user?.email} · account is ${user?.isActive ? "active" : "pending activation"}.`}
        />
      </div>
    </DashboardShell>
  );
}
