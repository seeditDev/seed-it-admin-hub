import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";


import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  bankDocToChallenge,
  listCodingChallenges,
  type CodingBankDoc,
} from "@/lib/firestore/codingBank";
import {
  CODING_LANGUAGES,
  DEFAULT_PROCTOR_CONFIG,
  DEFAULT_TARGETING,
  DIFFICULTIES,
  LANGUAGE_LABELS,
  type AssessmentTargeting,
  type CodingChallenge,
  type Difficulty,
  type ProctorConfig,
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

/* ─────────────────────────────────── helpers ─────────────────────────────────── */


/* ─────────────────────────────────── draft ──────────────────────────────────── */

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
  challenges: CodingChallenge[];
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
    challenges: [],
  };
}

function draftFromDoc(doc: AssessmentDoc): CodingDraft {
  // Support both legacy single-problem and new multi-challenge
  const challenges: CodingChallenge[] =
    doc.challenges && doc.challenges.length > 0
      ? doc.challenges
      : doc.problem
        ? [{ ...doc.problem, id: doc.id, title: doc.title, difficulty: "medium", category: "General" }]
        : [];
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
    challenges,
  };
}

/* ─────────────────────────────────── page ──────────────────────────────────── */

function CodingCreatorPage() {
  const qc = useQueryClient();
  const { account, scopedTenantId } = useAuth();
  const [draft, setDraft] = useState<CodingDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AssessmentDoc | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  /* ── Bank dialog state ── */
  const [bankOpen, setBankOpen] = useState(false);
  const [bankSearch, setBankSearch] = useState("");
  const [bankCategory, setBankCategory] = useState("");
  const [bankDifficulty, setBankDifficulty] = useState("");
  const [bankDocs, setBankDocs] = useState<CodingBankDoc[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);

  /* ── Queries ── */
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
    () =>
      draft
        ? draft.challenges.reduce(
            (sum, c) => sum + c.testCases.reduce((s, tc) => s + (Number(tc.points) || 0), 0),
            0,
          )
        : 0,
    [draft],
  );

  const validationErrors = useMemo(() => {
    if (!draft) return [] as string[];
    const errs: string[] = [];
    if (!draft.title.trim()) errs.push("Title is required");
    if (draft.durationMinutes <= 0) errs.push("Duration must be greater than 0");
    if (draft.challenges.length === 0) errs.push("Add at least one challenge from the Question Bank");
    return errs;
  }, [draft]);

  /* ── Challenge order helpers (bank-mapped only) ── */
  function removeChallenge(idx: number) {
    setDraft((prev) =>
      prev ? { ...prev, challenges: prev.challenges.filter((_, i) => i !== idx) } : prev,
    );
  }

  function moveChallenge(idx: number, dir: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.challenges.length) return prev;
      const next = [...prev.challenges];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item!);
      return { ...prev, challenges: next };
    });
  }

  /* ── Bank dialog ── */
  async function openBank() {
    setBankOpen(true);
    setBankLoading(true);
    setBankError(null);
    try {
      const docs = await listCodingChallenges();
      setBankDocs(docs);
    } catch (err) {
      setBankError(err instanceof Error ? err.message : "Failed to load coding bank.");
    } finally {
      setBankLoading(false);
    }
  }

  function mapFromBank(bankDoc: CodingBankDoc) {
    const alreadyMapped = draft?.challenges.some((c) => c.id === bankDoc.id);
    if (alreadyMapped) { toast.info("Already mapped."); return; }
    const challenge = bankDocToChallenge(bankDoc);
    setDraft((prev) => prev ? { ...prev, challenges: [...prev.challenges, challenge] } : prev);
    toast.success(`Added "${bankDoc.title}" from bank.`);
  }

  /* ── Filtered bank list ── */
  const filteredBank = useMemo(() => {
    return bankDocs.filter((d) => {
      if (bankSearch && !d.title.toLowerCase().includes(bankSearch.toLowerCase()) &&
          !d.category.toLowerCase().includes(bankSearch.toLowerCase())) return false;
      if (bankCategory && d.category !== bankCategory) return false;
      if (bankDifficulty && d.difficulty !== bankDifficulty) return false;
      return true;
    });
  }, [bankDocs, bankSearch, bankCategory, bankDifficulty]);

  /* ── Mutations ── */
  const saveMutation = useMutation({
    mutationFn: async (vars: { d: CodingDraft; status?: AssessmentDoc["status"] }) => {
      const { d, status } = vars;
      const resolvedStatus = status ?? (d.id ? undefined : "draft");

      // 1. Save to Firestore assessments/ (metadata + full challenges array)
      const id = await saveAssessment(
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
          challenges: d.challenges,
          status: resolvedStatus,
        },
        account?.uid,
      );

      // 2. If publishing (status = active), upload full JSON to seed-contents
      //    and save each challenge's metadata to codingChallenges/
      if (resolvedStatus === "active") {
        let uploadedUrl: string | null = null;

        // Try GitHub upload
        try {
          const { uploadSeedContent, codingAssessmentPath } = await import("@/lib/seedContents");

          const assessmentJson = JSON.stringify(
            {
              id,
              title: d.title,
              description: d.description,
              instructions: d.instructions,
              durationMinutes: d.durationMinutes,
              totalMarks: d.totalMarksOverride ?? computedMarks,
              passPercentage: d.passPercentage,
              // Slim reference array — full question data lives in coding/questions/{id}.json
              questionIds: d.challenges.map((c) => c.id),
              challenges: d.challenges.map((c) => ({
                id: c.id,
                title: c.title,
                difficulty: c.difficulty,
                category: c.category,
                isMapped: c.isMapped ?? false,
              })),
            },
            null,
            2,
          );

          const { path } = codingAssessmentPath(id, d.title);
          uploadedUrl = await uploadSeedContent(
            path,
            assessmentJson,
            `Add coding assessment: ${d.title}`,
          );

          // Save cdnUrl back to Firestore assessment doc
          await saveAssessment({ id, title: d.title, type: "coding", cdnUrl: uploadedUrl });
        } catch (githubErr) {
          console.error("seed-contents upload failed:", githubErr);
          toast.warning("GitHub upload failed — assessment saved in Firestore only. Check VITE_GITHUB_PAT.");
        }

        // 3. Save each NEW challenge to codingChallenges/ bank
        try {
          const { saveCodingChallenge } = await import("@/lib/firestore/codingBank");
          const bankSaves = d.challenges
            .filter((c) => !c.isMapped)
            .map((c) =>
              saveCodingChallenge({
                id: c.id,
                title: c.title,
                slug: c.id,
                difficulty: c.difficulty,
                category: c.category,
                tags: [],
                description: c.statement ?? "",
                inputFormat: c.inputFormat ?? "",
                outputFormat: c.outputFormat ?? "",
                constraints: c.constraints ?? "",
                examples: [],
                starterCode: {},
                testCases: c.testCases,
                maxScore: c.testCases.reduce((s, tc) => s + (Number(tc.points) || 0), 0),
                active: true,
                ...(account?.uid ? { createdBy: account.uid } : {}),
              }),
            );
          await Promise.all(bankSaves);
        } catch (bankErr) {
          console.warn("Bank save failed:", bankErr);
        }

        // Always register in contentUrls registry for the Courses dropdown
        try {
          const { upsertContentUrl } = await import("@/lib/firestore/contentUrls");
          await upsertContentUrl({
            id,
            title: d.title,
            type: "coding",
            cdnUrl: uploadedUrl ?? "",
            slug: uploadedUrl ? (uploadedUrl.split("/").pop() ?? id) : id,
            totalMarks: d.totalMarksOverride ?? computedMarks,
            durationMinutes: d.durationMinutes,
          });
        } catch (regErr) {
          console.warn("contentUrls registration failed:", regErr);
        }

        return { id, cdnUrl: uploadedUrl };
      }

      return { id, cdnUrl: null };
    },
    onSuccess: (result) => {
      if (result?.cdnUrl) {
        toast.success(`Test slug created ✓`, {
          duration: 12000,
          description: `JSON URL: ${result.cdnUrl}  — Map it in Courses & Assessments → Test slot.`,
          action: {
            label: "Copy URL",
            onClick: () => navigator.clipboard.writeText(result.cdnUrl!),
          },
        });
      } else {
        toast.success("Coding assessment saved — map it in Courses & Assessments.");
      }
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["assessments"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save assessment"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateAssessment(id),
    onSuccess: () => { toast.success("Assessment duplicated"); void qc.invalidateQueries({ queryKey: ["assessments"] }); },
    onError: () => toast.error("Could not duplicate assessment"),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: AssessmentDoc["status"] }) => setAssessmentStatus(vars.id, vars.status),
    onSuccess: () => { toast.success("Status updated"); void qc.invalidateQueries({ queryKey: ["assessments"] }); },
    onError: () => toast.error("Could not update status"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAssessment(id),
    onSuccess: () => { toast.success("Assessment deleted"); setPendingDelete(null); void qc.invalidateQueries({ queryKey: ["assessments"] }); },
    onError: () => toast.error("Delete failed"),
  });

  async function openEdit(a: AssessmentDoc) {
    const full = await getAssessment(a.id);
    setDraft(draftFromDoc(full ?? a));
  }

  /**
   * Toggle draft→active: must run the FULL save mutation so the CDN upload
   * and contentUrls registration happen. Flipping status only (statusMutation)
   * would leave cdnUrl empty and break SEB loading.
   * active→draft: simple status-only flip is fine (CDN already written).
   */
  async function handleToggleStatus(a: AssessmentDoc) {
    if (a.status === "active") {
      statusMutation.mutate({ id: a.id, status: "draft" });
    } else {
      const full = await getAssessment(a.id);
      if (!full) { toast.error("Could not load assessment for publishing."); return; }
      saveMutation.mutate({ d: draftFromDoc(full ?? a), status: "active" });
    }
  }

  /* ── Bulk import from seed-contents questions_index.json ── */
  const [importing, setImporting] = useState(false);

  async function handleBulkImport() {
    if (importing) return;
    setImporting(true);
    try {
      const { bulkImportFromQuestionsIndex } = await import("@/lib/firestore/codingBank");
      const total = await bulkImportFromQuestionsIndex((saved, tot) => {
        toast.loading(`Importing coding questions… ${saved}/${tot}`, { id: "bulk-import" });
      });
      toast.success(`Done! Imported ${total} coding questions into the bank.`, { id: "bulk-import", duration: 6000 });
      void qc.invalidateQueries({ queryKey: ["codingBank"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk import failed.", { id: "bulk-import" });
    } finally {
      setImporting(false);
    }
  }

  /* ─────────────────────── render ─────────────────────── */
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Coding Creator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a coding assessment by mapping questions from the Question Bank — saves as a test slug for Courses &amp; Assessments.
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
        onToggleStatus={handleToggleStatus}
        onArchive={(a) => statusMutation.mutate({ id: a.id, status: "archived" })}
        onDelete={(a) => setPendingDelete(a)}
        pendingDelete={pendingDelete}
        setPendingDelete={setPendingDelete}
        confirmDelete={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
        isDeleting={deleteMutation.isPending}
        metaFor={(a) =>
          `${a.challenges?.length ?? (a.problem ? 1 : 0)} challenge(s) • ${a.totalMarks} marks • ${a.durationMinutes} min`
        }
      />

      {/* ── Editor dialog ── */}
      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-5xl">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.id ? "Edit coding assessment" : "New coding assessment"}</DialogTitle>
                <DialogDescription>
                  Map questions from the Question Bank · configure schedule and proctoring · targeting in Courses &amp; Assessments.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Basic metadata */}
                <div className="space-y-2">
                  <Label htmlFor="coding-title">Title</Label>
                  <Input id="coding-title" className="rounded-xl" placeholder="Arrays & Strings – Practice Set 1"
                    value={draft.title}
                    onChange={(e) => setDraft((prev) => prev ? { ...prev, title: e.target.value } : prev)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="coding-description">Description</Label>
                  <Textarea id="coding-description" className="rounded-xl" value={draft.description}
                    onChange={(e) => setDraft((prev) => prev ? { ...prev, description: e.target.value } : prev)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="coding-instructions">Instructions</Label>
                  <Textarea id="coding-instructions" className="rounded-xl" value={draft.instructions}
                    onChange={(e) => setDraft((prev) => prev ? { ...prev, instructions: e.target.value } : prev)} />
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="coding-duration">Duration (min)</Label>
                    <Input id="coding-duration" type="number" min={1} className="rounded-xl"
                      value={draft.durationMinutes || ""}
                      onChange={(e) => setDraft((prev) => prev ? { ...prev, durationMinutes: e.target.value === "" ? 0 : Number(e.target.value) } : prev)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coding-pass">Pass %</Label>
                    <Input id="coding-pass" type="number" min={0} max={100} className="rounded-xl"
                      value={draft.passPercentage}
                      onChange={(e) => setDraft((prev) => prev ? { ...prev, passPercentage: Number(e.target.value) || 0 } : prev)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coding-total">
                      Total marks
                      {draft.totalMarksOverride !== null && (
                        <button
                          type="button"
                          className="ml-2 text-[10px] text-muted-foreground underline hover:text-foreground"
                          onClick={() => setDraft((prev) => prev ? { ...prev, totalMarksOverride: null } : prev)}
                        >
                          reset to auto ({computedMarks})
                        </button>
                      )}
                    </Label>
                    <Input id="coding-total" type="number" min={0} className="rounded-xl"
                      placeholder={`Auto: ${computedMarks}`}
                      value={draft.totalMarksOverride ?? ""}
                      onChange={(e) => setDraft((prev) => prev ? {
                        ...prev,
                        totalMarksOverride: e.target.value === "" ? null : Number(e.target.value),
                      } : prev)} />
                    <p className="text-xs text-muted-foreground">
                      Leave blank to use auto-computed sum ({computedMarks} pts). Type to override.
                    </p>
                  </div>
                </div>

                <ScheduleFields scheduledStart={draft.scheduledStart} scheduledEnd={draft.scheduledEnd}
                  onChange={(next) => setDraft((prev) => prev ? { ...prev, ...next } : prev)} />
                <ProctoringBar config={draft.proctorConfig}
                  onChange={(proctorConfig) => setDraft((prev) => prev ? { ...prev, proctorConfig } : prev)} />

                {/* ── Challenges section (bank-mapped only) ── */}
                <Card className="rounded-2xl">
                  <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
                    <div>
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        Mapped challenges
                        <Badge variant="secondary" className="rounded-full text-[11px]">{draft.challenges.length}</Badge>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Questions mapped from the bank — order them below
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={openBank}>
                        <BookOpen className="size-3.5" /> Map from Bank
                      </Button>
                      <Link to="/question-bank">
                        <Button size="sm" variant="ghost" className="rounded-xl gap-1.5 text-xs">
                          <ExternalLink className="size-3.5" /> Create new question
                        </Button>
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {draft.challenges.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-8 text-center">
                        <BookOpen className="size-7 text-muted-foreground" />
                        <div>
                          <p className="text-sm text-muted-foreground">No challenges mapped yet.</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Click "Map from Bank" to add questions, or go to
                            <Link to="/question-bank" className="text-primary ml-1 hover:underline">Question Bank</Link> to create new ones.
                          </p>
                        </div>
                      </div>
                    ) : (
                      draft.challenges.map((challenge, cIdx) => (
                        <div key={`${challenge.id}-${cIdx}`}
                          className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
                          <div className="flex flex-col gap-0.5 mr-1">
                            <Button size="icon" variant="ghost" className="size-6 rounded-md"
                              disabled={cIdx === 0} onClick={() => moveChallenge(cIdx, -1)}
                              aria-label="Move up">
                              <ArrowUp className="size-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-6 rounded-md"
                              disabled={cIdx === draft.challenges.length - 1} onClick={() => moveChallenge(cIdx, 1)}
                              aria-label="Move down">
                              <ArrowDown className="size-3" />
                            </Button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{challenge.title}</p>
                            <p className="text-xs text-muted-foreground">
                              <span className="capitalize">{challenge.difficulty}</span>
                              {" · "}{challenge.category}
                              {" · "}{challenge.testCases.length} test case{challenge.testCases.length !== 1 ? "s" : ""}
                              {" · "}{challenge.testCases.reduce((s, tc) => s + (Number(tc.points) || 0), 0)} pts
                            </p>
                          </div>
                          <Badge variant="secondary" className="rounded-full text-[10px] shrink-0">Bank</Badge>
                          <code className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">{challenge.id}</code>
                          <Button size="icon" variant="ghost" className="size-7 rounded-lg text-destructive shrink-0"
                            aria-label="Remove challenge" onClick={() => removeChallenge(cIdx)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                {validationErrors.length > 0 && (
                  <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    <div>
                      <p className="font-semibold">Fix these before saving:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setDraft(null)}>Cancel</Button>
                <Button variant="secondary" className="rounded-xl"
                  disabled={validationErrors.length > 0 || saveMutation.isPending}
                  onClick={() => draft && saveMutation.mutate({ d: draft, status: "draft" })}>
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save draft
                </Button>
                <Button className="rounded-xl"
                  disabled={validationErrors.length > 0 || saveMutation.isPending}
                  onClick={() => draft && saveMutation.mutate({ d: draft, status: "active" })}>
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Publish &amp; create slug
                </Button>
              </DialogFooter>

            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Bank dialog ── */}
      <Dialog open={bankOpen} onOpenChange={(open) => { if (!open) setBankOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Coding Challenge Bank — Firestore</DialogTitle>
            <DialogDescription>Browse available challenges and add them to your assessment.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-1">
              <Input className="rounded-xl" placeholder="Search by title or category…"
                value={bankSearch} onChange={(e) => setBankSearch(e.target.value)} />
            </div>
            <Select value={bankCategory} onValueChange={(v) => setBankCategory(v === "all" ? "" : v)}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {Array.from(new Set(bankDocs.map((d) => d.category))).map((c) =>
                  <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={bankDifficulty} onValueChange={(v) => setBankDifficulty(v === "all" ? "" : v)}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Difficulty" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {DIFFICULTIES.map((d) => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {bankError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{bankError}</div>
          )}

          {bankLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBank.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        {bankDocs.length === 0
                          ? "No challenges in Firestore bank yet. Add challenges to the codingChallenges collection."
                          : "No challenges match your filters."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredBank.map((doc) => {
                      const alreadyMapped = draft?.challenges.some((c) => c.id === doc.id);
                      return (
                        <TableRow key={doc.id}>
                          <TableCell className="font-medium text-sm">{doc.title}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="rounded-full text-[10px] capitalize">{doc.difficulty}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{doc.category}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{doc.tags.slice(0, 3).join(", ")}</TableCell>
                          <TableCell>
                            <Button size="sm" variant={alreadyMapped ? "secondary" : "outline"}
                              className="rounded-xl text-xs"
                              disabled={alreadyMapped}
                              onClick={() => mapFromBank(doc)}>
                              {alreadyMapped ? "Added" : "Add"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setBankOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Preview dialog ── */}
      {previewIndex !== null && draft?.challenges[previewIndex] && (
        <Dialog open={previewIndex !== null} onOpenChange={(open) => { if (!open) setPreviewIndex(null); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Preview: {draft.challenges[previewIndex]!.title || "Untitled Challenge"}</DialogTitle>
              <DialogDescription>
                <Badge variant="outline" className="capitalize rounded-full">{draft.challenges[previewIndex]!.difficulty}</Badge>
                {" · "}
                {draft.challenges[previewIndex]!.category}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              {draft.challenges[previewIndex]!.statement && (
                <div>
                  <p className="font-semibold text-xs uppercase text-muted-foreground mb-1">Problem</p>
                  <p className="whitespace-pre-wrap">{draft.challenges[previewIndex]!.statement}</p>
                </div>
              )}
              {draft.challenges[previewIndex]!.inputFormat && (
                <div>
                  <p className="font-semibold text-xs uppercase text-muted-foreground mb-1">Input Format</p>
                  <p className="whitespace-pre-wrap">{draft.challenges[previewIndex]!.inputFormat}</p>
                </div>
              )}
              {draft.challenges[previewIndex]!.outputFormat && (
                <div>
                  <p className="font-semibold text-xs uppercase text-muted-foreground mb-1">Output Format</p>
                  <p className="whitespace-pre-wrap">{draft.challenges[previewIndex]!.outputFormat}</p>
                </div>
              )}
              {draft.challenges[previewIndex]!.constraints && (
                <div>
                  <p className="font-semibold text-xs uppercase text-muted-foreground mb-1">Constraints</p>
                  <p className="whitespace-pre-wrap">{draft.challenges[previewIndex]!.constraints}</p>
                </div>
              )}
              <div>
                <p className="font-semibold text-xs uppercase text-muted-foreground mb-1">
                  Sample Test Cases ({draft.challenges[previewIndex]!.testCases.filter((tc) => !tc.hidden).length})
                </p>
                {draft.challenges[previewIndex]!.testCases.filter((tc) => !tc.hidden).map((tc, i) => (
                  <div key={tc.id} className="rounded-xl border p-3 mb-2 space-y-2 font-mono text-xs">
                    <p className="font-semibold not-italic text-xs text-muted-foreground">Sample {i + 1}</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <div><span className="text-muted-foreground">Input:</span> <pre className="inline whitespace-pre-wrap">{tc.input}</pre></div>
                      <div><span className="text-muted-foreground">Output:</span> <pre className="inline whitespace-pre-wrap">{tc.expectedOutput}</pre></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button className="rounded-xl" onClick={() => setPreviewIndex(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
