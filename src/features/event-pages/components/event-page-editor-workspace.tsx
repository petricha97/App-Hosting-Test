"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Puck, Render, type Data } from "@measured/puck";
import {
  ArrowRight,
  Copy,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Link2,
  Loader2,
  RefreshCcw,
  Sparkles,
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
  type PageMode,
  type StarterTemplateKey,
} from "@/features/event-pages/puck";
import type { EventPageAsset } from "@/features/event-pages/assets";
import type { SerializedEventPage } from "@/features/event-pages/utils";
import type { SerializedForm } from "@/features/form/utils";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface EventPageEditorWorkspaceProps {
  eventId: string;
  eventName: string;
  pageMode: PageMode;
  redirectUrl: string;
  initialEventPage: SerializedEventPage | null;
  form: SerializedForm | null;
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
}

function buildCacheKey(eventId: string) {
  return `event-page-editor-cache:${eventId}`;
}

function createInitialWorkspaceState(
  eventName: string,
  pageMode: PageMode,
  redirectUrl: string,
  initialEventPage: SerializedEventPage | null,
): WorkspaceState {
  const draftContent =
    initialEventPage?.draftContent ?? ensurePuckDataIds(blankCustomData);
  const publishedData = initialEventPage?.publishedContent
    ? ensurePuckDataIds(initialEventPage.publishedContent)
    : null;

  return {
    title: initialEventPage?.title ?? `${eventName} page`,
    mode: pageMode,
    redirectUrl,
    selectedTemplate: "summit",
    prompt: "",
    draftData: ensurePuckDataIds(draftContent),
    publishedData,
    publishedAtLabel:
      initialEventPage?.status === "published" ? "Saved in Firebase" : null,
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
  form,
}: EventPageEditorWorkspaceProps) {
  const [isReady, setIsReady] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [assets, setAssets] = useState<EventPageAsset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [state, setState] = useState<WorkspaceState>(() =>
    createInitialWorkspaceState(eventName, pageMode, redirectUrl, initialEventPage),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cacheKey = useMemo(() => buildCacheKey(eventId), [eventId]);

  useEffect(() => {
    const nextInitialState = createInitialWorkspaceState(
      eventName,
      pageMode,
      redirectUrl,
      initialEventPage,
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
        });
      } catch {
        setState(nextInitialState);
      }
    } else {
      setState(nextInitialState);
    }

    setIsReady(true);
  }, [cacheKey, eventName, initialEventPage, pageMode, redirectUrl]);

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
      }),
    [assets, eventId, eventName, form],
  );

  function updateState(patch: Partial<WorkspaceState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function applyStarterTemplate(key: StarterTemplateKey) {
    updateState({
      selectedTemplate: key,
      draftData: ensurePuckDataIds(starterTemplates[key].data),
      mode: "custom",
    });

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
    });

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

      toast.success("Page published", {
        description:
          "Public visitors will see this custom page when the event page mode is set to custom.",
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
      createInitialWorkspaceState(eventName, pageMode, redirectUrl, initialEventPage),
    );
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
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveDraft}
                    disabled={isSavingDraft}
                  >
                    {isSavingDraft ? "Saving draft..." : "Save draft"}
                  </Button>
                  <Button
                    type="button"
                    onClick={publishPage}
                    disabled={isPublishing}
                  >
                    {isPublishing ? "Publishing..." : "Publish page"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0 pt-0">
              <div className="px-6 pb-4">
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  <span>Page title</span>
                  <Input
                    className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                    value={state.title}
                    onChange={(event) => updateState({ title: event.target.value })}
                  />
                </label>
              </div>
              <Puck
                config={puckConfig}
                data={state.draftData}
                headerTitle={`${eventName} page`}
                renderHeaderActions={() => <div />}
                onChange={(data) =>
                  updateState({ draftData: ensurePuckDataIds(data) })
                }
              />
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl text-slate-950">
                Public render preview
              </CardTitle>
              <CardDescription>
                This shows the current draft using the same approved block set the
                public page will use once published.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 px-6 pb-6 pt-0">
              <div className="space-y-6">
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
    </div>
  );
}
