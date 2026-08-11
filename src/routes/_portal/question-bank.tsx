import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  Code2,
  Download,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  collection,
  where,
  orderBy,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  listCodingChallenges,
  saveCodingChallenge,
  bulkImportFromQuestionsIndex,
  type CodingBankDoc,
} from "@/lib/firestore/codingBank";
import { CODING_LANGUAGES, DIFFICULTIES, LANGUAGE_LABELS, type Difficulty } from "@/types/seedit";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_portal/question-bank")({
  head: () => ({
    meta: [
      { title: "Question Bank | SEED-IT Admin" },
      { name: "description", content: "Create and manage custom coding questions for assessments." },
      { property: "og:title", content: "Question Bank | SEED-IT Admin" },
      { property: "og:description", content: "Create and manage custom coding questions for assessments." },
    ],
  }),
  component: QuestionBankPage,
});

const QB_CATEGORY = "custom";

/* ─────────── helpers ─────────── */

function tcId() {
  return `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

interface TestCaseDraft {
  id: string;
  input: string;
  expectedOutput: string;
  hidden: boolean;
  points: number;
}

interface QuestionDraft {
  id: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  tags: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  examples: { input: string; output: string; explanation: string }[];
  starterCode: Record<string, string>;
  testCases: TestCaseDraft[];
  maxScore: number;
  active: boolean;
  isNew: boolean;
}

function emptyDraft(): QuestionDraft {
  return {
    id: "",
    title: "",
    slug: "",
    difficulty: "medium",
    tags: "",
    description: "",
    inputFormat: "",
    outputFormat: "",
    constraints: "1 ≤ n ≤ 10⁵\nTime Limit: 2.0s\nMemory Limit: 256 MB",
    examples: [{ input: "", output: "", explanation: "" }],
    starterCode: { python: "", cpp: "", java: "", c: "" },
    testCases: [
      { id: tcId(), input: "", expectedOutput: "", hidden: false, points: 10 },
      { id: tcId(), input: "", expectedOutput: "", hidden: true, points: 10 },
    ],
    maxScore: 20,
    active: true,
    isNew: true,
  };
}

function fromBankDoc(doc: CodingBankDoc): QuestionDraft {
  return {
    id: doc.id,
    title: doc.title,
    slug: doc.slug,
    difficulty: doc.difficulty,
    tags: doc.tags.join(", "),
    description: doc.description,
    inputFormat: doc.inputFormat,
    outputFormat: doc.outputFormat,
    constraints: doc.constraints,
    examples: doc.examples.length
      ? doc.examples.map((e) => ({ input: e.input, output: e.output, explanation: e.explanation ?? "" }))
      : [{ input: "", output: "", explanation: "" }],
    starterCode: { python: "", cpp: "", java: "", c: "", ...doc.starterCode },
    testCases: doc.testCases.length
      ? doc.testCases.map((tc) => ({ id: tc.id || tcId(), input: tc.input, expectedOutput: tc.expectedOutput, hidden: tc.hidden, points: tc.points }))
      : [{ id: tcId(), input: "", expectedOutput: "", hidden: false, points: 10 }],
    maxScore: doc.maxScore,
    active: doc.active,
    isNew: false,
  };
}

const DIFF_COLOR: Record<Difficulty, string> = {
  easy: "text-green-600 bg-green-50 border-green-200",
  medium: "text-yellow-600 bg-yellow-50 border-yellow-200",
  hard: "text-red-600 bg-red-50 border-red-200",
};

/* ─────────── Delete question service ─────────── */
async function deactivateQuestion(id: string) {
  await setDoc(doc(getDb(), "codingChallenges", id), { active: false, updatedAt: serverTimestamp() }, { merge: true });
}

/* ─────────── Component ─────────── */

function QuestionBankPage() {
  const qc = useQueryClient();
  const { account } = useAuth();

  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CodingBankDoc | null>(null);
  const [search, setSearch] = useState("");
  const [diffFilter, setDiffFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("details");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ saved: number; total: number } | null>(null);

  const handleBulkImport = async () => {
    setBulkImporting(true);
    setBulkProgress(null);
    const toastId = toast.loading('Importing questions from seed-contents…');
    try {
      const total = await bulkImportFromQuestionsIndex((saved, t) => {
        setBulkProgress({ saved, total: t });
        toast.loading(`Importing… ${saved}/${t}`, { id: toastId });
      });
      toast.success(`✓ Imported ${total} questions with cdnUrl`, { id: toastId });
      void qc.invalidateQueries({ queryKey: ['coding-bank'] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Import failed: ${msg}`, { id: toastId });
    } finally {
      setBulkImporting(false);
      setBulkProgress(null);
    }
  };

  /* ── Queries ── */
  const challengesQ = useQuery({
    queryKey: ["coding-bank", "custom"],
    queryFn: async () => {
      const q = query(
        collection(getDb(), "codingChallenges"),
        where("active", "==", true),
        where("QBCategory", "==", QB_CATEGORY),
        orderBy("title"),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          title: String(data["title"] ?? ""),
          slug: String(data["slug"] ?? d.id),
          difficulty: (data["difficulty"] as Difficulty) ?? "medium",
          category: String(data["category"] ?? "custom"),
          tags: Array.isArray(data["tags"]) ? (data["tags"] as string[]) : [],
          description: String(data["description"] ?? ""),
          inputFormat: String(data["inputFormat"] ?? ""),
          outputFormat: String(data["outputFormat"] ?? ""),
          constraints: String(data["constraints"] ?? ""),
          examples: Array.isArray(data["examples"]) ? (data["examples"] as CodingBankDoc["examples"]) : [],
          starterCode: (data["starterCode"] as Record<string, string>) ?? {},
          testCases: Array.isArray(data["testCases"]) ? (data["testCases"] as CodingBankDoc["testCases"]) : [],
          maxScore: Number(data["maxScore"] ?? 20),
          active: true,
          ...(data["createdBy"] ? { createdBy: String(data["createdBy"]) } : {}),
          ...(data["createdAt"] !== undefined ? { createdAt: data["createdAt"] } : {}),
        } as CodingBankDoc;
      });
    },
  });

  const questions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (challengesQ.data ?? []).filter((c) => {
      if (diffFilter !== "all" && c.difficulty !== diffFilter) return false;
      if (!q) return true;
      return [c.title, c.slug, ...c.tags].some((f) => String(f).toLowerCase().includes(q));
    });
  }, [challengesQ.data, search, diffFilter]);

  /* ── Save mutation ── */
  const saveMutation = useMutation({
    mutationFn: async (d: QuestionDraft) => {
      const slug = d.slug.trim() || d.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const id = d.isNew ? slug || d.id || `q-${Date.now()}` : d.id;
      await setDoc(
        doc(getDb(), "codingChallenges", id),
        {
          id,
          title: d.title.trim(),
          slug,
          difficulty: d.difficulty,
          category: QB_CATEGORY,
          QBCategory: QB_CATEGORY,
          tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
          description: d.description.trim(),
          inputFormat: d.inputFormat.trim(),
          outputFormat: d.outputFormat.trim(),
          constraints: d.constraints.trim(),
          examples: d.examples.filter((e) => e.input || e.output),
          starterCode: Object.fromEntries(Object.entries(d.starterCode).filter(([, v]) => v.trim())),
          testCases: d.testCases.map((tc) => ({ id: tc.id, input: tc.input, expectedOutput: tc.expectedOutput, hidden: tc.hidden, points: Number(tc.points) || 0 })),
          maxScore: Number(d.maxScore) || d.testCases.reduce((s, tc) => s + (Number(tc.points) || 0), 0),
          active: true,
          createdBy: account?.uid ?? "admin",
          updatedAt: serverTimestamp(),
          ...(d.isNew ? { createdAt: serverTimestamp() } : {}),
        },
        { merge: true },
      );
      return id;
    },
    onSuccess: (_, d) => {
      toast.success(d.isNew ? "Question added to bank ✓" : "Question updated ✓");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["coding-bank"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save question"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deactivateQuestion(id),
    onSuccess: () => {
      toast.success("Question removed from bank");
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: ["coding-bank"] });
    },
    onError: () => toast.error("Delete failed"),
  });

  /* ── Derived ── */
  const computedMax = draft
    ? draft.testCases.reduce((s, tc) => s + (Number(tc.points) || 0), 0)
    : 0;

  const canSave =
    Boolean(draft) &&
    draft!.title.trim().length > 0 &&
    draft!.description.trim().length > 0 &&
    draft!.testCases.length > 0;

  /* ── render ── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Question Bank</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create custom coding questions · mapped by ID in Coding Creator
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={handleBulkImport}
            disabled={bulkImporting}
            title="Import all questions from seed-contents/coding/questions_index.json and write cdnUrl to Firestore"
          >
            {bulkImporting
              ? <><Loader2 className="size-4 animate-spin" />{bulkProgress ? ` ${bulkProgress.saved}/${bulkProgress.total}` : ' Importing…'}</>
              : <><Download className="size-4" /> Bulk Import CDN Index</>}
          </Button>
          <Button
            className="rounded-xl"
            onClick={() => { setDraft(emptyDraft()); setActiveTab("details"); }}
          >
            <Plus className="size-4" /> New question
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="rounded-xl pl-9" placeholder="Search title, slug, tag…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={diffFilter} onValueChange={setDiffFilter}>
          <SelectTrigger className="rounded-xl w-40">
            <SelectValue placeholder="All difficulties" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All difficulties</SelectItem>
            {DIFFICULTIES.map((d) => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Question list */}
      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {challengesQ.isLoading ? (
            <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : questions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Code2 className="size-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">No custom questions yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Click "New question" to add your first coding question to the bank.
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Slug / ID</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Test Cases</TableHead>
                  <TableHead>Max Score</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">{q.title}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{q.slug || q.id}</code>
                    </TableCell>
                    <TableCell>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${DIFF_COLOR[q.difficulty]}`}>
                        {q.difficulty}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {q.tags.slice(0, 3).map((t) => (
                          <Badge key={t} variant="secondary" className="rounded-full text-[10px]">{t}</Badge>
                        ))}
                        {q.tags.length > 3 && <span className="text-xs text-muted-foreground">+{q.tags.length - 3}</span>}
                      </div>
                    </TableCell>
                    <TableCell>{q.testCases.length}</TableCell>
                    <TableCell>{q.maxScore}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon" variant="ghost" className="size-8 rounded-lg"
                          aria-label={`Edit ${q.title}`}
                          onClick={() => { setDraft(fromBankDoc(q)); setActiveTab("details"); }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="size-8 rounded-lg text-destructive hover:text-destructive"
                          aria-label={`Delete ${q.title}`}
                          onClick={() => setPendingDelete(q)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════ EDITOR DIALOG ═══════════════ */}
      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => { if (!open) setDraft(null); }}
      >
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-2xl">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.isNew ? "Add question to bank" : `Edit — ${draft.title}`}</DialogTitle>
                <DialogDescription>
                  Questions with <code className="text-xs">QBCategory: custom</code> appear in Coding Creator for mapping.
                </DialogDescription>
              </DialogHeader>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
                <TabsList className="rounded-xl">
                  <TabsTrigger value="details" className="rounded-lg">Details</TabsTrigger>
                  <TabsTrigger value="testcases" className="rounded-lg">Test cases ({draft.testCases.length})</TabsTrigger>
                  <TabsTrigger value="starter" className="rounded-lg">Starter code</TabsTrigger>
                </TabsList>

                {/* ── Details tab ── */}
                <TabsContent value="details" className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="qb-title">Title *</Label>
                      <Input id="qb-title" className="rounded-xl" placeholder="e.g. Two Sum" value={draft.title} onChange={(e) => setDraft((p) => p ? { ...p, title: e.target.value } : p)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="qb-slug">Slug / ID</Label>
                      <Input id="qb-slug" className="rounded-xl font-mono text-sm" placeholder="two-sum (auto from title if blank)" value={draft.slug} onChange={(e) => setDraft((p) => p ? { ...p, slug: e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") } : p)} />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="qb-diff">Difficulty</Label>
                      <Select value={draft.difficulty} onValueChange={(v) => setDraft((p) => p ? { ...p, difficulty: v as Difficulty } : p)}>
                        <SelectTrigger id="qb-diff" className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DIFFICULTIES.map((d) => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="qb-tags">Tags (comma-separated)</Label>
                      <Input id="qb-tags" className="rounded-xl" placeholder="arrays, hashmap, greedy" value={draft.tags} onChange={(e) => setDraft((p) => p ? { ...p, tags: e.target.value } : p)} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="qb-desc">Problem statement *</Label>
                    <Textarea id="qb-desc" className="rounded-xl font-mono text-sm min-h-32" placeholder="Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target..." value={draft.description} onChange={(e) => setDraft((p) => p ? { ...p, description: e.target.value } : p)} />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="qb-input">Input format</Label>
                      <Textarea id="qb-input" className="rounded-xl text-sm min-h-24" placeholder="First line: integer n..." value={draft.inputFormat} onChange={(e) => setDraft((p) => p ? { ...p, inputFormat: e.target.value } : p)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="qb-output">Output format</Label>
                      <Textarea id="qb-output" className="rounded-xl text-sm min-h-24" placeholder="Print the answer on a single line..." value={draft.outputFormat} onChange={(e) => setDraft((p) => p ? { ...p, outputFormat: e.target.value } : p)} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="qb-constraints">Constraints</Label>
                    <Textarea id="qb-constraints" className="rounded-xl font-mono text-sm min-h-20" value={draft.constraints} onChange={(e) => setDraft((p) => p ? { ...p, constraints: e.target.value } : p)} />
                  </div>

                  {/* Examples */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Examples (shown to student)</Label>
                      <Button
                        type="button" size="sm" variant="outline" className="rounded-xl h-7 text-xs"
                        onClick={() => setDraft((p) => p ? { ...p, examples: [...p.examples, { input: "", output: "", explanation: "" }] } : p)}
                      >
                        <Plus className="size-3 mr-1" /> Add example
                      </Button>
                    </div>
                    {draft.examples.map((ex, i) => (
                      <div key={i} className="rounded-xl border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground">Example {i + 1}</span>
                          {draft.examples.length > 1 && (
                            <button type="button" onClick={() => setDraft((p) => p ? { ...p, examples: p.examples.filter((_, j) => j !== i) } : p)}>
                              <X className="size-3.5 text-muted-foreground hover:text-destructive" />
                            </button>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Input</Label>
                            <Textarea className="rounded-lg font-mono text-xs min-h-16" value={ex.input} onChange={(e) => setDraft((p) => { if (!p) return p; const examples = [...p.examples]; examples[i] = { ...examples[i]!, input: e.target.value }; return { ...p, examples }; })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Output</Label>
                            <Textarea className="rounded-lg font-mono text-xs min-h-16" value={ex.output} onChange={(e) => setDraft((p) => { if (!p) return p; const examples = [...p.examples]; examples[i] = { ...examples[i]!, output: e.target.value }; return { ...p, examples }; })} />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Explanation (optional)</Label>
                          <Input className="rounded-lg text-xs" value={ex.explanation} onChange={(e) => setDraft((p) => { if (!p) return p; const examples = [...p.examples]; examples[i] = { ...examples[i]!, explanation: e.target.value }; return { ...p, examples }; })} />
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                {/* ── Test Cases tab ── */}
                <TabsContent value="testcases" className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Test cases</p>
                      <p className="text-xs text-muted-foreground">
                        Auto-computed max score: <strong>{computedMax}</strong> pts — or override below
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" className="rounded-xl h-8 text-xs" onClick={() => setDraft((p) => p ? { ...p, testCases: [...p.testCases, { id: tcId(), input: "", expectedOutput: "", hidden: false, points: 10 }] } : p)}>
                        <Plus className="size-3 mr-1" /> Public
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="rounded-xl h-8 text-xs" onClick={() => setDraft((p) => p ? { ...p, testCases: [...p.testCases, { id: tcId(), input: "", expectedOutput: "", hidden: true, points: 10 }] } : p)}>
                        <Plus className="size-3 mr-1" /> Hidden
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {draft.testCases.map((tc, i) => (
                      <div key={tc.id} className={`rounded-xl border p-3 space-y-2 ${tc.hidden ? "border-orange-200 bg-orange-50/30" : "border-green-200 bg-green-50/30"}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant={tc.hidden ? "outline" : "secondary"} className="rounded-full text-[10px]">
                              {tc.hidden ? "🔒 Hidden" : "👁 Public"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">TC {i + 1}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number" min={0}
                              className="rounded-lg h-7 w-20 text-xs text-center"
                              value={tc.points}
                              onChange={(e) => setDraft((p) => { if (!p) return p; const testCases = p.testCases.map((t) => t.id === tc.id ? { ...t, points: Number(e.target.value) || 0 } : t); return { ...p, testCases }; })}
                            />
                            <span className="text-xs text-muted-foreground">pts</span>
                            {draft.testCases.length > 1 && (
                              <button type="button" onClick={() => setDraft((p) => p ? { ...p, testCases: p.testCases.filter((t) => t.id !== tc.id) } : p)}>
                                <X className="size-3.5 text-muted-foreground hover:text-destructive" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Input</Label>
                            <Textarea className="rounded-lg font-mono text-xs min-h-16" placeholder="stdin input" value={tc.input} onChange={(e) => setDraft((p) => { if (!p) return p; const testCases = p.testCases.map((t) => t.id === tc.id ? { ...t, input: e.target.value } : t); return { ...p, testCases }; })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Expected output</Label>
                            <Textarea className="rounded-lg font-mono text-xs min-h-16" placeholder="expected stdout" value={tc.expectedOutput} onChange={(e) => setDraft((p) => { if (!p) return p; const testCases = p.testCases.map((t) => t.id === tc.id ? { ...t, expectedOutput: e.target.value } : t); return { ...p, testCases }; })} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 rounded-xl border p-3">
                    <Label htmlFor="qb-maxscore" className="text-sm whitespace-nowrap">Max score override</Label>
                    <Input
                      id="qb-maxscore" type="number" min={0}
                      className="rounded-xl w-28"
                      placeholder={String(computedMax)}
                      value={draft.maxScore || ""}
                      onChange={(e) => setDraft((p) => p ? { ...p, maxScore: Number(e.target.value) || 0 } : p)}
                    />
                    <p className="text-xs text-muted-foreground">Leave 0 to auto-sum from test case points ({computedMax} pts)</p>
                  </div>
                </TabsContent>

                {/* ── Starter code tab ── */}
                <TabsContent value="starter" className="mt-4 space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Provide language-specific starter code. Leave blank for languages you don't support.
                    Each key must match an allowed language identifier.
                  </p>
                  {(CODING_LANGUAGES as readonly string[]).map((lang) => (
                    <div key={lang} className="space-y-2">
                      <Label htmlFor={`starter-${lang}`} className="capitalize">
                        {LANGUAGE_LABELS[lang as keyof typeof LANGUAGE_LABELS] ?? lang}
                      </Label>
                      <Textarea
                        id={`starter-${lang}`}
                        className="rounded-xl font-mono text-xs min-h-28"
                        placeholder={`// ${lang} starter code`}
                        value={draft.starterCode[lang] ?? ""}
                        onChange={(e) => setDraft((p) => p ? { ...p, starterCode: { ...p.starterCode, [lang]: e.target.value } } : p)}
                      />
                    </div>
                  ))}
                </TabsContent>
              </Tabs>

              <DialogFooter className="mt-4">
                <Button variant="outline" className="rounded-xl" onClick={() => setDraft(null)}>Cancel</Button>
                <Button
                  className="rounded-xl"
                  disabled={!canSave || saveMutation.isPending}
                  onClick={() => draft && saveMutation.mutate(draft)}
                >
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {draft.isNew ? "Add to bank" : "Save changes"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ═══════════════ DELETE DIALOG ═══════════════ */}
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{pendingDelete?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the question in the bank. Existing assessments that have already mapped this ID will be unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
