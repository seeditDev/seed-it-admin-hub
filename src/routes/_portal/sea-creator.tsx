import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DEFAULT_SEA_RUBRIC,
  deleteAssessment,
  duplicateAssessment,
  listAssessments,
  saveAssessment,
  setAssessmentStatus,
  type AssessmentDoc,
} from "@/lib/firestore/assessments";
import { listTenants } from "@/lib/firestore/tenants";
import {
  ALLOWED_YEARS,
  DEFAULT_PROCTOR_CONFIG,
  DEFAULT_TARGETING,
  DEPARTMENTS,
  YEAR_RANGE_HINT,
  type AssessmentStatus,
  type AssessmentTargeting,
  type ProctorConfig,
  type SeaPrompt,
  type SeaRubric,
} from "@/types/seedit";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_portal/sea-creator")({
  head: () => ({
    meta: [
      { title: "SEA Creator | SEED-IT Admin" },
      { name: "description", content: "Author spoken-English audio assessments." },
      { property: "og:title", content: "SEA Creator | SEED-IT Admin" },
      { property: "og:description", content: "Author spoken-English audio assessments." },
    ],
  }),
  component: SeaCreatorPage,
});

function newPrompt(): SeaPrompt {
  return {
    id: `prompt-${Math.random().toString(36).slice(2, 9)}`,
    prompt: "",
    referenceTranscript: "",
    keywords: [],
    minSeconds: 30,
    maxSeconds: 90,
    retakesAllowed: 1,
  };
}

interface Draft {
  id: string;
  title: string;
  description: string;
  instructions: string;
  durationMinutes: number;
  passPercentage: number;
  targeting: AssessmentTargeting;
  scheduledStart: string;
  scheduledEnd: string;
  proctorConfig: ProctorConfig;
  prompts: SeaPrompt[];
  rubric: SeaRubric;
  status: AssessmentStatus;
  guestEnabled: boolean;
  assessmentCode: string;
  isNew: boolean;
}

function emptyDraft(scopedTenantId: string | null): Draft {
  return {
    id: "",
    title: "",
    description: "",
    instructions: "",
    durationMinutes: 30,
    passPercentage: 50,
    targeting: {
      ...DEFAULT_TARGETING,
      tenantIds: scopedTenantId ? [scopedTenantId] : [],
    },
    scheduledStart: "",
    scheduledEnd: "",
    proctorConfig: { ...DEFAULT_PROCTOR_CONFIG, audioRequired: true },
    prompts: [newPrompt()],
    rubric: { ...DEFAULT_SEA_RUBRIC },
    status: "draft",
    guestEnabled: false,
    assessmentCode: "",
    isNew: true,
  };
}

function toIsoOrNull(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromAssessment(a: AssessmentDoc): Draft {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    instructions: a.instructions,
    durationMinutes: a.durationMinutes,
    passPercentage: a.passPercentage,
    targeting: a.targeting,
    scheduledStart: isoToLocal(a.scheduledStart),
    scheduledEnd: isoToLocal(a.scheduledEnd),
    proctorConfig: a.proctorConfig,
    prompts: a.prompts.length ? a.prompts : [newPrompt()],
    rubric: a.rubric ?? { ...DEFAULT_SEA_RUBRIC },
    status: a.status,
    guestEnabled: a.guestEnabled ?? false,
    assessmentCode: a.assessmentCode ?? "",
    isNew: false,
  };
}

function StatusBadge({ status }: { status: AssessmentStatus }) {
  if (status === "active")
    return <Badge className="rounded-full text-[11px]">Active</Badge>;
  if (status === "archived")
    return (
      <Badge variant="outline" className="rounded-full text-[11px]">
        Archived
      </Badge>
    );
  return (
    <Badge variant="secondary" className="rounded-full text-[11px]">
      Draft
    </Badge>
  );
}

