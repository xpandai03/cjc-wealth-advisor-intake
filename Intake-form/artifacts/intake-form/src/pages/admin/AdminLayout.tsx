import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, type Role } from "@/lib/auth-context";

/**
 * Wraps every /admin/* page (except /admin/signin). Reads the auth status
 * from AuthProvider; on unauthenticated, redirects to /admin/signin with a
 * `?next=` pointing at the current path so the user lands back here after
 * a successful login. Shows a floating tab nav (Links / Submissions /
 * Activity / Scoring Rules) and a user chip with logout.
 *
 * The server is the gate (every protected /api/* handler uses requireAuth).
 * This guard is UX, not security — but it removes the flash-of-content
 * problem on the client.
 */

// `roles` declares which roles see each tab. The server is the real gate
// (every /api/* handler uses requireRole) — this filtering is UX so a
// marketing user never sees a tab they'd be 403'd out of.
const TABS: Array<{
  to: string;
  label: string;
  match: (path: string) => boolean;
  roles: Role[];
  badgeQueryKey?: string;
}> = [
  { to: "/admin/links", label: "Links", match: (p) => p === "/admin/links" || p === "/admin", roles: ["admin", "marketing"] },
  { to: "/admin/submissions", label: "Submissions", match: (p) => p.startsWith("/admin/submissions"), roles: ["admin", "marketing"] },
  {
    to: "/admin/held-leads",
    label: "Held Leads",
    match: (p) => p.startsWith("/admin/held-leads"),
    roles: ["admin"],
    badgeQueryKey: "held-count",
  },
  { to: "/admin/activity", label: "Activity", match: (p) => p.startsWith("/admin/activity"), roles: ["admin", "marketing"] },
  { to: "/admin/scoring-rules", label: "Scoring Rules", match: (p) => p.startsWith("/admin/scoring-rules"), roles: ["admin"] },
  { to: "/admin/sources", label: "Sources", match: (p) => p.startsWith("/admin/sources"), roles: ["admin"] },
];

async function fetchHeldCount(): Promise<number> {
  const res = await fetch("/api/submissions/held?countOnly=1", {
    credentials: "same-origin",
  });
  if (!res.ok) return 0;
  const data = (await res.json()) as { count?: number };
  return Number(data.count ?? 0);
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { status, user, logout } = useAuth();

  // Count badge for the Held Leads tab. Admin-only — /api/submissions/held
  // 403s for marketing users, and they don't see the Held Leads tab anyway.
  const heldCountQuery = useQuery({
    queryKey: ["held-count"],
    queryFn: fetchHeldCount,
    enabled: status === "authenticated" && user?.role === "admin",
    refetchOnWindowFocus: true,
  });
  const heldCount = heldCountQuery.data ?? 0;

  useEffect(() => {
    if (status === "unauthenticated") {
      const next = encodeURIComponent(location);
      setLocation(`/admin/signin?next=${next}`, { replace: true });
      return;
    }
    // Role guard: if the current route maps to a tab the user's role can't
    // see (e.g. a marketing user deep-linking to /admin/scoring-rules),
    // bounce to /admin/links — the shared landing for both roles.
    if (status === "authenticated" && user) {
      const currentTab = TABS.find((t) => t.match(location));
      if (currentTab && !currentTab.roles.includes(user.role)) {
        setLocation("/admin/links", { replace: true });
      }
    }
  }, [status, location, setLocation, user]);

  if (status !== "authenticated" || !user) {
    return (
      <div
        className="min-h-screen flex items-center justify-center font-sans"
        // Same solid CJC red as the signed-in admin shell (was gradient; align
        // with Tab 1 / LinkGenerator #CD1C3A for one consistent brand canvas).
        style={{ background: "#CD1C3A" }}
      >
        <Loader2 className="w-6 h-6 animate-spin text-white" />
      </div>
    );
  }

  // Tabs the signed-in user's role is allowed to see. The server enforces
  // the same matrix on every endpoint; this just keeps the nav honest.
  const visibleTabs = TABS.filter((tab) => tab.roles.includes(user.role));

  return (
    <div
      className="min-h-screen font-sans"
      // Tab 1 (LinkGenerator) reference red — exact hex from logo blend comment.
      style={{ background: "#CD1C3A" }}
    >
      {/* Tab nav — bottom-fixed on mobile (full width, evenly distributed
          tabs visible without horizontal scroll), top-center floating pill
          on md+. On /admin/links the desktop pill drops to top-32 so the
          hero CJC logo sits above it; other admin pages keep top-4. */}
      <nav
        aria-label="Admin sections"
        className={
          "fixed z-50 " +
          // Mobile: stretched along the bottom of the viewport.
          "inset-x-3 bottom-3 " +
          // md+: centered floating pill at the top (reset bottom).
          "md:inset-x-auto md:bottom-auto md:left-1/2 md:-translate-x-1/2 md:max-w-[calc(100vw-2rem)] " +
          (location === "/admin/links" || location === "/admin"
            ? "md:top-32"
            : "md:top-4")
        }
      >
        <div
          className={
            "bg-white/95 backdrop-blur rounded-full px-1.5 py-1.5 shadow-lg border border-slate-200 " +
            // 5 tabs no longer fit equally on mobile — switch to horizontal
            // scroll so labels stay readable. Desktop unchanged.
            "flex items-center gap-0.5 overflow-x-auto no-scrollbar " +
            "md:gap-1"
          }
        >
          {visibleTabs.map((tab) => {
            const isActive = tab.match(location);
            const showBadge = tab.badgeQueryKey === "held-count" && heldCount > 0;
            return (
              <Link
                key={tab.to}
                href={tab.to}
                aria-current={isActive ? "page" : undefined}
                data-testid={`admin-tab-${tab.to.split("/").pop()}`}
                className={
                  "shrink-0 inline-flex items-center gap-1.5 text-center text-xs sm:text-sm font-medium px-2 sm:px-3.5 py-1.5 rounded-full transition-colors whitespace-nowrap " +
                  (isActive
                    ? "bg-[#A82020] text-white shadow-sm"
                    : "text-slate-700 hover:bg-slate-100")
                }
              >
                <span>{tab.label}</span>
                {showBadge && (
                  <span
                    data-testid="admin-tab-badge-held"
                    className={
                      "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold " +
                      (isActive
                        ? "bg-white/20 text-white"
                        : "bg-[#A82020] text-white")
                    }
                  >
                    {heldCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User chip — top-right. */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3 bg-white/95 backdrop-blur rounded-full pl-4 pr-2 py-2 shadow-lg border border-slate-200">
        <span
          className="text-sm font-medium text-slate-800 hidden sm:inline"
          data-testid="admin-user-chip"
        >
          {user.name}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void logout();
          }}
          className="h-8 px-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full"
          data-testid="admin-logout-btn"
        >
          <LogOut className="w-4 h-4" />
          <span className="sr-only">Sign out</span>
        </Button>
      </div>

      {children}
    </div>
  );
}
