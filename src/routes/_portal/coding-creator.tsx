import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listTenants } from "@/lib/firestore/tenants";
import {
  DEFAULT_CODING_PROBLEM,
  deleteAssessment,
  duplicateAssessment,
  getAssessment,
  listAssessments,
  saveAssessment,
  setAssessmentStatus,
  type AssessmentDoc,
} from "@/lib/firestore/assessments";
import {
  CODING_LANGUAGES,
  DEFAULT_PROCTOR_CONFIG,
  DEFAULT_TARGETING,
  LANGUAGE_LABELS,
  type AssessmentTargeting,
  type CodingLanguage,
  type CodingProblem,
  type ProctorConfig,
  type TestCase,
} from "@/types/seedit";
import { useAuth } from "@/lib/auth-context";
import {
  AssessmentListCard,
  ProctoringBar,
  ScheduleFields,
  TargetingPicker,
} from "@/components/assessment-authoring";

export const Route = createFileRoute("/_portal/coding-creator")({
  head: () => ({
    meta: [
      { title: "Coding Creator | SEED-IT Admin" },
      { name: "description", content: "Author coding problems with test cases and judge limits." },
      { property: "og:title", content: "Coding Creator | SEED-IT Admin" },
      { property: "og:description", content: "Author coding problems with test cases and judge limits." },
    ],
  }),
  component: CodingCreatorPage,
});

