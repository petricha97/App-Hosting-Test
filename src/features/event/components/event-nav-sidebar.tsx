"use client";

import Link from "next/link";
import { ArrowLeft, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-card/95">
      <div className={cn("space-y-3 py-5", collapsed ? "px-2" : "px-3")}>
        <Link
          href="/dashboard/events"
          onClick={onNavigate}
          title={collapsed ? "All events" : undefined}
          className={cn(
            "flex items-center rounded-2xl text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground",
            collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
            navRowFocusClasses,
          )}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
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
              "rounded-full",
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
        className={cn("flex-1 space-y-1 pb-6 pt-2", collapsed ? "px-2" : "px-3")}
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
                  "px-3 pb-1 pt-4 text-xs uppercase tracking-[0.2em] text-muted-foreground",
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
                          ? "justify-center px-2 py-2.5"
                          : "gap-3 px-3 py-2.5",
                        isActive
                          ? "bg-primary/10 text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        navRowFocusClasses,
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition",
                          isActive
                            ? "bg-background text-primary shadow-sm"
                            : "bg-muted text-muted-foreground group-hover:bg-background group-hover:text-foreground",
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
                              "ml-auto rounded-full text-[10px]",
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
