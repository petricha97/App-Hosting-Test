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
  Plus,
  Sparkles,
  X,
} from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { dashboardNavItems } from "@/features/dashboard/nav";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  children: React.ReactNode;
  serverUser: {
    name: string;
    email: string;
    picture: string;
  };
}

function getPageMeta(pathname: string) {
  if (pathname === "/dashboard") {
    return {
      title: "Overview",
      subtitle: "A high-level view of your workspace, drafts, and next steps.",
      breadcrumbs: ["Dashboard", "Overview"],
    };
  }

  if (pathname === "/dashboard/events") {
    return {
      title: "Events",
      subtitle: "Create events, track status, and keep every setup task moving.",
      breadcrumbs: ["Dashboard", "Events"],
    };
  }

  if (pathname === "/dashboard/events/new") {
    return {
      title: "Create Event",
      subtitle: "Shape the event workspace before real data and validation rules are finalized.",
      breadcrumbs: ["Dashboard", "Events", "Create Event"],
    };
  }

  const eventMatch = pathname.match(
    /^\/dashboard\/events\/([^/]+)(?:\/(form|responses))?$/,
  );

  if (eventMatch) {
    const eventId = decodeURIComponent(eventMatch[1]);
    const childRoute = eventMatch[2];

    if (childRoute === "form") {
      return {
        title: "Form Builder",
        subtitle: "Event-owned registration form design lives here.",
        breadcrumbs: ["Dashboard", "Events", eventId, "Form Builder"],
      };
    }

    if (childRoute === "responses") {
      return {
        title: "Responses",
        subtitle: "Review submissions and response details for this event.",
        breadcrumbs: ["Dashboard", "Events", eventId, "Responses"],
      };
    }

    return {
      title: "Event Overview",
      subtitle: "Use this hub to manage the event, form, and response flows.",
      breadcrumbs: ["Dashboard", "Events", eventId],
    };
  }

  if (pathname === "/dashboard/forms") {
    return {
      title: "Forms",
      subtitle: "Browse event-owned forms and reusable templates across your active workspace.",
      breadcrumbs: ["Dashboard", "Forms"],
    };
  }

  if (pathname === "/dashboard/forms/templates") {
    return {
      title: "Templates",
      subtitle: "Manage reusable registration templates for future event forms.",
      breadcrumbs: ["Dashboard", "Forms", "Templates"],
    };
  }

  if (pathname === "/dashboard/forms/templates/new") {
    return {
      title: "New Template",
      subtitle: "Design a reusable registration template for your workspace.",
      breadcrumbs: ["Dashboard", "Forms", "Templates", "New Template"],
    };
  }

  const templateMatch = pathname.match(/^\/dashboard\/forms\/templates\/([^/]+)$/);

  if (templateMatch) {
    const templateId = decodeURIComponent(templateMatch[1]);

    return {
      title: "Template Editor",
      subtitle: "Update template fields and apply new versions to linked event forms.",
      breadcrumbs: ["Dashboard", "Forms", "Templates", templateId],
    };
  }

  if (pathname === "/dashboard/responses") {
    return {
      title: "Responses",
      subtitle: "Track registrations and submissions across all events.",
      breadcrumbs: ["Dashboard", "Responses"],
    };
  }

  if (pathname === "/dashboard/iam") {
    return {
      title: "Users & Access",
      subtitle: "Invite teammates, shape roles, and keep organization access understandable.",
      breadcrumbs: ["Dashboard", "Users & Access"],
    };
  }

  return {
    title: "Settings",
    subtitle: "Manage the active workspace profile and prepare for future team features.",
    breadcrumbs: ["Dashboard", "Settings"],
  };
}

