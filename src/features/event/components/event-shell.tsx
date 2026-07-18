"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EventBar,
  type EventBarEvent,
} from "@/features/event/components/event-bar";
import { EventNavSidebar } from "@/features/event/components/event-nav-sidebar";
import { getEventNavItem } from "@/features/event/event-nav";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "eventa-event-sidebar-collapsed";

// Breadcrumb segment after the event name, derived from the sub-route:
// /dashboard/events/[eventId]/<segment>/... → "Edit", "Registration Form", …
function getTrailingCrumb(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);

  // ["dashboard", "events", eventId, subSegment, ...]
  const subSegment = segments[3];

  if (!subSegment) {
    return null;
  }

  if (subSegment === "edit") {
    return "Edit";
  }

  return getEventNavItem(subSegment)?.title ?? null;
}

interface EventShellProps {
  eventId: string;
  /** undefined → the layout is still resolving the event (bar skeleton). */
  event: EventBarEvent | undefined;
  children?: React.ReactNode;
  statusAction?: React.ReactNode;
}

export function EventShell({ eventId, event, children, statusAction }: EventShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);

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
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <aside
        className={cn(
          "hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:shrink-0 lg:border-r lg:border-border lg:bg-card/95 lg:backdrop-blur-xl lg:transition-[width]",
          desktopSidebarCollapsed ? "lg:w-24" : "lg:w-80",
        )}
      >
        <EventNavSidebar
          eventId={eventId}
          pathname={pathname}
          collapsed={desktopSidebarCollapsed}
          onToggleCollapse={toggleDesktopSidebar}
        />
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <EventBar
          event={event}
          statusAction={statusAction}
          trailingCrumb={getTrailingCrumb(pathname)}
          leading={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-full lg:hidden"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open event navigation</span>
            </Button>
          }
        />

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children ?? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-40 w-full rounded-3xl" />
              <Skeleton className="h-40 w-full rounded-3xl" />
            </div>
          )}
        </main>
      </div>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          className="left-0 top-0 h-dvh w-[88vw] max-w-[19rem] translate-x-0 translate-y-0 rounded-none border-r border-border p-0 sm:max-w-[19rem]"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Event navigation</DialogTitle>
          <div className="flex items-center justify-end px-4 pt-4">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => setMobileNavOpen(false)}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close event navigation</span>
            </Button>
          </div>
          <div className="h-[calc(100%-4rem)]">
            <EventNavSidebar
              eventId={eventId}
              pathname={pathname}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
