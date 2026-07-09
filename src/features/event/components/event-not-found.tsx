import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Rendered by the event layout when the event does not exist or belongs to
 * another organization. The two cases are intentionally indistinguishable so
 * event existence never leaks across workspaces.
 */
export function EventNotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <Button asChild variant="ghost" className="rounded-full">
            <Link href="/dashboard/events">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All events
            </Link>
          </Button>
        </div>
      </header>

      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <Card className="mx-auto mt-12 max-w-md space-y-3 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <SearchX className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold">Event not found</h1>
          <p className="text-sm text-muted-foreground">
            It may have been deleted or belongs to another workspace.
          </p>
          <div className="pt-2">
            <Button asChild className="rounded-full">
              <Link href="/dashboard/events">Back to events</Link>
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
