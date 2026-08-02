"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Menu,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { dashboardNavItems } from "@/features/dashboard/nav";
import { useAuth } from "@/contexts/AuthContext";
import { cn, getInitials } from "@/lib/utils";

interface DashboardShellProps {
  children: React.ReactNode;
  serverUser: {
    name: string;
    email: string;
    picture: string;
  };
}

function getPageMeta(pathname: string) {
  switch (pathname) {
    case "/dashboard":
      return {
        title: "Overview",
        breadcrumbs: ["Dashboard", "Overview"],
      };
    case "/dashboard/events":
      return {
        title: "Events",
        breadcrumbs: ["Dashboard", "Events"],
      };
    case "/dashboard/events/new":
      return {
        title: "Create Event",
        breadcrumbs: ["Dashboard", "Events", "Create Event"],
      };
    case "/dashboard/forms":
      return {
        title: "Forms",
        breadcrumbs: ["Dashboard", "Forms"],
      };
    case "/dashboard/variables":
      return {
        title: "Variables",
        breadcrumbs: ["Dashboard", "Variables"],
      };
    case "/dashboard/forms/templates":
      return {
        title: "Templates",
        breadcrumbs: ["Dashboard", "Forms", "Templates"],
      };
    case "/dashboard/forms/templates/new":
      return {
        title: "New Template",
        breadcrumbs: ["Dashboard", "Forms", "Templates", "New Template"],
      };
    case "/dashboard/responses":
      return {
        title: "Responses",
        breadcrumbs: ["Dashboard", "Responses"],
      };
    case "/dashboard/iam":
      return {
        title: "Users & Access",
        breadcrumbs: ["Dashboard", "Users & Access"],
      };
  }

  // Event detail routes (/dashboard/events/[eventId]/...) render inside the
  // (event) route group's EventShell, so no event branches are needed here.
  const templateMatch = pathname.match(
    /^\/dashboard\/forms\/templates\/([^/]+)$/,
  );

  if (templateMatch) {
    const templateId = decodeURIComponent(templateMatch[1]);

    return {
      title: "Template Editor",
      breadcrumbs: ["Dashboard", "Forms", "Templates", templateId],
    };
  }

  return {
    title: "Settings",
    breadcrumbs: ["Dashboard", "Settings"],
  };
}

const SIDEBAR_STORAGE_KEY = "eventa-dashboard-sidebar-collapsed";