function newTestCase(hidden: boolean): TestCase {
  return {
    id: `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    input: "",
    expectedOutput: "",
    hidden,
    points: 10,
  };
}

interface CodingDraft {
  id?: string;
  title: string;
  description: string;
  instructions: string;
  durationMinutes: number;
  passPercentage: number;
  totalMarksOverride: number | null;
  targeting: AssessmentTargeting;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  proctorConfig: ProctorConfig;
  problem: CodingProblem;
}

function emptyDraft(): CodingDraft {
  return {
    title: "",
    description: "",
    instructions: "",
    durationMinutes: 60,
    passPercentage: 40,
    totalMarksOverride: null,
    targeting: { ...DEFAULT_TARGETING },
    scheduledStart: null,
    scheduledEnd: null,
    proctorConfig: { ...DEFAULT_PROCTOR_CONFIG },
    problem: { ...DEFAULT_CODING_PROBLEM, testCases: [newTestCase(false), newTestCase(true)] },
  };
}

function draftFromDoc(doc: AssessmentDoc): CodingDraft {
  const problem = doc.problem ?? DEFAULT_CODING_PROBLEM;
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    instructions: doc.instructions,
    durationMinutes: doc.durationMinutes,
    passPercentage: doc.passPercentage,
    totalMarksOverride: doc.totalMarks,
    targeting: doc.targeting,
    scheduledStart: doc.scheduledStart ?? null,
    scheduledEnd: doc.scheduledEnd ?? null,
    proctorConfig: doc.proctorConfig,
    problem,
  };
}

function CodingCreatorPage() {
  const qc = useQueryClient();
  const { account, scopedTenantId } = useAuth();
  const [draft, setDraft] = useState<CodingDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AssessmentDoc | null>(null);

  const assessmentsQ = useQuery({ queryKey: ["assessments"], queryFn: listAssessments });
  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const codingAssessments = useMemo(
    () => (assessmentsQ.data ?? []).filter((a) => a.type === "coding"),
    [assessmentsQ.data],
  );

  const computedMarks = useMemo(
    () => (draft ? draft.problem.testCases.reduce((sum, tc) => sum + (Number(tc.points) || 0), 0) : 0),
    [draft],
  );

  const hasVisible = draft?.problem.testCases.some((tc) => !tc.hidden) ?? false;
  const hasHidden = draft?.problem.testCases.some((tc) => tc.hidden) ?? false;

  const validationErrors = useMemo(() => {
    if (!draft) return [] as string[];
    const errs: string[] = [];
    if (!draft.title.trim()) errs.push("Title is required");
    if (draft.durationMinutes <= 0) errs.push("Duration must be greater than 0");
    if (!draft.problem.statement.trim()) errs.push("Problem statement is required");
    if (draft.problem.languages.length === 0) errs.push("Select at least one language");
    if (draft.problem.timeLimitSeconds <= 0) errs.push("Time limit must be greater than 0");
    if (draft.problem.memoryLimitMb <= 0) errs.push("Memory limit must be greater than 0");
    draft.problem.testCases.forEach((tc, i) => {
      if (!tc.input.trim() && !tc.expectedOutput.trim())
        errs.push(`Test case ${i + 1}: input or expected output is required`);
    });
    return errs;
  }, [draft]);

  const publishWarning = draft && (!hasVisible || !hasHidden)
    ? "At least one visible and one hidden test case are required before publishing (draft saves are allowed)."
    : null;

  const saveMutation = useMutation({
    mutationFn: (vars: { d: CodingDraft; status?: AssessmentDoc["status"] }) => {
      const { d, status } = vars;
      if (status === "active" && (!hasVisible || !hasHidden)) {
        throw new Error("Add at least one visible and one hidden test case before publishing.");
      }
      return saveAssessment(
        {
          id: d.id,
          title: d.title,
          type: "coding",
          description: d.description,
          instructions: d.instructions,
          durationMinutes: d.durationMinutes,
          passPercentage: d.passPercentage,
          negativeMarking: 0,
          totalMarks: d.totalMarksOverride ?? computedMarks,
          targeting: d.targeting,
          scheduledStart: d.scheduledStart,
          scheduledEnd: d.scheduledEnd,
          proctorConfig: d.proctorConfig,
          problem: d.problem,
          status: status ?? (d.id ? undefined : "draft"),
        },
        account?.uid,
      );
    },
    onSuccess: () => {
      toast.success("Coding assessment saved");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save assessment"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateAssessment(id),
    onSuccess: () => {
      toast.success("Assessment duplicated");
      void qc.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: () => toast.error("Could not duplicate assessment"),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: AssessmentDoc["status"] }) =>
      setAssessmentStatus(vars.id, vars.status),
    onSuccess: () => {
      toast.success("Status updated");
      void qc.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: () => toast.error("Could not update status"),
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

  async function openEdit(a: AssessmentDoc) {
    const full = await getAssessment(a.id);
    setDraft(draftFromDoc(full ?? a));
  }

  function updateProblem(patch: Partial<CodingProblem>) {
    setDraft((prev) => (prev ? { ...prev, problem: { ...prev.problem, ...patch } } : prev));
  }

  function toggleLanguage(lang: CodingLanguage) {
    setDraft((prev) => {
      if (!prev) return prev;
      const languages = prev.problem.languages.includes(lang)
        ? prev.problem.languages.filter((l) => l !== lang)
        : [...prev.problem.languages, lang];
      return { ...prev, problem: { ...prev.problem, languages } };
    });
  }

  function addTestCase(hidden: boolean) {
    setDraft((prev) =>
      prev
        ? { ...prev, problem: { ...prev.problem, testCases: [...prev.problem.testCases, newTestCase(hidden)] } }
        : prev,
    );
  }

  function updateTestCase(id: string, patch: Partial<TestCase>) {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            problem: {
              ...prev.problem,
              testCases: prev.problem.testCases.map((tc) => (tc.id === id ? { ...tc, ...patch } : tc)),
            },
          }
        : prev,
    );
  }

  function removeTestCase(id: string) {
    setDraft((prev) =>
      prev
        ? { ...prev, problem: { ...prev.problem, testCases: prev.problem.testCases.filter((tc) => tc.id !== id) } }
        : prev,
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Coding Creator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Author coding problems with test cases, judge limits, targeting and proctoring.
          </p>
        </div>
        <Button className="rounded-xl" onClick={() => setDraft(emptyDraft())}>
          <Plus className="size-4" />
          New coding assessment
        </Button>
      </div>

      <AssessmentListCard
        title="Coding assessments"
        emptyLabel="No coding assessments yet. Create your first one."
        isLoading={assessmentsQ.isLoading}
        assessments={codingAssessments}
        onCreate={() => setDraft(emptyDraft())}
        onEdit={openEdit}
        onDuplicate={(a) => duplicateMutation.mutate(a.id)}
        onToggleStatus={(a) =>
          statusMutation.mutate({ id: a.id, status: a.status === "active" ? "draft" : "active" })
        }
        onArchive={(a) => statusMutation.mutate({ id: a.id, status: "archived" })}
        onDelete={(a) => setPendingDelete(a)}
        pendingDelete={pendingDelete}
        setPendingDelete={setPendingDelete}
        confirmDelete={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
        isDeleting={deleteMutation.isPending}
        metaFor={(a) =>
          `${a.problem?.testCases.length ?? 0} test cases • ${a.totalMarks} marks • ${a.durationMinutes} min`
        }
      />

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-4xl">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.id ? "Edit coding assessment" : "New coding assessment"}</DialogTitle>
                <DialogDescription>
                  Configure the problem, targeting, schedule and proctoring for this assessment.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="coding-title">Title</Label>
                  <Input
                    id="coding-title"
                    className="rounded-xl"
                    placeholder="Arrays & Strings – Practice Set 1"
                    value={draft.title}
                    onChange={(e) => setDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="coding-description">Description</Label>
                  <Textarea
                    id="coding-description"
                    className="rounded-xl"
                    value={draft.description}
                    onChange={(e) =>
                      setDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="coding-instructions">Instructions</Label>
                  <Textarea
                    id="coding-instructions"
                    className="rounded-xl"
                    value={draft.instructions}
                    onChange={(e) =>
                      setDraft((prev) => (prev ? { ...prev, instructions: e.target.value } : prev))
                    }
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="coding-duration">Duration (min)</Label>
                    <Input
                      id="coding-duration"
                      type="number"
                      min={1}
                      className="rounded-xl"
                      value={draft.durationMinutes}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev ? { ...prev, durationMinutes: Number(e.target.value) || 0 } : prev,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coding-pass">Pass %</Label>
                    <Input
                      id="coding-pass"
                      type="number"
                      min={0}
                      max={100}
                      className="rounded-xl"
                      value={draft.passPercentage}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev ? { ...prev, passPercentage: Number(e.target.value) || 0 } : prev,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coding-total">Total marks</Label>
                    <Input
                      id="coding-total"
                      type="number"
                      min={0}
                      className="rounded-xl"
                      placeholder={String(computedMarks)}
                      value={draft.totalMarksOverride ?? computedMarks}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev ? { ...prev, totalMarksOverride: Number(e.target.value) || 0 } : prev,
                        )
                      }
                    />
                  </div>
                </div>

                <TargetingPicker
                  targeting={draft.targeting}
                  tenants={tenants}
                  onChange={(targeting) => setDraft((prev) => (prev ? { ...prev, targeting } : prev))}
                />

                <ScheduleFields
                  scheduledStart={draft.scheduledStart}
                  scheduledEnd={draft.scheduledEnd}
                  onChange={(next) => setDraft((prev) => (prev ? { ...prev, ...next } : prev))}
                />

                <ProctoringBar
                  config={draft.proctorConfig}
                  onChange={(proctorConfig) =>
                    setDraft((prev) => (prev ? { ...prev, proctorConfig } : prev))
                  }
                />

                <Card className="rounded-2xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Problem</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="problem-statement">Statement</Label>
                      <Textarea
                        id="problem-statement"
                        className="min-h-28 rounded-xl"
                        value={draft.problem.statement}
                        onChange={(e) => updateProblem({ statement: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="problem-input-format">Input format</Label>
                        <Textarea
                          id="problem-input-format"
                          className="rounded-xl"
                          value={draft.problem.inputFormat}
                          onChange={(e) => updateProblem({ inputFormat: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="problem-output-format">Output format</Label>
                        <Textarea
                          id="problem-output-format"
                          className="rounded-xl"
                          value={draft.problem.outputFormat}
                          onChange={(e) => updateProblem({ outputFormat: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="problem-constraints">Constraints</Label>
                      <Textarea
                        id="problem-constraints"
                        className="rounded-xl"
                        value={draft.problem.constraints}
                        onChange={(e) => updateProblem({ constraints: e.target.value })}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="problem-time-limit">Time limit (sec)</Label>
                        <Input
                          id="problem-time-limit"
                          type="number"
                          min={1}
                          className="rounded-xl"
                          value={draft.problem.timeLimitSeconds}
                          onChange={(e) => updateProblem({ timeLimitSeconds: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="problem-memory-limit">Memory limit (MB)</Label>
                        <Input
                          id="problem-memory-limit"
                          type="number"
                          min={1}
                          className="rounded-xl"
                          value={draft.problem.memoryLimitMb}
                          onChange={(e) => updateProblem({ memoryLimitMb: Number(e.target.value) || 0 })}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Allowed languages</Label>
                      <div className="flex flex-wrap gap-2">
                        {CODING_LANGUAGES.map((lang) => {
                          const active = draft.problem.languages.includes(lang);
                          return (
                            <button
                              key={lang}
                              type="button"
                              onClick={() => toggleLanguage(lang)}
                              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                active
                                  ? "border-primary bg-primary-muted text-primary"
                                  : "border-border hover:bg-muted/60"
                              }`}
                            >
                              <Checkbox checked={active} className="pointer-events-none size-3.5" />
                              {LANGUAGE_LABELS[lang]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center justify-between rounded-xl border p-3">
                        <Label htmlFor="block-copy-paste" className="text-sm font-medium">
                          Block copy/paste
                        </Label>
                        <Switch
                          id="block-copy-paste"
                          checked={draft.problem.blockCopyPaste}
                          onCheckedChange={(v) => updateProblem({ blockCopyPaste: v })}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-xl border p-3">
                        <Label htmlFor="full-screen-lock" className="text-sm font-medium">
                          Full-screen lock
                        </Label>
                        <Switch
                          id="full-screen-lock"
                          checked={draft.problem.fullScreenLock}
                          onCheckedChange={(v) => updateProblem({ fullScreenLock: v })}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl">
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Test cases ({draft.problem.testCases.length})
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => addTestCase(false)}>
                        <Plus className="size-3.5" />
                        Visible case
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => addTestCase(true)}>
                        <Plus className="size-3.5" />
                        Hidden case
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {draft.problem.testCases.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No test cases yet. Add at least one visible and one hidden case.
                      </p>
                    ) : (
                      draft.problem.testCases.map((tc, i) => (
                        <div key={tc.id} className="surface-card space-y-3 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold">
                              Test case {i + 1} {tc.hidden ? <span className="text-muted-foreground">(hidden)</span> : null}
                            </p>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 rounded-lg text-destructive"
                              aria-label={`Remove test case ${i + 1}`}
                              onClick={() => removeTestCase(tc.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor={`tc-input-${tc.id}`}>Input</Label>
                              <Textarea
                                id={`tc-input-${tc.id}`}
                                className="rounded-xl font-mono text-xs"
                                value={tc.input}
                                onChange={(e) => updateTestCase(tc.id, { input: e.target.value })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`tc-output-${tc.id}`}>Expected output</Label>
                              <Textarea
                                id={`tc-output-${tc.id}`}
                                className="rounded-xl font-mono text-xs"
                                value={tc.expectedOutput}
                                onChange={(e) => updateTestCase(tc.id, { expectedOutput: e.target.value })}
                              />
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`tc-hidden-${tc.id}`}
                                checked={tc.hidden}
                                onCheckedChange={(v) => updateTestCase(tc.id, { hidden: v })}
                              />
                              <Label htmlFor={`tc-hidden-${tc.id}`} className="text-sm font-medium">
                                Hidden
                              </Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Label htmlFor={`tc-points-${tc.id}`} className="text-sm font-medium">
                                Points
                              </Label>
                              <Input
                                id={`tc-points-${tc.id}`}
                                type="number"
                                min={0}
                                className="w-24 rounded-xl"
                                value={tc.points}
                                onChange={(e) => updateTestCase(tc.id, { points: Number(e.target.value) || 0 })}
                              />
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    {publishWarning ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <p>{publishWarning}</p>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                {validationErrors.length > 0 ? (
                  <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Fix these before saving:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {validationErrors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>

              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  className="rounded-xl"
                  disabled={validationErrors.length > 0 || saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ d: draft, status: "draft" })}
                >
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save as draft
                </Button>
                <Button
                  className="rounded-xl"
                  disabled={validationErrors.length > 0 || saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ d: draft, status: "active" })}
                >
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save & publish
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
