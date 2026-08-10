import { useEffect } from "react";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut, Loader2 } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_portal")({
  ssr: false,
  component: PortalLayout,
});

function PortalLayout() {
  const { isAuthenticated, loading, account, isAdmin, signOutUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAuthenticated) void navigate({ to: "/", replace: true });
  }, [loading, isAuthenticated, navigate]);

  if (loading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">Loading your workspace…</span>
      </div>
    );
  }

  const initials = (account?.displayName || account?.email || "?")
    .split(/[\s@._]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="glass-panel sticky top-0 z-30 flex h-16 items-center gap-3 rounded-none border-x-0 border-t-0 px-4">
            <SidebarTrigger className="rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="font-display truncate text-sm font-semibold">SEED-IT Platform</p>
              <p className="truncate text-xs text-muted-foreground">
                {isAdmin ? "Full platform access" : `Scoped to ${account?.tenantId || "your tenant"}`}
              </p>
            </div>

            <Badge variant="secondary" className="hidden rounded-full px-3 py-1 text-xs sm:inline-flex">
              {account?.role}
            </Badge>

            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary-muted text-xs font-semibold text-accent-foreground">
                {initials}
              </span>
              <div className="max-w-[180px]">
                <p className="truncate text-xs font-semibold">{account?.displayName || "Administrator"}</p>
                <p className="truncate text-[11px] text-muted-foreground">{account?.email}</p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              className="rounded-lg"
              onClick={async () => {
                await signOutUser();
                void navigate({ to: "/", replace: true });
              }}
            >
              <LogOut className="size-4" />
            </Button>
          </header>

          <main className="scroll-slim min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
