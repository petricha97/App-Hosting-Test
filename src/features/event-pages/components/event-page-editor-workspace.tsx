"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Puck, Render, type Data } from "@measured/puck";
import {
  ArrowRight,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  LayoutTemplate,
  Link2,
  Loader2,
  Monitor,
  RefreshCcw,
  Smartphone,
  Sparkles,
  Tablet,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import {
  blankCustomData,
  createDashboardRegistrationRenderer,
  createEventPagePuckConfig,
  ensurePuckDataIds,
  starterTemplates,
  type EventPageCountdownData,
  type PageMode,
  type StarterTemplateKey,
} from "@/features/event-pages/puck";
import type { RegistrationCtaState } from "@/features/event-pages/registration-state";
import type { EventPageAsset } from "@/features/event-pages/assets";
import type { SerializedEventPage } from "@/features/event-pages/utils";
import type { SerializedForm } from "@/features/form/utils";
import type { PublicPricingProjection } from "@/features/public-registration/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Builder switcher entries (M4-T2 AC-24: default + ALL paths, inactive
// included and badged).
export interface EditorPathOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface EventPageEditorWorkspaceProps {
  eventId: string;
  eventName: string;
  pageMode: PageMode;
  redirectUrl: string;
  // The page doc for the pageKey being edited (null = not created yet).
  initialEventPage: SerializedEventPage | null;
  // The default page doc — powers the inherit-fallback banner preview and
  // the "start from a copy" action when editing a path page.
  defaultEventPage: SerializedEventPage | null;
  form: SerializedForm | null;
  paths: EditorPathOption[];
  // null = editing the default event page.
  editingPathId: string | null;
  // Live editor data for the data-bound blocks (M4-T1).
  pricingTickets: PublicPricingProjection | null;
  countdown: EventPageCountdownData;
  registrationState: RegistrationCtaState;
}

interface WorkspaceState {
  title: string;
  mode: PageMode;
  redirectUrl: string;
  selectedTemplate: StarterTemplateKey;
  prompt: string;
  draftData: Data;
  publishedData: Data | null;
  publishedAtLabel: string | null;
  // M4-T2 inherit-fallback: false while a path page has no doc AND the
  // organizer has not chosen "copy default" / "start blank" yet. Persisted
  // in the per-page cache so a reload keeps the choice.
  pathStarted: boolean;
}

type PreviewDevice = "mobile" | "tablet" | "desktop";

const PREVIEW_DEVICES: Array<{
  key: PreviewDevice;
  label: string;
  icon: typeof Smartphone;
  className: string;
}> = [
  { key: "mobile", label: "Mobile preview", icon: Smartphone, className: "max-w-[360px] mx-auto" },
  { key: "tablet", label: "Tablet preview", icon: Tablet, className: "max-w-[768px] mx-auto" },
  { key: "desktop", label: "Desktop preview", icon: Monitor, className: "" },
];

const NEW_BLOCK_NAMES = new Set(["TicketPricingTable", "CountdownTimer"]);

function buildCacheKey(eventId: string, editingPathId: string | null) {
  return `event-page-editor-cache:${eventId}:${editingPathId ?? "default"}`;
}

function createInitialWorkspaceState(
  eventName: string,
  pageMode: PageMode,
  redirectUrl: string,
  initialEventPage: SerializedEventPage | null,
  editingPath: EditorPathOption | null,
): WorkspaceState {
  const draftContent =
    initialEventPage?.draftContent ?? ensurePuckDataIds(blankCustomData);
  const publishedData = initialEventPage?.publishedContent
    ? ensurePuckDataIds(initialEventPage.publishedContent)
    : null;

  return {
    title:
      initialEventPage?.title ??
      (editingPath ? `${eventName} — ${editingPath.name}` : `${eventName} page`),
    mode: pageMode,
    redirectUrl,
    selectedTemplate: "summit",
    prompt: "",
    draftData: ensurePuckDataIds(draftContent),
    publishedData,
    publishedAtLabel:
      initialEventPage?.status === "published" ? "Saved in Firebase" : null,
    // Default page never needs the banner; a path page needs a start choice
    // only while its doc does not exist yet.
    pathStarted: editingPath === null || initialEventPage !== null,
  };
}

function DefaultModePreview() {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
      <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,162,117,0.22),_transparent_45%),linear-gradient(180deg,#fff8f2_0%,#fffdfb_100%)] px-6 py-8 sm:px-8">
        <Badge className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-900 shadow-none">
          Default page preview
        </Badge>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">
          This event will use the generic public page
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
          Switch the event to custom mode if you want the published public page
          to render the page builder output below.
        </p>
      </div>
    </div>
  );
}

