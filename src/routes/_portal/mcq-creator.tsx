import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  deleteAssessment,
  duplicateAssessment,
  getAssessment,
  listAssessments,
  saveAssessment,
  setAssessmentStatus,
  type AssessmentDoc,
} from "@/lib/firestore/assessments";
import {
  DEFAULT_PROCTOR_CONFIG,
  DEFAULT_TARGETING,
  DIFFICULTIES,
  type AssessmentTargeting,
  type Difficulty,
  type McqQuestion,
  type ProctorConfig,
} from "@/types/seedit";
import { useAuth } from "@/lib/auth-context";
import {
  AssessmentListCard,
  ProctoringBar,
  ScheduleFields,
  TargetingPicker,
} from "@/components/assessment-authoring";

export const Route = createFileRoute("/_portal/mcq-creator")({
  head: () => ({
    meta: [
      { title: "MCQ Creator | SEED-IT Admin" },
      { name: "description", content: "Author multi-section multiple-choice assessments." },
      { property: "og:title", content: "MCQ Creator | SEED-IT Admin" },
      { property: "og:description", content: "Author multi-section multiple-choice assessments." },
    ],
  }),
  component: McqCreatorPage,
});

function newQuestion(): McqQuestion {
  return {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text: "",
    options: ["", ""],
    correctIndex: -1,
    explanation: "",
    difficulty: "medium",
    marks: 1,
  };
}

interface McqDraft {
  id?: string;
  title: string;
  description: string;
  instructions: string;
  durationMinutes: number;
  passPercentage: number;
  negativeMarking: number;
  totalMarksOverride: number | null;
  targeting: AssessmentTargeting;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  proctorConfig: ProctorConfig;
  questions: McqQuestion[];
}

function emptyDraft(): McqDraft {
  return {
    title: "",
    description: "",
    instructions: "",
    durationMinutes: 30,
    passPercentage: 40,
    negativeMarking: 0,
    totalMarksOverride: null,
    targeting: { ...DEFAULT_TARGETING },
    scheduledStart: null,
    scheduledEnd: null,
    proctorConfig: { ...DEFAULT_PROCTOR_CONFIG },
    questions: [newQuestion()],
  };
}

function draftFromDoc(doc: AssessmentDoc): McqDraft {
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    instructions: doc.instructions,
    durationMinutes: doc.durationMinutes,
    passPercentage: doc.passPercentage,
    negativeMarking: doc.negativeMarking,
    totalMarksOverride: doc.totalMarks,
    targeting: doc.targeting,
    scheduledStart: doc.scheduledStart ?? null,
    scheduledEnd: doc.scheduledEnd ?? null,
    proctorConfig: doc.proctorConfig,
    questions: doc.questions.length > 0 ? doc.questions : [newQuestion()],
  };
}

function validateQuestion(q: McqQuestion): string[] {
  const errs: string[] = [];
  if (!q.text.trim()) errs.push("Question text is required");
  const filledOptions = q.options.filter((o) => o.trim().length > 0);
  if (filledOptions.length < 2) errs.push("At least 2 non-empty options are required");
  if (q.correctIndex < 0 || q.correctIndex >= q.options.length || !q.options[q.correctIndex]?.trim())
    errs.push("Select a valid correct option");
  return errs;
}