function SeaCreatorPage() {
  const qc = useQueryClient();
  const { scopedTenantId, account } = useAuth();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AssessmentDoc | null>(null);

  const assessmentsQ = useQuery({ queryKey: ["assessments"], queryFn: listAssessments });
  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const seaAssessments = useMemo(() => {
    let list = (assessmentsQ.data ?? []).filter((a) => a.type === "spoken-english");
    if (scopedTenantId) {
      list = list.filter(
        (a) => a.tenantId === scopedTenantId || a.targeting.tenantIds.includes(scopedTenantId),
      );
    }
    return list;
  }, [assessmentsQ.data, scopedTenantId]);

  const saveMutation = useMutation({
    mutationFn: (d: Draft) =>
      saveAssessment(
        {
          id: d.isNew ? undefined : d.id,
          title: d.title,
          type: "spoken-english",
          description: d.description,
          instructions: d.instructions,
          targeting: d.targeting,
          durationMinutes: d.durationMinutes,
          totalMarks: 100,
          passPercentage: d.passPercentage,
          status: d.status,
          scheduledStart: toIsoOrNull(d.scheduledStart),
          scheduledEnd: toIsoOrNull(d.scheduledEnd),
          proctorConfig: d.proctorConfig,
          prompts: d.prompts,
          rubric: d.rubric,
          guestEnabled: d.guestEnabled,
          assessmentCode: d.assessmentCode || null,
        },
        account?.uid,
      ),
    onSuccess: (savedId, d) => {
      // Register in contentUrls so this SEA assessment appears in the Courses dropdown
      import("@/lib/firestore/contentUrls").then(({ upsertContentUrl }) =>
        upsertContentUrl({
          id: savedId ?? d.id,
          title: d.title,
          type: "sea",
          cdnUrl: "",   // SEA has no CDN JSON — identified by Firestore ID only
          slug: savedId ?? d.id,
          totalMarks: 100,
          durationMinutes: d.durationMinutes,
        }),
      ).catch(console.warn);

      toast.success(d.isNew ? "SEA assessment created — map it in Courses & Assessments." : "Assessment updated.");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save assessment"),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AssessmentStatus }) =>
      setAssessmentStatus(id, status),
    onSuccess: () => {
      toast.success("Status updated");
      void qc.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: () => toast.error("Could not update status"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateAssessment(id),
    onSuccess: () => {
      toast.success("Assessment duplicated as a new draft");
      void qc.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: () => toast.error("Could not duplicate assessment"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAssessment(id),
    onSuccess: () => {
      toast.success("Assessment deleted");
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: () => toast.error("Delete failed"),
  });

  const rubricTotal =
    (draft?.rubric.fluencyWeight ?? 0) +
    (draft?.rubric.pronunciationWeight ?? 0) +
    (draft?.rubric.grammarWeight ?? 0) +
    (draft?.rubric.keywordWeight ?? 0);

  const promptErrors = draft
    ? draft.prompts.map((p) => (p.maxSeconds <= p.minSeconds ? "Max seconds must exceed min seconds" : null))
    : [];

  const canSave =
    Boolean(draft) &&
    draft!.title.trim().length > 0 &&
    draft!.prompts.length > 0 &&
    draft!.prompts.every((p) => p.prompt.trim().length > 0) &&
    promptErrors.every((e) => e === null) &&
    rubricTotal === 100;

  function updatePrompt(index: number, patch: Partial<SeaPrompt>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const prompts = prev.prompts.slice();
      prompts[index] = { ...prompts[index]!, ...patch };
      return { ...prev, prompts };
    });
  }

  function movePrompt(index: number, dir: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      const target = index + dir;
      if (target < 0 || target >= prev.prompts.length) return prev;
      const prompts = prev.prompts.slice();
      const [item] = prompts.splice(index, 1);
      prompts.splice(target, 0, item!);
      return { ...prev, prompts };
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">SEA Creator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {seaAssessments.length} spoken-English assessment{seaAssessments.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Button className="rounded-xl" onClick={() => setDraft(emptyDraft(scopedTenantId))}>
          <Plus className="size-4" />
          New spoken-English assessment
        </Button>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {assessmentsQ.isLoading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : seaAssessments.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Mic className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No spoken-English assessments yet. Create your first one to get started.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {seaAssessments.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{a.title}</p>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.prompts.length} prompt{a.prompts.length === 1 ? "" : "s"} • {a.durationMinutes} min •
                      pass {a.passPercentage}%
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 rounded-lg"
                      aria-label={`Edit ${a.title}`}
                      onClick={() => setDraft(fromAssessment(a))}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 rounded-lg"
                      aria-label={`Duplicate ${a.title}`}
                      onClick={() => duplicateMutation.mutate(a.id)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    {a.status !== "active" ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 rounded-lg text-primary"
                        aria-label={`Publish ${a.title}`}
                        onClick={() => statusMutation.mutate({ id: a.id, status: "active" })}
                      >
                        <CheckCircle2 className="size-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 rounded-lg"
                        aria-label={`Archive ${a.title}`}
                        onClick={() => statusMutation.mutate({ id: a.id, status: "archived" })}
                      >
                        <Archive className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 rounded-lg text-destructive"
                      aria-label={`Delete ${a.title}`}
                      onClick={() => setPendingDelete(a)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-3xl">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.isNew ? "New spoken-English assessment" : "Edit assessment"}</DialogTitle>
                <DialogDescription>
                  Configure prompts, targeting, proctoring and the scoring rubric.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="sea-title">Title</Label>
                    <Input
                      id="sea-title"
                      className="rounded-xl"
                      value={draft.title}
                      onChange={(e) => setDraft((p) => (p ? { ...p, title: e.target.value } : p))}
                      placeholder="Spoken English Fluency Check — Round 1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sea-desc">Description</Label>
                    <Textarea
                      id="sea-desc"
                      className="rounded-xl"
                      value={draft.description}
                      onChange={(e) => setDraft((p) => (p ? { ...p, description: e.target.value } : p))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sea-instructions">Instructions</Label>
                    <Textarea
                      id="sea-instructions"
                      className="rounded-xl"
                      value={draft.instructions}
                      onChange={(e) => setDraft((p) => (p ? { ...p, instructions: e.target.value } : p))}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="sea-duration">Duration (minutes)</Label>
                      <Input
                        id="sea-duration"
                        type="number"
                        min={1}
                        className="rounded-xl"
                        value={draft.durationMinutes}
                        onChange={(e) =>
                          setDraft((p) => (p ? { ...p, durationMinutes: Number(e.target.value) || 0 } : p))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sea-pass">Pass percentage</Label>
                      <Input
                        id="sea-pass"
                        type="number"
                        min={0}
                        max={100}
                        className="rounded-xl"
                        value={draft.passPercentage}
                        onChange={(e) =>
                          setDraft((p) => (p ? { ...p, passPercentage: Number(e.target.value) || 0 } : p))
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border p-4">
                  <p className="text-sm font-semibold">Targeting</p>
                  <div className="space-y-2">
                    <Label>Colleges</Label>
                    <div className="flex flex-wrap gap-2">
                      {tenants.map((t) => {
                        const on = draft.targeting.tenantIds.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={Boolean(scopedTenantId)}
                            onClick={() =>
                              setDraft((p) =>
                                p
                                  ? {
                                      ...p,
                                      targeting: {
                                        ...p.targeting,
                                        tenantIds: on
                                          ? p.targeting.tenantIds.filter((id) => id !== t.id)
                                          : [...p.targeting.tenantIds, t.id],
                                      },
                                    }
                                  : p,
                              )
                            }
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-70 ${
                              on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
                            }`}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                      {tenants.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No colleges leave this open to all.</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Academic years</Label>
                    <div className="flex flex-wrap gap-2">
                      {ALLOWED_YEARS.map((y) => {
                        const on = draft.targeting.years.includes(y);
                        return (
                          <button
                            key={y}
                            type="button"
                            onClick={() =>
                              setDraft((p) =>
                                p
                                  ? {
                                      ...p,
                                      targeting: {
                                        ...p.targeting,
                                        years: on
                                          ? p.targeting.years.filter((yr) => yr !== y)
                                          : [...p.targeting.years, y],
                                      },
                                    }
                                  : p,
                              )
                            }
                            className={`rounded-full border px-3 py-1 font-mono text-xs font-medium transition-colors ${
                              on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
                            }`}
                          >
                            {y}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">{YEAR_RANGE_HINT}.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Departments</Label>
                    <div className="flex flex-wrap gap-2">
                      {DEPARTMENTS.map((d) => {
                        const on = draft.targeting.departments.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() =>
                              setDraft((p) =>
                                p
                                  ? {
                                      ...p,
                                      targeting: {
                                        ...p.targeting,
                                        departments: on
                                          ? p.targeting.departments.filter((dep) => dep !== d)
                                          : [...p.targeting.departments, d],
                                      },
                                    }
                                  : p,
                              )
                            }
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                              on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
                            }`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="sea-start">Scheduled start</Label>
                      <Input
                        id="sea-start"
                        type="datetime-local"
                        className="rounded-xl"
                        value={draft.scheduledStart}
                        onChange={(e) => setDraft((p) => (p ? { ...p, scheduledStart: e.target.value } : p))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sea-end">Scheduled end</Label>
                      <Input
                        id="sea-end"
                        type="datetime-local"
                        className="rounded-xl"
                        value={draft.scheduledEnd}
                        onChange={(e) => setDraft((p) => (p ? { ...p, scheduledEnd: e.target.value } : p))}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border p-4">
                  <p className="text-sm font-semibold">Proctoring</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex items-center justify-between rounded-xl border p-3">
                      <span className="text-sm">Proctoring enabled</span>
                      <Switch
                        checked={draft.proctorConfig.enabled}
                        onCheckedChange={(v) =>
                          setDraft((p) => (p ? { ...p, proctorConfig: { ...p.proctorConfig, enabled: v } } : p))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-xl border p-3">
                      <span className="text-sm">Camera required</span>
                      <Switch
                        checked={draft.proctorConfig.cameraRequired}
                        onCheckedChange={(v) =>
                          setDraft((p) =>
                            p ? { ...p, proctorConfig: { ...p.proctorConfig, cameraRequired: v } } : p,
                          )
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-xl border p-3">
                      <span className="text-sm">Audio required</span>
                      <Switch
                        checked={draft.proctorConfig.audioRequired}
                        onCheckedChange={(v) =>
                          setDraft((p) =>
                            p ? { ...p, proctorConfig: { ...p.proctorConfig, audioRequired: v } } : p,
                          )
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-xl border p-3">
                      <span className="text-sm">Auto-submit on violation</span>
                      <Switch
                        checked={draft.proctorConfig.autoSubmitOnViolation}
                        onCheckedChange={(v) =>
                          setDraft((p) =>
                            p ? { ...p, proctorConfig: { ...p.proctorConfig, autoSubmitOnViolation: v } } : p,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sea-tabswitch">Tab-switch limit</Label>
                      <Input
                        id="sea-tabswitch"
                        type="number"
                        min={0}
                        className="rounded-xl"
                        value={draft.proctorConfig.tabSwitchLimit}
                        onChange={(e) =>
                          setDraft((p) =>
                            p
                              ? {
                                  ...p,
                                  proctorConfig: {
                                    ...p.proctorConfig,
                                    tabSwitchLimit: Number(e.target.value) || 0,
                                  },
                                }
                              : p,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sea-maxv">Max violations</Label>
                      <Input
                        id="sea-maxv"
                        type="number"
                        min={0}
                        className="rounded-xl"
                        value={draft.proctorConfig.maxViolations}
                        onChange={(e) =>
                          setDraft((p) =>
                            p
                              ? {
                                  ...p,
                                  proctorConfig: {
                                    ...p.proctorConfig,
                                    maxViolations: Number(e.target.value) || 0,
                                  },
                                }
                              : p,
                          )
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Prompts</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => setDraft((p) => (p ? { ...p, prompts: [...p.prompts, newPrompt()] } : p))}
                    >
                      <Plus className="size-3.5" />
                      Add prompt
                    </Button>
                  </div>
                  <div className="space-y-4">
                    {draft.prompts.map((prompt, index) => (
                      <div key={prompt.id} className="surface-card space-y-3 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-muted-foreground">Prompt {index + 1}</p>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="rounded-lg"
                              disabled={index === 0}
                              onClick={() => movePrompt(index, -1)}
                            >
                              Up
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="rounded-lg"
                              disabled={index === draft.prompts.length - 1}
                              onClick={() => movePrompt(index, 1)}
                            >
                              Down
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 rounded-lg text-destructive"
                              aria-label={`Remove prompt ${index + 1}`}
                              disabled={draft.prompts.length <= 1}
                              onClick={() =>
                                setDraft((p) =>
                                  p ? { ...p, prompts: p.prompts.filter((_, i) => i !== index) } : p,
                                )
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`prompt-text-${prompt.id}`}>Prompt text</Label>
                          <Textarea
                            id={`prompt-text-${prompt.id}`}
                            className="rounded-xl"
                            value={prompt.prompt}
                            onChange={(e) => updatePrompt(index, { prompt: e.target.value })}
                            placeholder="Describe your favourite hobby and why you enjoy it."
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`prompt-ref-${prompt.id}`}>Reference transcript (optional)</Label>
                          <Textarea
                            id={`prompt-ref-${prompt.id}`}
                            className="rounded-xl"
                            value={prompt.referenceTranscript ?? ""}
                            onChange={(e) => updatePrompt(index, { referenceTranscript: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`prompt-kw-${prompt.id}`}>Keywords (comma-separated)</Label>
                          <Input
                            id={`prompt-kw-${prompt.id}`}
                            className="rounded-xl"
                            placeholder="type a keyword and press Enter"
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" && e.key !== ",") return;
                              e.preventDefault();
                              const value = e.currentTarget.value.trim();
                              if (!value) return;
                              if (!prompt.keywords.includes(value)) {
                                updatePrompt(index, { keywords: [...prompt.keywords, value] });
                              }
                              e.currentTarget.value = "";
                            }}
                          />
                          <div className="flex flex-wrap gap-1.5">
                            {prompt.keywords.map((kw) => (
                              <Badge key={kw} variant="secondary" className="gap-1 rounded-full text-[11px]">
                                {kw}
                                <button
                                  type="button"
                                  aria-label={`Remove keyword ${kw}`}
                                  onClick={() =>
                                    updatePrompt(index, {
                                      keywords: prompt.keywords.filter((k) => k !== kw),
                                    })
                                  }
                                >
                                  <X className="size-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor={`prompt-min-${prompt.id}`}>Min seconds</Label>
                            <Input
                              id={`prompt-min-${prompt.id}`}
                              type="number"
                              min={0}
                              className="rounded-xl"
                              value={prompt.minSeconds}
                              onChange={(e) => updatePrompt(index, { minSeconds: Number(e.target.value) || 0 })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`prompt-max-${prompt.id}`}>Max seconds</Label>
                            <Input
                              id={`prompt-max-${prompt.id}`}
                              type="number"
                              min={0}
                              className="rounded-xl"
                              value={prompt.maxSeconds}
                              onChange={(e) => updatePrompt(index, { maxSeconds: Number(e.target.value) || 0 })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`prompt-retakes-${prompt.id}`}>Retakes allowed</Label>
                            <Input
                              id={`prompt-retakes-${prompt.id}`}
                              type="number"
                              min={0}
                              className="rounded-xl"
                              value={prompt.retakesAllowed}
                              onChange={(e) =>
                                updatePrompt(index, { retakesAllowed: Number(e.target.value) || 0 })
                              }
                            />
                          </div>
                        </div>
                        {promptErrors[index] ? (
                          <p className="text-xs text-destructive">{promptErrors[index]}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Scoring rubric</p>
                    <Badge
                      variant={rubricTotal === 100 ? "default" : "destructive"}
                      className="rounded-full text-[11px]"
                    >
                      Total {rubricTotal}%
                    </Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="rubric-fluency">Fluency weight</Label>
                      <Input
                        id="rubric-fluency"
                        type="number"
                        min={0}
                        max={100}
                        className="rounded-xl"
                        value={draft.rubric.fluencyWeight}
                        onChange={(e) =>
                          setDraft((p) =>
                            p
                              ? { ...p, rubric: { ...p.rubric, fluencyWeight: Number(e.target.value) || 0 } }
                              : p,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rubric-pron">Pronunciation weight</Label>
                      <Input
                        id="rubric-pron"
                        type="number"
                        min={0}
                        max={100}
                        className="rounded-xl"
                        value={draft.rubric.pronunciationWeight}
                        onChange={(e) =>
                          setDraft((p) =>
                            p
                              ? {
                                  ...p,
                                  rubric: { ...p.rubric, pronunciationWeight: Number(e.target.value) || 0 },
                                }
                              : p,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rubric-grammar">Grammar weight</Label>
                      <Input
                        id="rubric-grammar"
                        type="number"
                        min={0}
                        max={100}
                        className="rounded-xl"
                        value={draft.rubric.grammarWeight}
                        onChange={(e) =>
                          setDraft((p) =>
                            p
                              ? { ...p, rubric: { ...p.rubric, grammarWeight: Number(e.target.value) || 0 } }
                              : p,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rubric-keyword">Keyword weight</Label>
                      <Input
                        id="rubric-keyword"
                        type="number"
                        min={0}
                        max={100}
                        className="rounded-xl"
                        value={draft.rubric.keywordWeight}
                        onChange={(e) =>
                          setDraft((p) =>
                            p
                              ? { ...p, rubric: { ...p.rubric, keywordWeight: Number(e.target.value) || 0 } }
                              : p,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rubric-threshold">Pass threshold</Label>
                      <Input
                        id="rubric-threshold"
                        type="number"
                        min={0}
                        max={100}
                        className="rounded-xl"
                        value={draft.rubric.passThreshold}
                        onChange={(e) =>
                          setDraft((p) =>
                            p ? { ...p, rubric: { ...p.rubric, passThreshold: Number(e.target.value) || 0 } } : p,
                          )
                        }
                      />
                    </div>
                  </div>
                  {rubricTotal !== 100 ? (
                    <p className="text-xs text-destructive">Rubric weights must total exactly 100%.</p>
                  ) : null}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button
                  className="rounded-xl"
                  disabled={!canSave || saveMutation.isPending}
                  onClick={() => draft && saveMutation.mutate(draft)}
                >
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {draft.isNew ? "Create assessment" : "Save changes"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the assessment and its prompts. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
