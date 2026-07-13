// Shared CSV export download sequence for the responses browsers (M3-T4
// AC-6, review S6): fetch the export route, then trigger a browser download
// via a temporary object-URL anchor. Client-side only (touches document);
// imported exclusively from "use client" components. Failures surface the
// one shared toast — callers only manage their own busy state.

import { toast } from "sonner";

export async function downloadCsvExport(
  url: string,
  filename: string,
): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      toast.error("Export failed — try again.");
      return false;
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch {
    toast.error("Export failed — try again.");
    return false;
  }
}