function McqCreatorPage() {
  const qc = useQueryClient();
  const { account, scopedTenantId } = useAuth();
  const [draft, setDraft] = useState<McqDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AssessmentDoc | null>(null);

  const assessmentsQ = useQuery({ queryKey: ["assessments"], queryFn: listAssessments });
  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const mcqAssessments = useMemo(
    () =>
      (assessmentsQ.data ?? []).filter(
        (a) => a.type === "mcq" || a.type === "multisection",
      ),
    [assessmentsQ.data],
  );

  const computedMarks = useMemo(
    () => (draft ? draft.questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0) : 0),
    [draft],
  );

  const validationErrors = useMemo(() => {
    if (!draft) return [] as string[];
    const errs: string[] = [];
    if (!draft.title.trim()) errs.push("Title is required");
    if (draft.durationMinutes <= 0) errs.push("Duration must be greater than 0");
    if (draft.questions.length === 0) errs.push("Add at least one question");
    draft.questions.forEach((q, i) => {
      validateQuestion(q).forEach((e) => errs.push(`Question ${i + 1}: ${e}`));
    });
    return errs;
  }, [draft]);

  const saveMutation = useMutation({
    mutationFn: (d: McqDraft) =>
      saveAssessment(
        {
          ...(d.id ? { id: d.id } : {}),
          title: d.title,
          type: "mcq",
          description: d.description,
          instructions: d.instructions,
          durationMinutes: d.durationMinutes,
          passPercentage: d.passPercentage,
          negativeMarking: d.negativeMarking,
          totalMarks: d.totalMarksOverride ?? computedMarks,
          targeting: d.targeting,
          scheduledStart: d.scheduledStart,
          scheduledEnd: d.scheduledEnd,
          proctorConfig: d.proctorConfig,
          questions: d.questions,
          status: d.id ? undefined : "draft",
        },
        account?.uid,
      ),
    onSuccess: () => {
      toast.success("MCQ assessment saved");
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

  function updateQuestion(id: string, patch: Partial<McqQuestion>) {
    setDraft((prev) =>
      prev
        ? { ...prev, questions: prev.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }
        : prev,
    );
  }

  function addQuestion() {
    setDraft((prev) => (prev ? { ...prev, questions: [...prev.questions, newQuestion()] } : prev));
  }

  function duplicateQuestion(id: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const idx = prev.questions.findIndex((q) => q.id === id);
      if (idx === -1) return prev;
      const copy: McqQuestion = { ...prev.questions[idx]!, id: newQuestion().id };
      const next = [...prev.questions];
      next.splice(idx + 1, 0, copy);
      return { ...prev, questions: next };
    });
  }

  function removeQuestion(id: string) {
    setDraft((prev) =>
      prev ? { ...prev, questions: prev.questions.filter((q) => q.id !== id) } : prev,
    );
  }

  function moveQuestion(id: string, dir: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      const idx = prev.questions.findIndex((q) => q.id === id);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= prev.questions.length) return prev;
      const next = [...prev.questions];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item!);
      return { ...prev, questions: next };
    });
  }

  function updateOption(qid: string, optIdx: number, value: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) => {
          if (q.id !== qid) return q;
          const options = [...q.options];
          options[optIdx] = value;
          return { ...q, options };
        }),
      };
    });
  }

  function addOption(qid: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) =>
          q.id === qid && q.options.length < 6 ? { ...q, options: [...q.options, ""] } : q,
        ),
      };
    });
  }

  function removeOption(qid: string, optIdx: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) => {
          if (q.id !== qid || q.options.length <= 2) return q;
          const options = q.options.filter((_, i) => i !== optIdx);
          let correctIndex = q.correctIndex;
          if (optIdx === q.correctIndex) correctIndex = -1;
          else if (optIdx < q.correctIndex) correctIndex -= 1;
          return { ...q, options, correctIndex };
        }),
      };
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">MCQ Creator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Author multi-section multiple-choice assessments with targeting, scheduling and proctoring.
          </p>
        </div>
        <Button className="rounded-xl" onClick={() => setDraft(emptyDraft())}>
          <Plus className="size-4" />
          New MCQ assessment
        </Button>
      </div>

      <AssessmentListCard
        title="MCQ assessments"
        emptyLabel="No MCQ assessments yet. Create your first one."
        isLoading={assessmentsQ.isLoading}
        assessments={mcqAssessments}
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
        metaFor={(a) => `${a.questions.length} questions • ${a.totalMarks} marks • ${a.durationMinutes} min`}
      />

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-4xl">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.id ? "Edit MCQ assessment" : "New MCQ assessment"}</DialogTitle>
                <DialogDescription>
                  Configure the questions, targeting, schedule and proctoring for this assessment.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mcq-title">Title</Label>
                  <Input
                    id="mcq-title"
                    className="rounded-xl"
                    placeholder="Data Structures – Unit Test 1"
                    value={draft.title}
                    onChange={(e) => setDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mcq-description">Description</Label>
                  <Textarea
                    id="mcq-description"
                    className="rounded-xl"
                    value={draft.description}
                    onChange={(e) =>
                      setDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mcq-instructions">Instructions</Label>
                  <Textarea
                    id="mcq-instructions"
                    className="rounded-xl"
                    value={draft.instructions}
                    onChange={(e) =>
                      setDraft((prev) => (prev ? { ...prev, instructions: e.target.value } : prev))
                    }
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="mcq-duration">Duration (min)</Label>
                    <Input
                      id="mcq-duration"
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
                    <Label htmlFor="mcq-pass">Pass %</Label>
                    <Input
                      id="mcq-pass"
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
                    <Label htmlFor="mcq-negative">Negative marking</Label>
                    <Input
                      id="mcq-negative"
                      type="number"
                      min={0}
                      step="0.25"
                      className="rounded-xl"
                      value={draft.negativeMarking}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev ? { ...prev, negativeMarking: Number(e.target.value) || 0 } : prev,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcq-total">Total marks</Label>
                    <Input
                      id="mcq-total"
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
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Questions ({draft.questions.length})
                    </CardTitle>
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={addQuestion}>
                      <Plus className="size-3.5" />
                      Add question
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {draft.questions.map((q, qIdx) => {
                      const qErrors = validateQuestion(q);
                      return (
                        <div key={q.id} className="surface-card space-y-3 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold">Question {qIdx + 1}</p>
                            <div className="flex gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8 rounded-lg"
                                aria-label="Move question up"
                                disabled={qIdx === 0}
                                onClick={() => moveQuestion(q.id, -1)}
                              >
                                ↑
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8 rounded-lg"
                                aria-label="Move question down"
                                disabled={qIdx === draft.questions.length - 1}
                                onClick={() => moveQuestion(q.id, 1)}
                              >
                                ↓
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8 rounded-lg"
                                aria-label="Duplicate question"
                                onClick={() => duplicateQuestion(q.id)}
                              >
                                <Copy className="size-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8 rounded-lg text-destructive"
                                aria-label="Remove question"
                                disabled={draft.questions.length <= 1}
                                onClick={() => removeQuestion(q.id)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`q-text-${q.id}`}>Question text</Label>
                            <Textarea
                              id={`q-text-${q.id}`}
                              className="rounded-xl"
                              value={q.text}
                              onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Options (select the correct one)</Label>
                            <RadioGroup
                              value={String(q.correctIndex)}
                              onValueChange={(v) => updateQuestion(q.id, { correctIndex: Number(v) })}
                              className="space-y-2"
                            >
                              {q.options.map((opt, optIdx) => (
                                <div key={optIdx} className="flex items-center gap-2">
                                  <RadioGroupItem
                                    value={String(optIdx)}
                                    id={`q-${q.id}-opt-${optIdx}`}
                                    aria-label={`Mark option ${optIdx + 1} as correct`}
                                  />
                                  <Input
                                    className="rounded-xl"
                                    placeholder={`Option ${optIdx + 1}`}
                                    value={opt}
                                    onChange={(e) => updateOption(q.id, optIdx, e.target.value)}
                                  />
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-8 shrink-0 rounded-lg text-destructive"
                                    aria-label={`Remove option ${optIdx + 1}`}
                                    disabled={q.options.length <= 2}
                                    onClick={() => removeOption(q.id, optIdx)}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </RadioGroup>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl"
                              disabled={q.options.length >= 6}
                              onClick={() => addOption(q.id)}
                            >
                              <Plus className="size-3.5" />
                              Add option
                            </Button>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`q-explanation-${q.id}`}>Explanation</Label>
                            <Textarea
                              id={`q-explanation-${q.id}`}
                              className="rounded-xl"
                              value={q.explanation ?? ""}
                              onChange={(e) => updateQuestion(q.id, { explanation: e.target.value })}
                            />
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor={`q-difficulty-${q.id}`}>Difficulty</Label>
                              <Select
                                value={q.difficulty}
                                onValueChange={(v) => updateQuestion(q.id, { difficulty: v as Difficulty })}
                              >
                                <SelectTrigger id={`q-difficulty-${q.id}`} className="rounded-xl">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DIFFICULTIES.map((d) => (
                                    <SelectItem key={d} value={d}>
                                      {d}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`q-marks-${q.id}`}>Marks</Label>
                              <Input
                                id={`q-marks-${q.id}`}
                                type="number"
                                min={0}
                                step="0.5"
                                className="rounded-xl"
                                value={q.marks}
                                onChange={(e) => updateQuestion(q.id, { marks: Number(e.target.value) || 0 })}
                              />
                            </div>
                          </div>

                          {qErrors.length > 0 ? (
                            <p className="text-xs text-destructive">{qErrors.join(" · ")}</p>
                          ) : null}
                        </div>
                      );
                    })}
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
                  className="rounded-xl"
                  disabled={validationErrors.length > 0 || saveMutation.isPending}
                  onClick={() => saveMutation.mutate(draft)}
                >
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save assessment
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
