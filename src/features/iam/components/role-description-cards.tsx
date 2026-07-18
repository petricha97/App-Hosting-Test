// Role-description cards (design §6) — Owner and Admin share one card with a
// footnote (D5: Admin is permission-identical to Owner; the footnote is the
// entire surfacing of that nuance, once, in the one place it's true).
import { Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RoleDescriptionCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card className="rounded-2xl border border-border bg-card">
        <CardHeader>
          <CardTitle>Owner &amp; Admin</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Full control, including members and workspace settings.
          <div className="mt-3 flex items-start gap-1.5 border-t border-border pt-2 text-xs text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Only an Owner can manage other Owners and Admins, or invite someone
            as Admin.
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border bg-card">
        <CardHeader>
          <CardTitle>Editor</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Build events, forms, and emails. Can&apos;t manage members.
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border bg-card">
        <CardHeader>
          <CardTitle>Viewer</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Read-only: reports, attendees, and responses.
        </CardContent>
      </Card>
    </div>
  );
}
