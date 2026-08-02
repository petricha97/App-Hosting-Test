"use client";

import Link from "next/link";
import { ArrowLeft, Building2, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";
import { buildEventNavHref, eventNavGroups } from "@/features/event/event-nav";
import { cn } from "@/lib/utils";

interface EventNavSidebarProps {
  eventId: string;
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
}

const navRowFocusClasses =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function EventNavSidebar({
  eventId,
  pathname,
  collapsed = false,
  onNavigate,
  onToggleCollapse,
}: EventNavSidebarProps) {
  const { organization } = useAuth();
  const orgName = organization?.name ?? "Eventa";
  const orgLogoUrl = organization?.logoUrl ?? null;

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
              alt={orgName}
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
            <p className="text-base font-semibold text-slate-950">{orgName}</p>
          </div>
        </div>

        <Link
          href="/dashboard/events"
          onClick={onNavigate}
          title={collapsed ? "All events" : undefined}
          className={cn(
            "group flex items-center rounded-2xl text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950",
            collapsed ? "justify-center px-2 py-3" : "gap-3 px-3 py-3",
            navRowFocusClasses,
          )}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-white group-hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" />
          </span>
          <span className={cn(collapsed && "hidden")}>All events</span>
        </Link>

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

      <nav
        aria-label="Event sections"
        className={cn(
          "sidebar-scroll flex-1 space-y-1 overflow-y-auto pb-6 pt-2",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {eventNavGroups.map((group) => {
          const labelId = `event-nav-group-${group.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")}`;

          return (
            <div key={group.label} role="group" aria-labelledby={labelId}>
              <p
                id={labelId}
                className={cn(
                  "px-3 pb-1 pt-4 text-xs uppercase tracking-[0.2em] text-slate-500",
                  collapsed && "sr-only",
                )}
              >
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const href = buildEventNavHref(eventId, item.segment);
                  const isActive = item.exact
                    ? pathname === href
                    : pathname === href || pathname.startsWith(`${href}/`);

                  return (
                    <Link
                      key={item.segment || "overview"}
                      href={href}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      title={
                        collapsed
                          ? item.comingSoon
                            ? `${item.title} — coming soon`
                            : item.title
                          : undefined
                      }
                      className={cn(
                        "group flex items-center rounded-2xl text-sm font-semibold transition",
                        collapsed
                          ? "justify-center px-2 py-3"
                          : "gap-3 px-3 py-3",
                        isActive
                          ? "bg-orange-50 text-slate-950 shadow-sm"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                        navRowFocusClasses,
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition",
                          isActive
                            ? "bg-white text-orange-900 shadow-sm"
                            : "bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-950",
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                      </span>
                      <span className={cn("truncate", collapsed && "hidden")}>
                        {item.title}
                      </span>
                      {item.comingSoon ? (
                        <>
                          <span className="sr-only">(coming soon)</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "ml-auto rounded-full border-slate-200 bg-white text-[10px] text-slate-600",
                              collapsed && "hidden",
                            )}
                          >
                            Soon
                          </Badge>
                        </>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