const SIDEBAR_STORAGE_KEY = "eventa-dashboard-sidebar-collapsed";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function SidebarContent({
  pathname,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
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
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ffb082,#ff7a59)] text-sm font-semibold text-white shadow-sm">
            E
          </span>
          <div className={cn("space-y-1", collapsed && "hidden")}>
            <p className="text-base font-semibold text-slate-950">Eventa</p>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Dashboard
            </p>
          </div>
        </div>

        {collapsed ? (
          <Button
            asChild
            size="icon"
            className="mx-auto flex rounded-full"
            title="Create event"
          >
            <Link href="/dashboard/events/new" onClick={onNavigate}>
              <Plus className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button asChild className="w-full justify-center rounded-full">
            <Link href="/dashboard/events/new" onClick={onNavigate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Event
            </Link>
          </Button>
        )}

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
                  : "flex items-start gap-3 px-3 py-3",
                isActive
                  ? "bg-orange-50 text-slate-950 shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition",
                  isActive
                    ? "bg-white text-orange-900 shadow-sm"
                    : "bg-slate-100 text-slate-500 group-hover:bg-white",
                )}
              >
                <item.icon className="h-4 w-4" />
              </span>
              <span className={cn("space-y-1", collapsed && "hidden")}>
                <span className="block text-sm font-semibold">{item.title}</span>
                <span className="block text-xs leading-5 text-slate-500">
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className={cn("pb-5", collapsed ? "px-2" : "px-4")}>
        <div className="rounded-[1.5rem] border border-orange-100 bg-[#fff4ea] p-4">
          <div
            className={cn(
              "flex items-center text-orange-900",
              collapsed ? "justify-center" : "gap-2",
            )}
          >
            <Sparkles className="h-4 w-4" />
            <p className={cn("text-sm font-semibold", collapsed && "hidden")}>
              v1 dashboard scaffold
            </p>
          </div>
          <p className={cn("mt-2 text-xs leading-6 text-slate-600", collapsed && "hidden")}>
            This shell is built to support events, event-owned forms, and
            response workflows before the Firestore schema is fully finalized.
          </p>
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({
  children,
  serverUser,
}: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const {
    user,
    userDoc,
    organization,
    signOut,
    initializing,
  } = useAuth();

  const pageMeta = useMemo(() => getPageMeta(pathname), [pathname]);
  const userName =
    userDoc?.name ?? user?.displayName ?? serverUser.name ?? "Workspace user";
  const userEmail = userDoc?.email ?? user?.email ?? serverUser.email;
  const userAvatar =
    userDoc?.avatarUrl ?? user?.photoURL ?? serverUser.picture ?? "";
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
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        String(nextValue),
      );
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
                  <span key={`${crumb}-${index}`} className="flex items-center gap-2">
                    {index > 0 ? <ChevronRight className="h-3.5 w-3.5" /> : null}
                    <span>{crumb}</span>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                <div className="space-y-1">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                    {pageMeta.title}
                  </h1>
                  <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    {pageMeta.subtitle}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Badge
                    variant="outline"
                    className="rounded-full border-orange-200 bg-white px-3 py-1 text-[11px] tracking-[0.18em] text-orange-900"
                  >
                    {workspaceLabel}
                  </Badge>
                  <Button asChild className="rounded-full">
                    <Link href="/dashboard/events/new">
                      <Plus className="mr-2 h-4 w-4" />
                      Create Event
                    </Link>
                  </Button>
                </div>
              </div>
            </div>

            <details
              className="relative hidden lg:block"
              open={userMenuOpen}
              onToggle={(event) =>
                setUserMenuOpen((event.currentTarget as HTMLDetailsElement).open)
              }
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm transition hover:border-slate-300">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={userAvatar} alt={userName} />
                  <AvatarFallback>{getInitials(userName)}</AvatarFallback>
                </Avatar>
                <div className="text-left">
                  <p className="text-sm font-semibold text-slate-950">{userName}</p>
                  <p className="text-xs text-slate-500">{userEmail}</p>
                </div>
              </summary>
              <div className="absolute right-0 top-[calc(100%+0.75rem)] w-72 rounded-3xl border border-slate-200 bg-white p-4 shadow-xl">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-950">{userName}</p>
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
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