function SidebarContent({
  pathname,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  orgName,
  orgLogoUrl,
}: {
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  orgName?: string;
  orgLogoUrl?: string | null;
}) {
  return (
    <div className="flex h-full flex-col bg-white/95">
      <div className={cn("space-y-6 py-5", collapsed ? "px-3" : "px-4")}>
        <div
          className={cn(
            "flex items-center px-2",
            collapsed ? "justify-center" : "gap-3",
          )}
        >
          <Avatar className="h-11 w-11 rounded-full">
            <AvatarImage
              src={orgLogoUrl ?? undefined}
              alt={orgName ?? "Eventa"}
              className="object-cover"
            />
            <AvatarFallback className="rounded-full bg-[linear-gradient(135deg,#ffb082,#ff7a59)] text-sm font-semibold text-white">
              {orgName ? (
                orgName[0]?.toUpperCase()
              ) : (
                <Building2 className="h-5 w-5" />
              )}
            </AvatarFallback>
          </Avatar>
          <div className={cn(collapsed && "hidden")}>
            <p className="text-base font-semibold text-slate-950">
              {orgName ?? "Eventa"}
            </p>
          </div>
        </div>

        {onToggleCollapse ? (
          <Button
            type="button"
            variant="outline"
            size={collapsed ? "icon" : "sm"}
            className={cn(
              "rounded-full border-slate-200 bg-white shadow-sm",
              collapsed ? "mx-auto flex" : "w-full justify-center",
            )}
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" />
                Collapse sidebar
              </>
            )}
          </Button>
        ) : null}
      </div>

      <Separator />

      <nav className={cn("flex-1 space-y-2 py-5", collapsed ? "px-2" : "px-3")}>
        {dashboardNavItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={collapsed ? item.title : undefined}
              className={cn(
                "group rounded-2xl transition",
                collapsed
                  ? "flex justify-center px-2 py-3"
                  : "flex items-center gap-3 px-3 py-3",
                isActive
                  ? "bg-orange-50 text-slate-950 shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl transition",
                  isActive
                    ? "bg-white text-orange-900 shadow-sm"
                    : "bg-slate-100 text-slate-500 group-hover:bg-white",
                )}
              >
                <item.icon className="h-4 w-4" />
              </span>
              <span className={cn("flex items-center", collapsed && "hidden")}>
                <span className="block text-sm font-semibold">
                  {item.title}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function DashboardShell({ children, serverUser }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { user, userDoc, organization, signOut, initializing } = useAuth();

  const pageMeta = useMemo(() => getPageMeta(pathname), [pathname]);
  const userName =
    userDoc?.name ?? user?.displayName ?? serverUser.name ?? "Workspace user";
  const userEmail = userDoc?.email ?? user?.email ?? serverUser.email;
  const userAvatar =
    userDoc?.avatarUrl ?? user?.photoURL ?? serverUser.picture ?? "";
  const orgName = organization?.name ?? undefined;
  const orgLogoUrl = organization?.logoUrl ?? null;
  const workspaceLabel =
    organization?.name ??
    (initializing
      ? "Loading workspace..."
      : userDoc?.organizationId
        ? "Active workspace"
        : "Single active workspace");

  async function handleLogout() {
    await signOut();
    await fetch("/api/auth/session", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    setDesktopSidebarCollapsed(storedValue === "true");
  }, []);

  function toggleDesktopSidebar() {
    setDesktopSidebarCollapsed((currentValue) => {
      const nextValue = !currentValue;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextValue));
      return nextValue;
    });
  }

  return (
    <div className="min-h-screen bg-[#f7f3ec] text-slate-950 lg:flex">
      <aside
        className={cn(
          "hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:shrink-0 lg:border-r lg:border-slate-200/70 lg:bg-white/80 lg:backdrop-blur-xl lg:transition-[width]",
          desktopSidebarCollapsed ? "lg:w-24" : "lg:w-80",
        )}
      >
        <SidebarContent
          pathname={pathname}
          collapsed={desktopSidebarCollapsed}
          onToggleCollapse={toggleDesktopSidebar}
          orgName={orgName}
          orgLogoUrl={orgLogoUrl}
        />
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#f7f3ec]/90 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-full lg:hidden"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open sidebar</span>
            </Button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                {pageMeta.breadcrumbs.map((crumb, index) => (
                  <span
                    key={`${crumb}-${index}`}
                    className="flex items-center gap-2"
                  >
                    {index > 0 ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : null}
                    <span>{crumb}</span>
                  </span>
                ))}
              </div>
            </div>

            <details
              className="relative hidden lg:block"
              open={userMenuOpen}
              onToggle={(event) =>
                setUserMenuOpen(
                  (event.currentTarget as HTMLDetailsElement).open,
                )
              }
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm transition hover:border-slate-300">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={userAvatar} alt={userName} />
                  <AvatarFallback>{getInitials(userName)}</AvatarFallback>
                </Avatar>
                <div className="text-left">
                  <p className="text-sm font-semibold text-slate-950">
                    {userName}
                  </p>
                  <p className="text-xs text-slate-500">{userEmail}</p>
                </div>
              </summary>
              <div className="absolute right-0 top-[calc(100%+0.75rem)] w-72 rounded-3xl border border-slate-200 bg-white p-4 shadow-xl">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-950">
                    {userName}
                  </p>
                  <p className="text-sm text-slate-500">{userEmail}</p>
                </div>
                <Separator className="my-4" />
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Workspace
                  </p>
                  <p className="text-sm text-slate-700">{workspaceLabel}</p>
                </div>
                <Separator className="my-4" />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center rounded-full"
                  onClick={handleLogout}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </Button>
              </div>
            </details>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="space-y-6">{children}</div>
        </main>
      </div>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          className="left-0 top-0 h-dvh w-[88vw] max-w-[19rem] translate-x-0 translate-y-0 rounded-none border-r border-slate-200 p-0 sm:max-w-[19rem]"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Dashboard navigation</DialogTitle>
          <div className="flex items-center justify-end px-4 pt-4">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => setMobileNavOpen(false)}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close sidebar</span>
            </Button>
          </div>
          <div className="h-[calc(100%-4rem)]">
            <SidebarContent
              pathname={pathname}
              onNavigate={() => setMobileNavOpen(false)}
              orgName={orgName}
              orgLogoUrl={orgLogoUrl}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