export function EventPageEditorWorkspace({
  eventId,
  eventName,
  pageMode,
  redirectUrl,
  initialEventPage,
  defaultEventPage,
  form,
  paths,
  editingPathId,
  pricingTickets,
  countdown,
  registrationState,
}: EventPageEditorWorkspaceProps) {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [assets, setAssets] = useState<EventPageAsset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  // In-session unsaved edits — guards the "Editing page" switcher (M4-T2).
  const [isDirty, setIsDirty] = useState(false);
  // Page switch awaiting discard confirmation (null = no dialog). Wrapped in
  // an object because nextPathId: null (the default page) is a valid target.
  const [pendingPageSwitch, setPendingPageSwitch] = useState<{
    nextPathId: string | null;
  } | null>(null);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const editingPath = useMemo(
    () => paths.find((path) => path.id === editingPathId) ?? null,
    [editingPathId, paths],
  );
  const [state, setState] = useState<WorkspaceState>(() =>
    createInitialWorkspaceState(
      eventName,
      pageMode,
      redirectUrl,
      initialEventPage,
      editingPath,
    ),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cacheKey = useMemo(
    () => buildCacheKey(eventId, editingPathId),
    [eventId, editingPathId],
  );
  const pageKey = editingPathId ?? "default";

  useEffect(() => {
    const nextInitialState = createInitialWorkspaceState(
      eventName,
      pageMode,
      redirectUrl,
      initialEventPage,
      editingPath,
    );
    const saved = window.localStorage.getItem(cacheKey);

    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<WorkspaceState>;
        setState({
          ...nextInitialState,
          ...parsed,
          draftData: ensurePuckDataIds(
            (parsed.draftData as Data | undefined) ?? nextInitialState.draftData,
          ),
          publishedData:
            parsed.publishedData || nextInitialState.publishedData
              ? ensurePuckDataIds(
                  (parsed.publishedData as Data | null | undefined) ??
                    nextInitialState.publishedData ??
                    nextInitialState.draftData,
                )
              : null,
          pathStarted:
            nextInitialState.pathStarted || parsed.pathStarted === true,
        });
      } catch {
        setState(nextInitialState);
      }
    } else {
      setState(nextInitialState);
    }

    setIsDirty(false);
    setIsReady(true);
  }, [cacheKey, editingPath, eventName, initialEventPage, pageMode, redirectUrl]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    let isActive = true;

    async function loadAssets() {
      setIsLoadingAssets(true);

      try {
        const response = await fetch(`/api/dashboard/events/${eventId}/page/assets`);
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "Unable to load page assets.",
          );
        }

        if (isActive) {
          setAssets(Array.isArray(payload?.assets) ? payload.assets : []);
        }
      } catch (error) {
        console.error(error);
        if (isActive) {
          toast.error("Unable to load page assets", {
            description:
              error instanceof Error
                ? error.message
                : "Please try again in a moment.",
          });
        }
      } finally {
        if (isActive) {
          setIsLoadingAssets(false);
        }
      }
    }

    void loadAssets();

    return () => {
      isActive = false;
    };
  }, [eventId, isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    window.localStorage.setItem(cacheKey, JSON.stringify(state));
  }, [cacheKey, isReady, state]);

  const puckConfig = useMemo(
    () =>
      createEventPagePuckConfig({
        assets,
        registrationRender: createDashboardRegistrationRenderer({
          eventId,
          eventName,
          form,
        }),
        // Live editor data (M4-T1): the canvas shows what visitors will see —
        // no sample data; empty projections render the block's empty state
        // plus an editor-only hint.
        pricingTickets,
        countdown,
        registrationCta:
          registrationState === "no_paths"
            ? null
            : {
                state: registrationState,
                // N3: on a path page the public CTA carries ?path=, so the
                // editor preview mirrors the real destination.
                registerHref: `/events/${eventId}/register${
                  editingPathId
                    ? `?path=${encodeURIComponent(editingPathId)}`
                    : ""
                }`,
                variant: "editor",
                pathsHref: `/dashboard/events/${eventId}/registration-paths`,
              },
        editorHints: true,
      }),
    [
      assets,
      countdown,
      editingPathId,
      eventId,
      eventName,
      form,
      pricingTickets,
      registrationState,
    ],
  );

  function updateState(patch: Partial<WorkspaceState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  // M4-T2: a path page that has no document yet needs an explicit start
  // choice before the editor acts on it.
  const needsStartChoice = editingPath !== null && !state.pathStarted;

  const defaultPagePreviewData = useMemo(
    () =>
      ensurePuckDataIds(
        (defaultEventPage?.publishedContent ??
          defaultEventPage?.draftContent ??
          blankCustomData) as Data,
      ),
    [defaultEventPage],
  );

  function navigateToEditorPage(nextPathId: string | null) {
    router.push(
      `/dashboard/events/${eventId}/page-builder${
        nextPathId ? `?path=${encodeURIComponent(nextPathId)}` : ""
      }`,
    );
  }

  // S3: never block Radix Select's onValueChange with a synchronous native
  // confirm — with unsaved edits we stash the requested page and let the
  // AlertDialog below decide. The Select stays controlled by editingPathId,
  // so cancelling simply leaves the current value in place.
  function handleEditingPageChange(nextValue: string) {
    const nextPathId = nextValue === "default" ? null : nextValue;
    if (nextPathId === editingPathId) return;
    if (isDirty) {
      setPendingPageSwitch({ nextPathId });
      return;
    }
    navigateToEditorPage(nextPathId);
  }

  function startPathPage(source: "copy" | "blank") {
    updateState({
      pathStarted: true,
      draftData:
        source === "copy"
          ? ensurePuckDataIds(defaultPagePreviewData)
          : ensurePuckDataIds(blankCustomData),
    });
    setIsDirty(true);
    toast.success(
      source === "copy"
        ? "Started from a copy of the default page"
        : "Started a blank page",
      {
        description: "Save the draft to create this path's page document.",
      },
    );
  }

  function applyStarterTemplate(key: StarterTemplateKey) {
    updateState({
      selectedTemplate: key,
      draftData: ensurePuckDataIds(starterTemplates[key].data),
      mode: "custom",
      pathStarted: true,
    });
    setIsDirty(true);

    toast.success("Starter template applied", {
      description: `${starterTemplates[key].label} is now loaded in the event page draft.`,
    });
  }

  function generateFromPrompt() {
    const prompt = state.prompt.trim();

    if (!prompt) {
      toast.error("Add a prompt first", {
        description: "Describe the kind of event page you want to generate.",
      });
      return;
    }

    const nextTemplate = /wellness|retreat|fitness|calm|yoga/i.test(prompt)
      ? "wellness"
      : /creator|launch|product|showcase/i.test(prompt)
        ? "creator"
        : "summit";

    const starter = starterTemplates[nextTemplate];
    const generatedData = {
      ...starter.data,
      content: starter.data.content?.map((item, index) => {
        if (index !== 0 || item.type !== "Hero") {
          return item;
        }

        const heroItem = item as Record<string, unknown> & {
          props?: Record<string, unknown>;
        };

        return {
          ...heroItem,
          props: {
            ...(heroItem.props ?? {}),
            heading: `${eventName}: ${prompt}`,
            body:
              "Prototype AI mode: this locally generated draft chooses a starting template and rewrites the hero so the organizer can edit from there.",
          },
        };
      }),
    };

    updateState({
      mode: "custom",
      selectedTemplate: nextTemplate,
      draftData: ensurePuckDataIds(generatedData),
      pathStarted: true,
    });
    setIsDirty(true);

    toast.success("Draft generated", {
      description:
        "This still uses local heuristics for now, but the flow mirrors a future AI-assisted page start.",
    });
  }

  async function saveDraft() {
    setIsSavingDraft(true);

    try {
      const response = await fetch(`/api/dashboard/events/${eventId}/page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: state.title,
          draftContent: ensurePuckDataIds(state.draftData),
          pageKey,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Unable to save the page draft.",
        );
      }

      setIsDirty(false);
      toast.success("Draft saved to Firebase", {
        description:
          "The custom page draft is now stored remotely, with local cache kept for faster editing.",
      });
    } catch (error) {
      console.error(error);
      toast.error("Unable to save draft", {
        description:
          error instanceof Error
            ? error.message
            : "Please try again in a moment.",
      });
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function publishPage() {
    setIsPublishing(true);

    try {
      const response = await fetch(
        `/api/dashboard/events/${eventId}/page/publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: state.title,
            draftContent: ensurePuckDataIds(state.draftData),
            pageKey,
          }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Unable to publish the event page.",
        );
      }

      updateState({
        publishedData: ensurePuckDataIds(state.draftData),
        publishedAtLabel: "Published to Firebase",
      });
      setIsDirty(false);

      toast.success("Page published", {
        description: editingPath
          ? `Visitors arriving via ?path= for ${editingPath.name} will see this page.`
          : "Public visitors will see this custom page when the event page mode is set to custom.",
      });
    } catch (error) {
      console.error(error);
      toast.error("Unable to publish page", {
        description:
          error instanceof Error
            ? error.message
            : "Please try again in a moment.",
      });
    } finally {
      setIsPublishing(false);
    }
  }

  function clearLocalCache() {
    window.localStorage.removeItem(cacheKey);
    setState(
      createInitialWorkspaceState(
        eventName,
        pageMode,
        redirectUrl,
        initialEventPage,
        editingPath,
      ),
    );
    setIsDirty(false);
    toast.success("Local cache cleared", {
      description: "The editor reset to the last Firebase-backed version.",
    });
  }

  async function copyAssetUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Asset URL copied", {
        description: "Paste it into a Hero or Story image URL field in the editor.",
      });
    } catch (error) {
      console.error(error);
      toast.error("Unable to copy URL", {
        description: "Copy the URL manually from the asset card instead.",
      });
    }
  }

  async function handleAssetUpload(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const nextFile = event.target.files?.[0];

    if (!nextFile) {
      return;
    }

    setIsUploadingAsset(true);

    try {
      const formData = new FormData();
      formData.append("file", nextFile);

      const response = await fetch(`/api/dashboard/events/${eventId}/page/assets`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Unable to upload the page asset.",
        );
      }

      const uploadedAsset = payload?.asset as EventPageAsset | undefined;

      if (uploadedAsset) {
        setAssets((current) => [uploadedAsset, ...current]);
        await copyAssetUrl(uploadedAsset.url);
      }

      toast.success("Image uploaded", {
        description:
          "The asset is now in Firebase Storage and its URL was copied for quick reuse.",
      });
    } catch (error) {
      console.error(error);
      toast.error("Unable to upload image", {
        description:
          error instanceof Error
            ? error.message
            : "Please try again in a moment.",
      });
    } finally {
      setIsUploadingAsset(false);
      event.target.value = "";
    }
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Event page"
        title={`Shape the custom public page for ${eventName}.`}
        description="This editor keeps a local browser cache for speed, but the source of truth now lives in Firebase. Publish when the event should use the custom page."
        actions={
          <>
            <Badge className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-900 shadow-none">
              Firebase-backed draft
            </Badge>
            <Button asChild variant="outline">
              <Link href={`/dashboard/events/${eventId}`}>Back to event</Link>
            </Button>
            <Button type="button" variant="outline" onClick={clearLocalCache}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Reset local cache
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl text-slate-950">
                Event page mode
              </CardTitle>
              <CardDescription>
                The builder is ready either way, but the public route only uses
                it when the event mode is set to custom.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 pt-0">
              {([
                ["default", "Use the app's generic public event layout", LayoutTemplate],
                ["custom", "Render the Firebase-backed custom page", ImageIcon],
                ["redirect", "Send visitors to your own external page", Link2],
              ] as const).map(([mode, description, Icon]) => (
                <div
                  key={mode}
                  className={cn(
                    "rounded-[1.5rem] border p-4",
                    state.mode === mode
                      ? "border-orange-300 bg-orange-50/70"
                      : "border-slate-200 bg-slate-50/80",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-orange-900 shadow-sm">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold capitalize text-slate-950">
                        {mode}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {state.mode === "redirect" ? (
                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 text-sm leading-7 text-slate-600">
                  <p className="font-semibold text-slate-950">Redirect target</p>
                  <div className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <ExternalLink className="h-4 w-4 text-orange-900" />
                    <span className="break-all">{state.redirectUrl || "Not set"}</span>
                  </div>
                  <p className="mt-3 text-xs leading-6 text-slate-500">
                    Update this from the event edit screen.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl text-slate-950">
                Starter templates
              </CardTitle>
              <CardDescription>
                Load a structured starting point before you fine-tune the page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 pt-0">
              {(Object.entries(starterTemplates) as [
                StarterTemplateKey,
                (typeof starterTemplates)[StarterTemplateKey],
              ][]).map(([key, template]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyStarterTemplate(key)}
                  className={cn(
                    "w-full rounded-[1.5rem] border p-4 text-left transition",
                    state.selectedTemplate === key
                      ? "border-orange-300 bg-orange-50/70"
                      : "border-slate-200 bg-slate-50/80 hover:border-slate-300",
                  )}
                >
                  <p className="text-sm font-semibold text-slate-950">
                    {template.label}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {template.description}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-2xl text-slate-950">
                    Prompt-to-page stub
                  </CardTitle>
                  <CardDescription>
                    Prototype the future AI flow without wiring a model call yet.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0">
              <Textarea
                rows={5}
                className="rounded-[1.5rem] border-slate-200 bg-slate-50"
                placeholder="Create a calm wellness event page with a welcoming hero, practical schedule, and registration section."
                value={state.prompt}
                onChange={(event) => updateState({ prompt: event.target.value })}
              />
              <Button type="button" onClick={generateFromPrompt}>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate local draft
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl text-slate-950">
                Image assets
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0 text-sm leading-7 text-slate-600">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAssetUpload}
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAsset}
                >
                  {isUploadingAsset ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload image
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void (async () => {
                    setIsLoadingAssets(true);
                    try {
                      const response = await fetch(`/api/dashboard/events/${eventId}/page/assets`);
                      const payload = await response.json().catch(() => null);
                      if (!response.ok) {
                        throw new Error(
                          typeof payload?.error === "string"
                            ? payload.error
                            : "Unable to refresh page assets.",
                        );
                      }
                      setAssets(Array.isArray(payload?.assets) ? payload.assets : []);
                    } catch (error) {
                      console.error(error);
                      toast.error("Unable to refresh assets", {
                        description:
                          error instanceof Error
                            ? error.message
                            : "Please try again in a moment.",
                      });
                    } finally {
                      setIsLoadingAssets(false);
                    }
                  })()}
                  disabled={isLoadingAssets}
                >
                  {isLoadingAssets ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Refresh assets
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs leading-6 text-slate-500">
                Uploads go to Firebase Storage. The image URL is copied so you can
                paste it into `imageUrl` fields inside the page builder.
              </p>
              <div className="space-y-3">
                {assets.length === 0 ? (
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-500">
                    No images uploaded for this event page yet.
                  </div>
                ) : (
                  assets.map((asset) => (
                    <div
                      key={asset.path}
                      className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
                    >
                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.url}
                          alt={asset.name}
                          className="aspect-[4/3] w-full object-cover"
                        />
                      </div>
                      <p className="mt-3 truncate text-sm font-semibold text-slate-950">
                        {asset.name}
                      </p>
                      <p className="mt-1 text-xs leading-6 text-slate-500">
                        {(asset.size / 1024).toFixed(1)} KB
                        {asset.updatedAt ? ` · ${new Date(asset.updatedAt).toLocaleString()}` : ""}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void copyAssetUrl(asset.url)}
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Copy URL
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <a href={asset.url} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open
                          </a>
                        </Button>
                      </div>
                      <p className="mt-3 break-all text-[11px] leading-5 text-slate-400">
                        {asset.url}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl text-slate-950">
                Firebase backing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 pt-0 text-sm leading-7 text-slate-600">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Cloud draft store
                </p>
                <p className="mt-2">Firestore `EventPage` document</p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Asset prefix
                </p>
                <p className="mt-2 break-all">
                  {initialEventPage?.storagePrefix ??
                    `organizations/.../events/${eventId}/event-pages`}
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Local optimization
                </p>
                <p className="mt-2">Browser cache key: {cacheKey}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {state.mode === "default" ? <DefaultModePreview /> : null}

          {state.mode === "redirect" ? (
            <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
              <CardHeader className="px-6 pt-6">
                <CardTitle className="text-2xl text-slate-950">
                  Redirect mode
                </CardTitle>
                <CardDescription>
                  Public visitors will be sent to the redirect URL instead of this
                  builder output while the event stays in redirect mode.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-2xl text-slate-950">
                    Custom page editor
                  </CardTitle>
                  <CardDescription>
                    Puck builder with Firebase-backed draft/publish actions.
                    Each page saves and publishes independently.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="editing-page-select">Editing page</Label>
                    <Select
                      value={editingPathId ?? "default"}
                      onValueChange={handleEditingPageChange}
                    >
                      <SelectTrigger
                        id="editing-page-select"
                        className="min-w-52 bg-white"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">
                          Default event page
                        </SelectItem>
                        {paths.map((path) => (
                          <SelectItem key={path.id} value={path.id}>
                            <span className="flex items-center gap-2">
                              {path.name}
                              {path.isActive ? null : (
                                <Badge
                                  variant="secondary"
                                  className="rounded-full text-[10px] uppercase"
                                >
                                  Inactive
                                </Badge>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveDraft}
                    disabled={isSavingDraft || needsStartChoice}
                  >
                    {isSavingDraft ? "Saving draft..." : "Save draft"}
                  </Button>
                  <Button
                    type="button"
                    onClick={publishPage}
                    disabled={isPublishing || needsStartChoice}
                  >
                    {isPublishing ? "Publishing..." : "Publish page"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0 pt-0">
              {needsStartChoice ? (
                <div className="space-y-4 px-6 pb-6">
                  <div className="rounded-2xl border border-border bg-muted/50 p-4">
                    <p className="text-sm font-medium text-foreground">
                      This path currently inherits the default event page.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Choose how to start customizing it — until then, visitors
                      on this path see the default page below.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button type="button" onClick={() => startPathPage("copy")}>
                        Start from a copy of the default page
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => startPathPage("blank")}
                      >
                        Start blank
                      </Button>
                    </div>
                  </div>
                  <div
                    aria-hidden="true"
                    className="pointer-events-none space-y-6 opacity-60"
                  >
                    <Render config={puckConfig} data={defaultPagePreviewData} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-6 pb-4">
                    <label className="space-y-2 text-sm font-medium text-slate-700">
                      <span>Page title</span>
                      <Input
                        className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                        value={state.title}
                        onChange={(event) => {
                          updateState({ title: event.target.value });
                          setIsDirty(true);
                        }}
                      />
                    </label>
                  </div>
                  <Puck
                    config={puckConfig}
                    data={state.draftData}
                    headerTitle={
                      editingPath
                        ? `${eventName} — ${editingPath.name}`
                        : `${eventName} page`
                    }
                    renderHeaderActions={() => <div />}
                    viewports={[
                      { width: 360, label: "Mobile" },
                      { width: 768, label: "Tablet" },
                      { width: 1280, label: "Desktop" },
                    ]}
                    overrides={{
                      componentItem: ({ children, name }) => (
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">{children}</div>
                          {NEW_BLOCK_NAMES.has(name) ? (
                            <Badge className="rounded-full bg-violet-100 text-violet-900">
                              New
                            </Badge>
                          ) : null}
                        </div>
                      ),
                    }}
                    onChange={(data) => {
                      const next = ensurePuckDataIds(data);
                      if (JSON.stringify(next) !== JSON.stringify(state.draftData)) {
                        setIsDirty(true);
                      }
                      updateState({ draftData: next });
                    }}
                  />
                </>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-2xl text-slate-950">
                    Public render preview
                  </CardTitle>
                  <CardDescription>
                    This shows the current draft using the same approved block set
                    the public page will use once published.
                  </CardDescription>
                </div>
                <div
                  role="group"
                  aria-label="Preview device width"
                  className="flex gap-1"
                >
                  {PREVIEW_DEVICES.map(({ key, label, icon: Icon }) => (
                    <Button
                      key={key}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={previewDevice === key}
                      className={cn(
                        previewDevice === key &&
                          "border-orange-300 bg-orange-50 text-orange-900",
                      )}
                      onClick={() => setPreviewDevice(key)}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                      <span className="sr-only">{label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 px-6 pb-6 pt-0">
              <div
                className={cn(
                  "space-y-6",
                  PREVIEW_DEVICES.find((device) => device.key === previewDevice)
                    ?.className,
                )}
              >
                <Render config={puckConfig} data={state.draftData} />
              </div>
              {state.publishedData ? (
                <div className="space-y-4 rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        Published snapshot
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {state.publishedAtLabel ?? "Published copy available"}
                      </p>
                    </div>
                    <Badge className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-900 shadow-none">
                      Published
                    </Badge>
                  </div>
                  <div className="space-y-6">
                    <Render config={puckConfig} data={state.publishedData} />
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/dashboard/forms/templates">Explore form templates next</Link>
        </Button>
        <Button asChild>
          <Link href={`/dashboard/events/${eventId}`}>
            Back to event
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* S3: discard-confirm for the page switcher, deferred out of the
          Select's onValueChange so Radix focus/open state stays consistent. */}
      <AlertDialog
        open={pendingPageSwitch !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPageSwitch(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This page has unsaved edits. Switching to another page discards
              them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingPageSwitch) {
                  // QA-M4-D1: actually discard — every edit is persisted to
                  // the per-page localStorage cache as it happens, so a
                  // confirmed discard must clear this page's entry or the
                  // "discarded" edits silently reload on the next visit.
                  window.localStorage.removeItem(cacheKey);
                  navigateToEditorPage(pendingPageSwitch.nextPathId);
                }
                setPendingPageSwitch(null);
              }}
            >
              Discard and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
