import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { listTenants } from "@/lib/firestore/tenants";
import {
  generateAssessmentCode,
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
import { mcqApi, type PrepinstaQuestion } from "@/lib/mcqApi";

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

/* ─────────────────────────────────── helpers ─────────────────────────────────── */

const MCQ_CATEGORIES = [
  "Technical MCQ", "Quants", "Verbal",
  "Logical", "General Awareness", "Current Affairs", "Programming"
];

function newQuestion(): McqQuestion {
  return {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text: "",
    options: ["", "", "", ""],
    correctIndex: -1,
    explanation: "",
    difficulty: "medium",
    marks: 1,
  };
}

/** Convert Supabase PrepinstaQuestion → McqQuestion (Firestore format). */
function bankQToMcq(q: PrepinstaQuestion, marksPerQ = 1): McqQuestion {
  const optTexts = q.options.map((o) => o.text);
  const correctIndex = q.options.findIndex((o) => o.option === q.correct_option);
  let text = q.question_text;
  if (q.images && q.images.length > 0) {
    text += "\n\n" + q.images.map((img) => `![Question Image](${img})`).join("\n");
  }
  return {
    id: `bank-${q.question_number}`,
    text,
    options: optTexts,
    correctIndex: correctIndex >= 0 ? correctIndex : 0,
    explanation: q.explanation ?? "",
    difficulty: (q.difficulty?.toLowerCase() ?? "medium") as Difficulty,
    marks: marksPerQ,
  };
}

/* ─────────────────────────────────── draft types ─────────────────────────────── */

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
  /** Guest access code — students can enter this to start test without login */
  assessmentCode: string | null;
  guestEnabled: boolean;
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
    questions: [],
    assessmentCode: null,
    guestEnabled: false,
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
    questions: doc.questions.length > 0 ? doc.questions : [],
    assessmentCode: doc.assessmentCode ?? null,
    guestEnabled: doc.guestEnabled ?? false,
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

/* ─────────────────────────────── custom question form ─────────────────────────── */

interface CustomQForm {
  question_text: string;
  optionA: string; optionB: string; optionC: string; optionD: string;
  correct_option: string;
  difficulty: string;
  category: string;
  topic: string;
  company: string;
}

function emptyCustomQ(): CustomQForm {
  return {
    question_text: "", optionA: "", optionB: "", optionC: "", optionD: "",
    correct_option: "A", difficulty: "Easy",
    category: "Technical MCQ", topic: "", company: "",
  };
}

/* ─────────────────────────────────── page ─────────────────────────────────────── */

function McqCreatorPage() {
  const qc = useQueryClient();
  const { account, scopedTenantId } = useAuth();
  const [draft, setDraft] = useState<McqDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AssessmentDoc | null>(null);

  /* ---- Bank browser state ---- */
  const [bankOpen, setBankOpen] = useState(false);
  const [bankPage, setBankPage] = useState(1);
  const [bankPageSize] = useState(25);
  const [bankSearch, setBankSearch] = useState("");
  const [bankCategory, setBankCategory] = useState("");
  const [bankDifficulty, setBankDifficulty] = useState("");
  const [bankTopic, setBankTopic] = useState("");
  const [bankCompany, setBankCompany] = useState("");
  const [bankQuestions, setBankQuestions] = useState<PrepinstaQuestion[]>([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [topicsList, setTopicsList] = useState<string[]>([]);
  const [companiesList, setCompaniesList] = useState<string[]>([]);

  /* ---- Custom Q dialog ---- */
  const [customOpen, setCustomOpen] = useState(false);
  const [customSaving, setCustomSaving] = useState(false);
  const [customQ, setCustomQ] = useState<CustomQForm>(emptyCustomQ());

  /* ---- Queries ---- */
  const assessmentsQ = useQuery({ queryKey: ["assessments"], queryFn: listAssessments });
  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const mcqAssessments = useMemo(
    () => (assessmentsQ.data ?? []).filter((a) => a.type === "mcq" || a.type === "multisection"),
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

  /* ---- Bank data fetch ---- */
  const fetchBankQuestions = useCallback(async () => {
    setBankLoading(true);
    setBankError(null);
    try {
      const res = await mcqApi.getPrepinstaQuestions({
        page: bankPage,
        page_size: bankPageSize,
        ...(bankSearch ? { search: bankSearch } : {}),
        ...(bankCategory ? { category: bankCategory } : {}),
        ...(bankDifficulty ? { difficulty: bankDifficulty } : {}),
        ...(bankTopic ? { topic: bankTopic } : {}),
        ...(bankCompany ? { company: bankCompany } : {}),
      });
      if (res.success) {
        setBankQuestions(res.data ?? []);
        setBankTotal(res.total ?? 0);
      } else {
        setBankError("Failed to load questions from the bank.");
      }
    } catch (err) {
      setBankError(err instanceof Error ? err.message : "Error fetching bank questions.");
    } finally {
      setBankLoading(false);
    }
  }, [bankPage, bankPageSize, bankSearch, bankCategory, bankDifficulty, bankTopic, bankCompany]);

  useEffect(() => {
    if (bankOpen) { void fetchBankQuestions(); }
  }, [bankOpen, fetchBankQuestions]);

  /* Fetch metadata (topics / companies) once */
  useEffect(() => {
    if (!bankOpen) return;
    mcqApi.getPrepinstaMetadata().then((res) => {
      // Direct Supabase: res has { topics, companies } directly (no 'success' wrapper)
      if (res.topics?.length) setTopicsList(res.topics);
      if (res.companies?.length) setCompaniesList(res.companies);
    }).catch(() => {/* silent */ });
  }, [bankOpen]);

  /* ---- Is question already selected? ---- */
  const isSelected = useCallback(
    (q: PrepinstaQuestion) =>
      (draft?.questions ?? []).some((sq) => sq.id === `bank-${q.question_number}`),
    [draft],
  );

  /* ---- Toggle bank question in/out of selection ---- */
  function toggleBankQ(q: PrepinstaQuestion) {
    if (!draft) return;
    const id = `bank-${q.question_number}`;
    if (draft.questions.some((sq) => sq.id === id)) {
      setDraft((prev) => prev ? { ...prev, questions: prev.questions.filter((sq) => sq.id !== id) } : prev);
    } else {
      setDraft((prev) =>
        prev ? { ...prev, questions: [...prev.questions, bankQToMcq(q, 1)] } : prev,
      );
    }
  }

  /* ---- Select all on current page ---- */
  function selectAllOnPage() {
    if (!draft) return;
    const toAdd = bankQuestions
      .filter((q) => !isSelected(q))
      .map((q) => bankQToMcq(q, 1));
    if (toAdd.length === 0) { toast.info("All questions on this page are already selected."); return; }
    setDraft((prev) => prev ? { ...prev, questions: [...prev.questions, ...toAdd] } : prev);
    toast.success(`Added ${toAdd.length} questions from this page.`);
  }

  /* ---- Add N random questions ---- */
  async function addRandomQuestions() {
    const countStr = window.prompt("How many random questions would you like to add?", "10");
    if (!countStr) return;
    const count = parseInt(countStr, 10);
    if (isNaN(count) || count <= 0) { toast.warning("Invalid count."); return; }
    setBankLoading(true);
    try {
      const res = await mcqApi.getPrepinstaQuestions({
        page: 1, page_size: 150,
        ...(bankSearch ? { search: bankSearch } : {}),
        ...(bankCategory ? { category: bankCategory } : {}),
        ...(bankDifficulty ? { difficulty: bankDifficulty } : {}),
        ...(bankTopic ? { topic: bankTopic } : {}),
        ...(bankCompany ? { company: bankCompany } : {}),
      });
      if (res.success && res.data.length > 0) {
        const pool = [...res.data].sort(() => Math.random() - 0.5);
        const toAdd = pool
          .filter((q) => !isSelected(q))
          .slice(0, count)
          .map((q) => bankQToMcq(q, 1));
        setDraft((prev) => prev ? { ...prev, questions: [...prev.questions, ...toAdd] } : prev);
        toast.success(`Added ${toAdd.length} random questions.`);
      } else {
        toast.warning("No questions found matching criteria.");
      }
    } catch {
      toast.error("Error adding random questions.");
    } finally {
      setBankLoading(false);
    }
  }

  /* ---- Shuffle selected ---- */
  function shuffleSelected() {
    setDraft((prev) => {
      if (!prev) return prev;
      const shuffled = [...prev.questions].sort(() => Math.random() - 0.5);
      return { ...prev, questions: shuffled };
    });
    toast.success("Shuffled question order.");
  }

  /* ---- Manual question editors ---- */
  function addQuestion() {
    setDraft((prev) => prev ? { ...prev, questions: [...prev.questions, newQuestion()] } : prev);
  }
  function updateQuestion(id: string, patch: Partial<McqQuestion>) {
    setDraft((prev) =>
      prev ? { ...prev, questions: prev.questions.map((q) => q.id === id ? { ...q, ...patch } : q) } : prev,
    );
  }
  function removeQuestion(id: string) {
    setDraft((prev) => prev ? { ...prev, questions: prev.questions.filter((q) => q.id !== id) } : prev);
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
    setDraft((prev) =>
      prev
        ? {
          ...prev,
          questions: prev.questions.map((q) =>
            q.id === qid && q.options.length < 6 ? { ...q, options: [...q.options, ""] } : q,
          ),
        }
        : prev,
    );
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

  /* ---- Save custom question to Supabase and add to draft ---- */
  async function saveCustomQuestion() {
    const { question_text, optionA, optionB, optionC, optionD, correct_option, difficulty, category, topic, company } = customQ;
    if (!question_text || !optionA || !optionB || !optionC || !optionD) {
      toast.warning("Please fill in question text and all four options (A–D).");
      return;
    }
    setCustomSaving(true);
    try {
      const res = await mcqApi.createCustomQuestion({
        question_text,
        correct_option,
        options: [
          { option: "A", text: optionA },
          { option: "B", text: optionB },
          { option: "C", text: optionC },
          { option: "D", text: optionD },
        ],
        difficulty, category, topic, company,
      });
      if (res.success) {
        toast.success("Custom question saved to Supabase!");
        setCustomOpen(false);
        // Immediately add to draft
        const newQ: McqQuestion = {
          id: `bank-${res.question_number}`,
          text: question_text,
          options: [optionA, optionB, optionC, optionD],
          correctIndex: ["A", "B", "C", "D"].indexOf(correct_option),
          explanation: "",
          difficulty: (difficulty.toLowerCase() as Difficulty) ?? "medium",
          marks: 1,
        };
        setDraft((prev) => prev ? { ...prev, questions: [...prev.questions, newQ] } : prev);
        setCustomQ(emptyCustomQ());
        void fetchBankQuestions();
      } else {
        toast.error("Failed to save custom question.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving custom question.");
    } finally {
      setCustomSaving(false);
    }
  }

  /* ── Mutations ── */
  const saveMutation = useMutation({
    mutationFn: async (vars: { d: McqDraft; status?: AssessmentDoc["status"] }) => {
      const { d, status } = vars;
      const resolvedStatus = status ?? (d.id ? undefined : "draft");

      // 1. Save to Firestore
      const id = await saveAssessment(
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
          status: resolvedStatus,
          assessmentCode: d.assessmentCode,
          guestEnabled: d.guestEnabled,
        },
        account?.uid,
      );

      // 2. If publishing, upload JSON to seed-contents + register CDN URL
      if (resolvedStatus === "active") {
        let uploadedUrl: string | null = null;

        // Try GitHub upload
        try {
          const { uploadSeedContent, mcqAssessmentPath } = await import("@/lib/seedContents");

          const assessmentJson = JSON.stringify(
            {
              // ── Root fields SEB expects ──
              id,
              name: d.title,         // SEB reads .name (not .title)
              title: d.title,        // keep for backward compat
              section: d.description || "Mixed",
              topic: d.instructions || "Mixed",
              difficulty: d.questions[0]?.difficulty ?? "medium",
              duration: d.durationMinutes,                // SEB reads .duration (minutes)
              durationMinutes: d.durationMinutes,        // backward compat alias
              totalQuestions: d.questions.length,
              totalMarks: d.totalMarksOverride ?? computedMarks,
              passPercentage: d.passPercentage,
              negativeMarking: d.negativeMarking,
              // ── Questions in SEB format ──
              questions: d.questions.map((q, qi) => ({
                id: q.id ?? String(qi + 1),
                question: q.text,                                    // McqQuestion.text → SEB question
                text: q.text,                                        // backward compat
                options: Array.isArray(q.options) ? q.options : [],
                // McqQuestion uses correctIndex (number); SEB expects the option string
                correctAnswer: Array.isArray(q.options) && q.correctIndex >= 0
                  ? (q.options[q.correctIndex] ?? "")
                  : "",
                explanation: q.explanation ?? "",
                difficulty: q.difficulty ?? "medium",
                images: [],
                marks: q.marks ?? 1,
              })),
            },
            null, 2,
          );

          const { path } = mcqAssessmentPath(id, d.title);
          uploadedUrl = await uploadSeedContent(path, assessmentJson, `Add MCQ assessment: ${d.title}`);

          // Store cdnUrl on assessment doc
          await saveAssessment({ id, title: d.title, type: "mcq", cdnUrl: uploadedUrl });
        } catch (githubErr) {
          console.error("seed-contents upload failed:", githubErr);
          toast.warning("GitHub upload failed — assessment saved in Firestore only. Check VITE_GITHUB_PAT.");
        }

        // Always register in contentUrls registry for the Courses dropdown
        try {
          const { upsertContentUrl } = await import("@/lib/firestore/contentUrls");
          await upsertContentUrl({
            id,
            title: d.title,
            type: "mcq",
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
          description: `JSON URL: ${result.cdnUrl}  — Copy it and map it in Courses & Assessments → Test slot.`,
          action: {
            label: "Copy URL",
            onClick: () => navigator.clipboard.writeText(result.cdnUrl!),
          },
        });
      } else {
        toast.success("MCQ assessment saved — map it via Courses & Assessments.");
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
   * Publish a draft from the list card — runs the full saveMutation with
   * status=active so GitHub upload + contentUrls registration are triggered.
   * If toggling active→draft, just update status (no CDN work needed).
   */
  async function handleToggleStatus(a: AssessmentDoc) {
    if (a.status === "active") {
      // Deactivate — simple status toggle
      statusMutation.mutate({ id: a.id, status: "draft" });
    } else {
      // Publish draft → active (need full slug creation)
      const full = await getAssessment(a.id);
      if (!full) { toast.error("Could not load assessment for publishing."); return; }
      saveMutation.mutate({ d: draftFromDoc(full), status: "active" });
    }
  }

  const totalPages = Math.max(1, Math.ceil(bankTotal / bankPageSize));

  /* ─────────────────────────────────── render ─────────────────────────────────── */
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">MCQ Creator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build an MCQ assessment from the Supabase question bank — saves as a test slug you map in Courses &amp; Assessments.
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
        onToggleStatus={handleToggleStatus}
        onArchive={(a) => statusMutation.mutate({ id: a.id, status: "archived" })}
        onDelete={(a) => setPendingDelete(a)}
        pendingDelete={pendingDelete}
        setPendingDelete={setPendingDelete}
        confirmDelete={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
        isDeleting={deleteMutation.isPending}
        metaFor={(a) => `${a.questions.length} questions • ${a.totalMarks} marks • ${a.durationMinutes} min`}
      />

      {/* ── Assessment editor dialog ── */}
      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-5xl">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.id ? "Edit MCQ assessment" : "New MCQ assessment"}</DialogTitle>
                <DialogDescription>
                  Configure questions, targeting, schedule and proctoring for this assessment.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Basic metadata */}
                <div className="space-y-2">
                  <Label htmlFor="mcq-title">Title</Label>
                  <Input id="mcq-title" className="rounded-xl" placeholder="Data Structures – Unit Test 1"
                    value={draft.title}
                    onChange={(e) => setDraft((prev) => prev ? { ...prev, title: e.target.value } : prev)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mcq-description">Description</Label>
                  <Textarea id="mcq-description" className="rounded-xl" value={draft.description}
                    onChange={(e) => setDraft((prev) => prev ? { ...prev, description: e.target.value } : prev)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mcq-instructions">Instructions</Label>
                  <Textarea id="mcq-instructions" className="rounded-xl" value={draft.instructions}
                    onChange={(e) => setDraft((prev) => prev ? { ...prev, instructions: e.target.value } : prev)} />
                </div>

                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="mcq-duration">Duration (min)</Label>
                    <Input id="mcq-duration" type="number" min={1} className="rounded-xl"
                      value={draft.durationMinutes || ""}
                      onChange={(e) => setDraft((prev) => prev ? { ...prev, durationMinutes: e.target.value === "" ? 0 : Number(e.target.value) } : prev)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcq-pass">Pass %</Label>
                    <Input id="mcq-pass" type="number" min={0} max={100} className="rounded-xl"
                      value={draft.passPercentage}
                      onChange={(e) => setDraft((prev) => prev ? { ...prev, passPercentage: Number(e.target.value) || 0 } : prev)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcq-negative">Negative marking</Label>
                    <Input id="mcq-negative" type="number" min={0} step="0.25" className="rounded-xl"
                      value={draft.negativeMarking}
                      onChange={(e) => setDraft((prev) => prev ? { ...prev, negativeMarking: Number(e.target.value) || 0 } : prev)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcq-total">
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
                    <Input id="mcq-total" type="number" min={0} className="rounded-xl"
                      placeholder={`Auto: ${computedMarks}`}
                      value={draft.totalMarksOverride ?? ""}
                      onChange={(e) => setDraft((prev) => prev ? {
                        ...prev,
                        totalMarksOverride: e.target.value === "" ? null : Number(e.target.value),
                      } : prev)} />
                    <p className="text-xs text-muted-foreground">
                      Leave blank to use auto-computed sum ({computedMarks} pts from questions). Type to override.
                    </p>
                  </div>
                </div>

                <ScheduleFields scheduledStart={draft.scheduledStart} scheduledEnd={draft.scheduledEnd}
                  onChange={(next) => setDraft((prev) => prev ? { ...prev, ...next } : prev)} />
                <ProctoringBar config={draft.proctorConfig}
                  onChange={(proctorConfig) => setDraft((prev) => prev ? { ...prev, proctorConfig } : prev)} />

                {/* ── Guest Access (Assessment Code) ── */}
                <Card className="rounded-2xl border-dashed">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-sm font-semibold">Guest Access</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Allow students to take this assessment without logging in.
                          They enter the code + their college / year / name / roll no.
                        </p>
                      </div>
                      <Switch
                        id="mcq-guest-enabled"
                        checked={draft.guestEnabled}
                        onCheckedChange={(v) => setDraft((prev) => prev ? {
                          ...prev,
                          guestEnabled: v,
                          assessmentCode: v ? (prev.assessmentCode ?? generateAssessmentCode()) : prev.assessmentCode,
                        } : prev)}
                      />
                    </div>
                  </CardHeader>
                  {draft.guestEnabled && (
                    <CardContent className="pt-0 space-y-2">
                      <Label htmlFor="mcq-code">Assessment Code</Label>
                      <div className="flex gap-2">
                        <Input
                          id="mcq-code"
                          className="rounded-xl font-mono font-bold tracking-widest uppercase"
                          maxLength={10}
                          value={draft.assessmentCode ?? ""}
                          onChange={(e) => setDraft((prev) => prev ? { ...prev, assessmentCode: e.target.value.toUpperCase().trim() } : prev)}
                        />
                        <Button type="button" size="icon" variant="outline" className="rounded-xl shrink-0"
                          title="Generate new code"
                          onClick={() => setDraft((prev) => prev ? { ...prev, assessmentCode: generateAssessmentCode() } : prev)}>
                          <RefreshCw className="size-4" />
                        </Button>
                        {draft.assessmentCode && (
                          <Button type="button" size="icon" variant="outline" className="rounded-xl shrink-0"
                            title="Copy code"
                            onClick={() => navigator.clipboard.writeText(draft.assessmentCode!)}
                          >
                            <Copy className="size-4" />
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Share this code with students. They visit the guest portal, enter the code,
                        fill in their details (name, college, year, roll no), and start the test immediately.
                        No account required.
                      </p>
                    </CardContent>
                  )}
                </Card>

                {/* ── Questions section ── */}
                <Card className="rounded-2xl">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Questions
                      <Badge variant="secondary" className="ml-2 rounded-full text-[11px]">
                        {draft.questions.length}
                      </Badge>
                    </CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl gap-1.5"
                        onClick={() => { setBankPage(1); setBankOpen(true); }}>
                        <BookOpen className="size-3.5" /> Browse Bank
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl gap-1.5"
                        onClick={() => { setCustomQ(emptyCustomQ()); setCustomOpen(true); }}>
                        <PenLine className="size-3.5" /> Custom Question
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl gap-1.5"
                        onClick={addQuestion}>
                        <Plus className="size-3.5" /> Blank Question
                      </Button>
                      {draft.questions.length > 1 && (
                        <Button size="sm" variant="ghost" className="rounded-xl gap-1.5"
                          onClick={shuffleSelected}>
                          <Shuffle className="size-3.5" /> Shuffle
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {draft.questions.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No questions yet — browse the bank or add a blank question.
                      </p>
                    ) : (
                      draft.questions.filter(Boolean).map((q, qIdx) => {
                        const qErrors = validateQuestion(q);
                        return (
                          <div key={q.id} className="surface-card space-y-3 p-4">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-semibold">
                                Q{qIdx + 1}
                                {q.id?.startsWith("bank-") && (
                                  <Badge variant="secondary" className="ml-2 rounded-full text-[10px]">Bank</Badge>
                                )}
                              </span>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" className="size-8 rounded-lg"
                                  aria-label="Move up" disabled={qIdx === 0}
                                  onClick={() => moveQuestion(q.id, -1)}>
                                  <ArrowUp className="size-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-8 rounded-lg"
                                  aria-label="Move down" disabled={qIdx === draft.questions.length - 1}
                                  onClick={() => moveQuestion(q.id, 1)}>
                                  <ArrowDown className="size-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-8 rounded-lg"
                                  aria-label="Duplicate question" onClick={() => duplicateQuestion(q.id)}>
                                  <Copy className="size-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="size-8 rounded-lg text-destructive"
                                  aria-label="Remove question" onClick={() => removeQuestion(q.id)}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`q-text-${q.id}`}>Question text</Label>
                              <Textarea id={`q-text-${q.id}`} className="rounded-xl" value={q.text}
                                onChange={(e) => updateQuestion(q.id, { text: e.target.value })} />
                            </div>

                            <div className="space-y-2">
                              <Label>Options (select the correct one)</Label>
                              <RadioGroup value={String(q.correctIndex)}
                                onValueChange={(v) => updateQuestion(q.id, { correctIndex: Number(v) })}
                                className="space-y-2">
                                {q.options.map((opt, optIdx) => (
                                  <div key={optIdx} className="flex items-center gap-2">
                                    <RadioGroupItem value={String(optIdx)} id={`q-${q.id}-opt-${optIdx}`}
                                      aria-label={`Mark option ${optIdx + 1} as correct`} />
                                    <Input className="rounded-xl" placeholder={`Option ${optIdx + 1}`}
                                      value={opt} onChange={(e) => updateOption(q.id, optIdx, e.target.value)} />
                                    <Button size="icon" variant="ghost" className="size-8 shrink-0 rounded-lg text-destructive"
                                      aria-label={`Remove option ${optIdx + 1}`} disabled={q.options.length <= 2}
                                      onClick={() => removeOption(q.id, optIdx)}>
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </div>
                                ))}
                              </RadioGroup>
                              <Button size="sm" variant="outline" className="rounded-xl"
                                disabled={q.options.length >= 6} onClick={() => addOption(q.id)}>
                                <Plus className="size-3.5" /> Add option
                              </Button>
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`q-explanation-${q.id}`}>Explanation</Label>
                              <Textarea id={`q-explanation-${q.id}`} className="rounded-xl"
                                value={q.explanation ?? ""}
                                onChange={(e) => updateQuestion(q.id, { explanation: e.target.value })} />
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-2">
                                <Label htmlFor={`q-difficulty-${q.id}`}>Difficulty</Label>
                                <Select value={q.difficulty}
                                  onValueChange={(v) => updateQuestion(q.id, { difficulty: v as Difficulty })}>
                                  <SelectTrigger id={`q-difficulty-${q.id}`} className="rounded-xl"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {DIFFICULTIES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`q-marks-${q.id}`}>Marks</Label>
                                <Input id={`q-marks-${q.id}`} type="number" min={0} step="0.5" className="rounded-xl"
                                  value={q.marks} onChange={(e) => updateQuestion(q.id, { marks: Number(e.target.value) || 0 })} />
                              </div>
                            </div>

                            {qErrors.length > 0 && (
                              <p className="text-xs text-destructive">{qErrors.join(" · ")}</p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>

                {validationErrors.length > 0 && (
                  <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Fix these before saving:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="flex-wrap gap-2">
                <Button variant="outline" className="rounded-xl" onClick={() => setDraft(null)}>Cancel</Button>
                <Button
                  variant="secondary"
                  className="rounded-xl"
                  disabled={!draft?.title?.trim() || saveMutation.isPending}
                  onClick={() => draft && saveMutation.mutate({ d: draft, status: "draft" })}
                >
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save as Draft
                </Button>
                <Button
                  className="rounded-xl"
                  disabled={validationErrors.length > 0 || saveMutation.isPending}
                  onClick={() => draft && saveMutation.mutate({ d: draft, status: "active" })}
                >
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Publish &amp; Create Slug
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Bank browser dialog ── */}
      <Dialog open={bankOpen} onOpenChange={(open) => { if (!open) setBankOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Question Bank — Supabase</DialogTitle>
            <DialogDescription>
              Browse, filter and select questions to add to your assessment. Selected: {draft?.questions.filter((q) => q?.id?.startsWith("bank-")).length ?? 0}

            </DialogDescription>
          </DialogHeader>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="col-span-2 sm:col-span-3 lg:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="rounded-xl pl-9" placeholder="Search questions…"
                  value={bankSearch} onChange={(e) => { setBankSearch(e.target.value); setBankPage(1); }} />
              </div>
            </div>
            <Select value={bankCategory} onValueChange={(v) => { setBankCategory(v === "all" ? "" : v); setBankPage(1); }}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {MCQ_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={bankDifficulty} onValueChange={(v) => { setBankDifficulty(v === "all" ? "" : v); setBankPage(1); }}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Difficulty" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="Easy">Easy</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Hard">Hard</SelectItem>
              </SelectContent>
            </Select>
            <Select value={bankTopic} onValueChange={(v) => { setBankTopic(v === "all" ? "" : v); setBankPage(1); }}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Topic" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All topics</SelectItem>
                {topicsList.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>{bankTotal} questions found</span>
            <Button size="sm" variant="ghost" className="h-auto rounded-lg px-2 py-0.5 text-xs"
              onClick={fetchBankQuestions} disabled={bankLoading}>
              <RefreshCw className="size-3" /> Refresh
            </Button>
            <Button size="sm" variant="ghost" className="h-auto rounded-lg px-2 py-0.5 text-xs"
              onClick={selectAllOnPage} disabled={bankLoading}>
              Select page
            </Button>
            <Button size="sm" variant="ghost" className="h-auto rounded-lg px-2 py-0.5 text-xs"
              onClick={addRandomQuestions} disabled={bankLoading}>
              Add N random
            </Button>
          </div>

          {bankError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {bankError} — check VITE_API_URL in your .env file.
            </div>
          )}

          {bankLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>#</TableHead>
                    <TableHead>Question</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Topic</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankQuestions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No questions found. Adjust filters or check your backend connection.
                      </TableCell>
                    </TableRow>
                  ) : (
                    bankQuestions.map((q) => {
                      const sel = isSelected(q);
                      return (
                        <TableRow key={q.question_number} className={sel ? "bg-primary/5" : undefined}>
                          <TableCell>
                            <Checkbox checked={sel}
                              onCheckedChange={() => toggleBankQ(q)}
                              aria-label={`Select question ${q.question_number}`} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{q.question_number}</TableCell>
                          <TableCell className="max-w-xs truncate text-sm">{q.question_text}</TableCell>
                          <TableCell>
                            <Badge variant={q.difficulty?.toLowerCase() === "easy" ? "secondary" : q.difficulty?.toLowerCase() === "hard" ? "default" : "outline"}
                              className="rounded-full text-[10px] capitalize">{q.difficulty}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{q.category}</TableCell>
                          <TableCell className="text-xs">{q.topic}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {bankPage} of {totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="rounded-xl"
                disabled={bankPage <= 1} onClick={() => setBankPage((p) => p - 1)}>Prev</Button>
              <Button size="sm" variant="outline" className="rounded-xl"
                disabled={bankPage >= totalPages} onClick={() => setBankPage((p) => p + 1)}>Next</Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setBankOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Custom question dialog ── */}
      <Dialog open={customOpen} onOpenChange={(open) => { if (!open) setCustomOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Custom Question</DialogTitle>
            <DialogDescription>
              This question will be saved to the Supabase bank and immediately added to your assessment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Question Text</Label>
              <Textarea className="rounded-xl" rows={4} placeholder="Enter the question…"
                value={customQ.question_text}
                onChange={(e) => setCustomQ((p) => ({ ...p, question_text: e.target.value }))} />
            </div>
            {(["A", "B", "C", "D"] as const).map((letter) => (
              <div key={letter} className="space-y-2">
                <Label>Option {letter}</Label>
                <Input className="rounded-xl" placeholder={`Option ${letter}`}
                  value={customQ[`option${letter}` as keyof CustomQForm] as string}
                  onChange={(e) => setCustomQ((p) => ({ ...p, [`option${letter}`]: e.target.value }))} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Correct Answer</Label>
                <Select value={customQ.correct_option}
                  onValueChange={(v) => setCustomQ((p) => ({ ...p, correct_option: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["A", "B", "C", "D"].map((l) => <SelectItem key={l} value={l}>Option {l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Difficulty</Label>
                <Select value={customQ.difficulty}
                  onValueChange={(v) => setCustomQ((p) => ({ ...p, difficulty: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Easy", "Medium", "Hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={customQ.category}
                  onValueChange={(v) => setCustomQ((p) => ({ ...p, category: v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MCQ_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Topic (optional)</Label>
                <Input className="rounded-xl" value={customQ.topic}
                  onChange={(e) => setCustomQ((p) => ({ ...p, topic: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Company (optional)</Label>
              <Input className="rounded-xl" value={customQ.company}
                onChange={(e) => setCustomQ((p) => ({ ...p, company: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setCustomOpen(false)}>Cancel</Button>
            <Button className="rounded-xl" disabled={customSaving} onClick={saveCustomQuestion}>
              {customSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save to Supabase & Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
