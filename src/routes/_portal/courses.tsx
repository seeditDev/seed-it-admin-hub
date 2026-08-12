import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Building2,
  ChevronRight,
  Code2,
  Eye,
  FolderOpen,
  Layers,
  Loader2,
  Mic,
  Pencil,
  Plus,
  Trash2,
  X,
  ClipboardList,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listTenants } from "@/lib/firestore/tenants";
import { listContentUrls, type ContentUrlDoc } from "@/lib/firestore/contentUrls";
import {
  deleteCourse,
  deleteSeries,
  deleteTest,
  listCourses,
  listSeries,
  listTests,
  saveCourse,
  saveSeries,
  saveTest,
  testToAccessControlJson,
  updateTestTargeting,
  DEFAULT_SCHEDULE,
  SERIES_TYPES,
  type CourseDoc,
  type MSASection,
  type ScheduleConfig,
  type SeriesDoc,
  type TestDoc,
  type TestType,
} from "@/lib/firestore/courses";
import { DEFAULT_TARGETING, type AssessmentTargeting } from "@/types/seedit";
import { TargetingPicker } from "@/components/assessment-authoring";
import { useAuth } from "@/lib/auth-context";
import {
  getQuestionTracker,
  recordTestQuestionIds,
  removeTestFromTracker,
  type QuestionTracker,
} from "@/lib/firestore/questionTracker";
import { generateAssessmentCode, checkAssessmentDeletable } from "@/lib/firestore/assessments";
// tenantCourses sync is now handled inside courses.ts updateTestTargeting / saveTest


export const Route = createFileRoute("/_portal/courses")({
  head: () => ({
    meta: [
      { title: "Courses & Assessments | SEED-IT Admin" },
      { name: "description", content: "Organise assessments into Courses → Series → Tests and assign them to colleges." },
    ],
  }),
  component: CoursesPage,
});

/* ─────────────────────── QuestionTrackerPanel ─────────────────────── */

function TrackerPanel({
  courseId,
  seriesId,
}: {
  courseId: string;
  seriesId: string;
}) {
  const [tracker, setTracker] = useState<QuestionTracker | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await getQuestionTracker(courseId, seriesId);
      setTracker(t);
    } finally {
      setLoading(false);
    }
  }, [courseId, seriesId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const totalMcq = tracker?.mcqIds.length ?? 0;
  const totalCoding = tracker?.codingIds.length ?? 0;
  const hasData = totalMcq > 0 || totalCoding > 0;

  return (
    <div className="mt-3 rounded-xl border border-dashed border-muted-foreground/25 bg-muted/30 p-3">
      <button
        type="button"
        className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-1.5">
          <BookOpenCheck className="size-3.5" />
          Question Usage Tracker
          {hasData && (
            <span className="ml-1 text-[10px]">
              · {totalMcq} MCQ · {totalCoding} Coding
            </span>
          )}
        </span>
        <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {loading ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : !hasData ? (
            <p className="text-center text-xs text-muted-foreground py-4">
              No questions tracked yet. Questions are auto-tracked when you save a test with a linked assessment.
            </p>
          ) : (
            <>
              {totalMcq > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    MCQ Bank IDs used ({totalMcq})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {tracker!.mcqIds.map((id) => (
                      <code
                        key={id}
                        title={id}
                        className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground"
                      >
                        {id}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {totalCoding > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Coding Challenge IDs used ({totalCoding})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {tracker!.codingIds.map((id) => (
                      <code
                        key={id}
                        title={id}
                        className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground"
                      >
                        {id}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Per-test breakdown
                </p>
                <div className="space-y-1">
                  {Object.entries({ ...tracker!.mcqByTest, ...tracker!.codingByTest }).map(([testId, ids]) => (
                    <div key={testId} className="flex items-start gap-2 text-xs">
                      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{testId}</code>
                      <span className="text-muted-foreground">{ids.length} question(s)</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={() => void load()}
              >
                ↻ Refresh
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── helpers ─────────────────────────────── */


const TYPE_ICON: Record<TestType, typeof ClipboardList> = {
  mcq: ClipboardList,
  coding: Code2,
  msa: Layers,
  sea: Mic,
};

const TYPE_LABEL: Record<TestType, string> = {
  mcq: "MCQ",
  coding: "Coding",
  msa: "MSA",
  sea: "SEA",
};

const TYPE_COLOR: Record<TestType, string> = {
  mcq: "bg-blue-500/10 text-blue-600 border-blue-200 dark:text-blue-400",
  coding: "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:text-emerald-400",
  msa: "bg-violet-500/10 text-violet-600 border-violet-200 dark:text-violet-400",
  sea: "bg-amber-500/10 text-amber-600 border-amber-200 dark:text-amber-400",
};

function TypeBadge({ type }: { type: TestType }) {
  const Icon = TYPE_ICON[type];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TYPE_COLOR[type]}`}>
      <Icon className="size-2.5" />
      {TYPE_LABEL[type]}
    </span>
  );
}

function newSectionId(testId: string, idx: number) {
  return `${testId}_S${String(idx + 1).padStart(2, "0")}`;
}

function blankSection(testId: string, idx: number): MSASection {
  return {
    sectionId: newSectionId(testId, idx),
    name: "",
    type: "mcq",
    cdnUrl: "",
    duration_minutes: 30,
    questionTimer: 0,
    questionTimerList: "",
    timerRestrictedSubmit: false,
    forwardOnly: false,
    order: idx + 1,
  };
}

function blankTest(seriesId: string, order: number): TestDoc {
  return {
    id: "",
    name: "",
    description: "",
    type: "mcq",
    cdnUrl: "",
    assessmentId: "",
    assessmentTitle: "",
    assessmentVersion: 1,
    sections: [],
    duration_minutes: 60,
    totalMarks: 100,
    difficulty: "Medium",
    proctored: false,
    audioProctored: false,
    maxViolations: 5,
    maxAudioViolations: 3,
    maxAttempts: 1,
    passkey: "",
    isPremium: false,
    guestEnabled: false,
    assessmentCode: "",
    display_order: order,
    schedule: { ...DEFAULT_SCHEDULE },
    settings: {
      shuffleQuestions: false,
      shuffleOptions: false,
      allowLanguageSwitch: true,
      showResultAfterSubmit: true,
      allowedLanguages: ["C", "C++", "Java", "Python3"],
    },
    targeting: { ...DEFAULT_TARGETING },
  };
  void seriesId;
}

/* ─────────────────────── page ────────────────────────────────── */

function CoursesPage() {
  const qc = useQueryClient();
  const { isAdmin, scopedTenantId } = useAuth();

  /* ── selection state ── */
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  /* ── course dialog ── */
  const [courseDialog, setCourseDialog] = useState(false);
  const [courseForm, setCourseForm] = useState<CourseDoc>({ id: "", title: "", description: "", display_order: 1, active: true });
  const [courseIsNew, setCourseIsNew] = useState(true);

  /* ── series dialog ── */
  const [seriesDialog, setSeriesDialog] = useState(false);
  const [seriesForm, setSeriesForm] = useState<SeriesDoc>({ id: "", title: "", description: "", type: "WEEKLY", display_order: 1 });
  const [seriesIsNew, setSeriesIsNew] = useState(true);

  /* ── test dialog ── */
  const [testDialog, setTestDialog] = useState(false);
  const [testForm, setTestForm] = useState<TestDoc>(blankTest("", 1));
  const [testIsNew, setTestIsNew] = useState(true);
  const [testSeriesId, setTestSeriesId] = useState("");

  /* ── assign-to-college dialog ── */
  const [assignDialog, setAssignDialog] = useState(false);
  const [assignTest, setAssignTest] = useState<TestDoc | null>(null);
  const [assignCourseId, setAssignCourseId] = useState("");
  const [assignSeriesId, setAssignSeriesId] = useState("");
  const [assignTargeting, setAssignTargeting] = useState<AssessmentTargeting>({ ...DEFAULT_TARGETING });

  /* ── json preview ── */
  const [previewJson, setPreviewJson] = useState<string | null>(null);

  /* ── queries ── */
  const coursesQ = useQuery({ queryKey: ["courses"], queryFn: listCourses });
  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const contentUrlsQ = useQuery({ queryKey: ["contentUrls"], queryFn: () => listContentUrls() });

  const contentByType = useMemo(() => {
    const all = contentUrlsQ.data ?? [];
    return {
      mcq: all.filter((c) => c.type === "mcq"),
      coding: all.filter((c) => c.type === "coding"),
      sea: all.filter((c) => c.type === "sea"),
    };
  }, [contentUrlsQ.data]);

  const seriesQ = useQuery({
    queryKey: ["series", selectedCourseId],
    queryFn: () => listSeries(selectedCourseId!),
    enabled: Boolean(selectedCourseId),
  });

  // Load tests for all expanded series
  const testsQueries = useMemo(() => {
    if (!selectedCourseId) return {};
    return Object.fromEntries(
      Array.from(expandedSeries).map((sId) => [sId, { courseId: selectedCourseId, seriesId: sId }]),
    );
  }, [selectedCourseId, expandedSeries]);

  const [testsBySeriesId, setTestsBySeriesId] = useState<Record<string, TestDoc[]>>({});

  // Fetch tests whenever expandedSeries changes
  useMemo(() => {
    Object.values(testsQueries).forEach(async ({ courseId, seriesId }) => {
      const tests = await listTests(courseId, seriesId);
      setTestsBySeriesId((prev) => ({ ...prev, [seriesId]: tests }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(testsQueries)]);

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  /* ─── course mutations ─── */
  const saveCourseMut = useMutation({
    mutationFn: () => saveCourse(courseForm, courseIsNew),
    onSuccess: () => { toast.success("Course saved"); setCourseDialog(false); void qc.invalidateQueries({ queryKey: ["courses"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const deleteCourseMut = useMutation({
    mutationFn: (id: string) => deleteCourse(id),
    onSuccess: () => { toast.success("Course deleted"); setSelectedCourseId(null); void qc.invalidateQueries({ queryKey: ["courses"] }); },
    onError: () => toast.error("Delete failed"),
  });

  /* ─── series mutations ─── */
  const saveSeriesMut = useMutation({
    mutationFn: () => saveSeries(selectedCourseId!, seriesForm, seriesIsNew),
    onSuccess: () => { toast.success("Series saved"); setSeriesDialog(false); void qc.invalidateQueries({ queryKey: ["series", selectedCourseId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const deleteSeriesMut = useMutation({
    mutationFn: (id: string) => deleteSeries(selectedCourseId!, id),
    onSuccess: (_, id) => {
      toast.success("Series deleted");
      setExpandedSeries((prev) => { const s = new Set(prev); s.delete(id); return s; });
      void qc.invalidateQueries({ queryKey: ["series", selectedCourseId] });
    },
    onError: () => toast.error("Delete failed"),
  });

  /* ─── test mutations ─── */
  const saveTestMut = useMutation({
    mutationFn: () => saveTest(selectedCourseId!, testSeriesId, testForm, testIsNew),
    onSuccess: async (savedTestId) => {
      toast.success("Test saved");
      setTestDialog(false);
      const tests = await listTests(selectedCourseId!, testSeriesId);
      setTestsBySeriesId((prev) => ({ ...prev, [testSeriesId]: tests }));

      // ── Update question usage tracker ─────────────────────────────────────
      // If the test has a linked assessmentId, fetch that assessment's questions
      // and record them in the series tracker so duplicate questions show up.
      try {
        const testId = savedTestId ?? testForm.id;
        if (!testId || !selectedCourseId || !testSeriesId) return;

        let mcqIds: string[] = [];
        let codingIds: string[] = [];

        if (testForm.assessmentId) {
          const { getAssessment } = await import("@/lib/firestore/assessments");
          const assessment = await getAssessment(testForm.assessmentId);
          if (assessment) {
            if (assessment.type === "mcq" || assessment.type === "multisection") {
              mcqIds = (assessment.questions ?? []).map((q: { id: string }) => q.id).filter(Boolean);
            } else if (assessment.type === "coding") {
              codingIds = (assessment.challenges ?? []).map((c: { id?: string }) => c.id ?? "").filter(Boolean);
            }
          }
        }

        await recordTestQuestionIds(
          selectedCourseId,
          testSeriesId,
          testId,
          mcqIds,
          codingIds,
        );

        // Refresh the cached tracker for this series
        void qc.invalidateQueries({ queryKey: ["tracker", selectedCourseId, testSeriesId] });
      } catch (trackerErr) {
        console.warn("Could not update question tracker:", trackerErr);
      }
      // tenantCourses sync is handled inside saveTest() in courses.ts
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const deleteTestMut = useMutation({
    mutationFn: async ({ sId, tId }: { sId: string; tId: string }) => {
      // Safety check: block deletion if assessment has result documents
      // We use the test's assessmentId to check results
      const allTests = testsBySeriesId[sId] ?? [];
      const test = allTests.find((t) => t.id === tId);
      if (test?.assessmentId) {
        const { safe, resultCount } = await checkAssessmentDeletable(test.assessmentId);
        if (!safe) {
          const confirmed = confirm(
            `⚠ Warning: Assessment "${test.assessmentTitle || test.assessmentId}" has ${resultCount} student result(s).\n\n` +
            `Deleting this test will not remove the results, but may make them harder to trace.\n\n` +
            `To preserve full data integrity, consider archiving instead.\n\n` +
            `Proceed with delete anyway?`
          );
          if (!confirmed) throw new Error("Deletion cancelled by admin.");
        }
      }
      return deleteTest(selectedCourseId!, sId, tId);
    },
    onSuccess: async (_, { sId, tId }) => {
      toast.success("Test deleted");
      const tests = await listTests(selectedCourseId!, sId);
      setTestsBySeriesId((prev) => ({ ...prev, [sId]: tests }));
      // Remove this test's questions from the tracker
      try {
        if (selectedCourseId) {
          await removeTestFromTracker(selectedCourseId, sId, tId);
          void qc.invalidateQueries({ queryKey: ["tracker", selectedCourseId, sId] });
        }
      } catch { /* silent */ }
      // tenantCourses cleanup handled inside deleteTest() in courses.ts
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  /* ─── targeting mutation ─── */
  const assignTargetingMut = useMutation({
    mutationFn: () => updateTestTargeting(assignCourseId, assignSeriesId, assignTest!.id, assignTargeting),
    onSuccess: async () => {
      toast.success("College assignment updated");
      setAssignDialog(false);
      const tests = await listTests(assignCourseId, assignSeriesId);
      setTestsBySeriesId((prev) => ({ ...prev, [assignSeriesId]: tests }));
    },
    onError: () => toast.error("Update failed"),
  });

  /* ─── openers ─── */
  function openNewCourse() {
    setCourseForm({ id: "", title: "", description: "", display_order: (coursesQ.data?.length ?? 0) + 1, active: true });
    setCourseIsNew(true);
    setCourseDialog(true);
  }
  function openEditCourse(c: CourseDoc) {
    setCourseForm({ ...c });
    setCourseIsNew(false);
    setCourseDialog(true);
  }
  function openNewSeries() {
    setSeriesForm({ id: "", title: "", description: "", type: "WEEKLY", display_order: (seriesQ.data?.length ?? 0) + 1 });
    setSeriesIsNew(true);
    setSeriesDialog(true);
  }
  function openEditSeries(s: SeriesDoc) {
    setSeriesForm({ ...s });
    setSeriesIsNew(false);
    setSeriesDialog(true);
  }
  function openNewTest(sId: string) {
    const order = (testsBySeriesId[sId]?.length ?? 0) + 1;
    setTestForm(blankTest(sId, order));
    setTestIsNew(true);
    setTestSeriesId(sId);
    setTestDialog(true);
  }
  function openEditTest(sId: string, t: TestDoc) {
    setTestForm({ ...t, sections: t.sections ? [...t.sections] : [] });
    setTestIsNew(false);
    setTestSeriesId(sId);
    setTestDialog(true);
  }
  function openAssign(cId: string, sId: string, t: TestDoc) {
    setAssignTest(t);
    setAssignCourseId(cId);
    setAssignSeriesId(sId);
    setAssignTargeting({ ...t.targeting });
    setAssignDialog(true);
  }

  /* ─── MSA section helpers ─── */
  function addSection() {
    const idx = testForm.sections.length;
    setTestForm((prev) => ({ ...prev, sections: [...prev.sections, blankSection(prev.id || "test", idx)] }));
  }
  function updateSection(idx: number, patch: Partial<MSASection>) {
    setTestForm((prev) => ({ ...prev, sections: prev.sections.map((s, i) => i === idx ? { ...s, ...patch } : s) }));
  }
  function removeSection(idx: number) {
    setTestForm((prev) => ({ ...prev, sections: prev.sections.filter((_, i) => i !== idx) }));
  }
  function moveSection(idx: number, dir: -1 | 1) {
    setTestForm((prev) => {
      const s = [...prev.sections];
      const target = idx + dir;
      if (target < 0 || target >= s.length) return prev;
      const [item] = s.splice(idx, 1);
      s.splice(target, 0, item!);
      return { ...prev, sections: s.map((sec, i) => ({ ...sec, order: i + 1 })) };
    });
  }

  const msaDuration = testForm.sections.reduce((s, sec) => s + (Number(sec.duration_minutes) || 0), 0);
  const msaMarks = testForm.sections.reduce((s, sec) => s + (Number(sec.totalMarks) || 0), 0);

  /* ─── toggle series expand ─── */
  function toggleSeries(sId: string) {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(sId)) {
        next.delete(sId);
      } else {
        next.add(sId);
        // load tests
        listTests(selectedCourseId!, sId).then((tests) =>
          setTestsBySeriesId((p) => ({ ...p, [sId]: tests })),
        );
      }
      return next;
    });
  }

  /* ─── validation ─── */
  const testErrors = useMemo(() => {
    const errs: string[] = [];
    if (!testForm.name.trim()) errs.push("Name is required");
    if (testForm.type !== "msa" && !testForm.cdnUrl) errs.push("CDN URL is required (paste the seed-contents link)");
    if (testForm.type === "msa") {
      if (testForm.sections.length === 0) errs.push("MSA requires at least one section");
      testForm.sections.forEach((s, i) => {
        if (!s.name.trim()) errs.push(`Section ${i + 1}: name required`);
        if (!s.cdnUrl) errs.push(`Section ${i + 1}: CDN URL required`);
      });
    }
    return errs;
  }, [testForm]);

  /* ───────────────────────── render ──────────────────────────── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Courses & Assessments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organise assessments into Course → Series → Test, then assign each test to specific colleges.
          </p>
        </div>
        {isAdmin && (
          <Button className="rounded-xl" onClick={openNewCourse}>
            <Plus className="size-4" /> New Course
          </Button>
        )}
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">

        {/* ── LEFT: Course list ── */}
        <Card className="rounded-2xl h-fit">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-semibold">Courses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {coursesQ.isLoading ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)
            ) : (coursesQ.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No courses yet.</p>
            ) : (
              (coursesQ.data ?? []).map((course) => (
                <div
                  key={course.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setSelectedCourseId(course.id); setSelectedSeriesId(null); setExpandedSeries(new Set()); setTestsBySeriesId({}); }}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedCourseId(course.id)}
                  className={`group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 transition-colors ${
                    selectedCourseId === course.id ? "bg-primary/10 text-primary" : "hover:bg-muted/60"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{course.title}</p>
                      {!course.active && <Badge variant="outline" className="rounded-full text-[9px]">inactive</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="size-7 rounded-lg"
                      onClick={(e) => { e.stopPropagation(); openEditCourse(course); }}>
                      <Pencil className="size-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-7 rounded-lg text-destructive"
                      onClick={(e) => { e.stopPropagation(); if (confirm(`Delete course "${course.title}"?`)) deleteCourseMut.mutate(course.id); }}>
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* ── RIGHT: Series + Tests ── */}
        <div className="space-y-4">
          {!selectedCourseId ? (
            <Card className="rounded-2xl">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <BookOpenCheck className="size-10 mb-3 opacity-30" />
                <p className="text-sm">Select a course to view its series and tests.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Series header */}
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  {(coursesQ.data ?? []).find((c) => c.id === selectedCourseId)?.title ?? selectedCourseId}
                </h2>
                <Button size="sm" className="rounded-xl" onClick={openNewSeries}>
                  <Plus className="size-3.5" /> New Series
                </Button>
              </div>

              {seriesQ.isLoading ? (
                [0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)
              ) : (seriesQ.data ?? []).length === 0 ? (
                <Card className="rounded-2xl">
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No series yet. Create a series to group tests.
                  </CardContent>
                </Card>
              ) : (
                (seriesQ.data ?? []).map((series) => {
                  const isExpanded = expandedSeries.has(series.id);
                  const tests = testsBySeriesId[series.id] ?? [];
                  return (
                    <Card key={series.id} className="rounded-2xl overflow-hidden">
                      {/* Series header row */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleSeries(series.id)}
                        onKeyDown={(e) => e.key === "Enter" && toggleSeries(series.id)}
                        className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <ChevronRight className={`size-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          <div>
                            <p className="text-sm font-semibold">{series.title}</p>
                            <p className="text-xs text-muted-foreground">{series.type} · {tests.length} test(s)</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button size="sm" variant="outline" className="rounded-xl h-7 text-xs"
                            onClick={(e) => { e.stopPropagation(); openNewTest(series.id); }}>
                            <Plus className="size-3" /> Add Test
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7 rounded-lg"
                            onClick={(e) => { e.stopPropagation(); openEditSeries(series); }}>
                            <Pencil className="size-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7 rounded-lg text-destructive"
                            onClick={(e) => { e.stopPropagation(); if (confirm(`Delete series "${series.title}" and all its tests?`)) deleteSeriesMut.mutate(series.id); }}>
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Tests list */}
                      {isExpanded && (
                        <CardContent className="space-y-2 pt-0 pb-3">
                          <Separator className="mb-3" />
                          {tests.length === 0 ? (
                            <p className="py-4 text-center text-sm text-muted-foreground">No tests. Click "Add Test" above.</p>
                          ) : (
                            tests.map((test) => {
                              const assignedCount = test.targeting?.tenantIds?.length ?? 0;
                              return (
                                <div key={test.id} className="surface-card flex flex-wrap items-center justify-between gap-2 p-3">
                                  <div className="flex min-w-0 items-center gap-3">
                                    <TypeBadge type={test.type} />
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">{test.name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {test.duration_minutes} min · {test.totalMarks} marks · {test.difficulty}
                                        {test.passkey && " · 🔐"}
                                        {test.isPremium && " · ⭐"}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 flex-wrap gap-1.5 items-center">
                                    {/* College assignment badge */}
                                    <button
                                      type="button"
                                      onClick={() => openAssign(selectedCourseId!, series.id, test)}
                                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-primary/10 ${
                                        assignedCount > 0 ? "border-primary/40 text-primary" : "border-border text-muted-foreground"
                                      }`}
                                    >
                                      <Building2 className="size-2.5" />
                                      {assignedCount > 0 ? `${assignedCount} college(s)` : "Assign colleges"}
                                    </button>
                                    <Button size="icon" variant="ghost" className="size-7 rounded-lg"
                                      aria-label="View JSON"
                                      onClick={() => setPreviewJson(JSON.stringify(testToAccessControlJson(test), null, 2))}>
                                      <Eye className="size-3" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="size-7 rounded-lg"
                                      aria-label="Edit test"
                                      onClick={() => openEditTest(series.id, test)}>
                                      <Pencil className="size-3" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="size-7 rounded-lg text-destructive"
                                      aria-label="Delete test"
                                      onClick={() => { if (confirm(`Delete "${test.name}"?`)) deleteTestMut.mutate({ sId: series.id, tId: test.id }); }}>
                                      <Trash2 className="size-3" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                          {/* Question usage tracker (collapsible) */}
                          {selectedCourseId && (
                            <TrackerPanel courseId={selectedCourseId} seriesId={series.id} />
                          )}
                        </CardContent>
                      )}
                    </Card>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>

      {/* ════════════ COURSE DIALOG ════════════ */}
      <Dialog open={courseDialog} onOpenChange={(o) => !o && setCourseDialog(false)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{courseIsNew ? "New Course" : "Edit Course"}</DialogTitle>
            <DialogDescription>Courses are top-level groupings like "DSA" or "MCQ Bank".</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="course-title">Title</Label>
              <Input id="course-title" className="rounded-xl" placeholder="Data Structures & Algorithms"
                value={courseForm.title}
                onChange={(e) => setCourseForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-desc">Description</Label>
              <Textarea id="course-desc" className="rounded-xl" rows={2}
                value={courseForm.description}
                onChange={(e) => setCourseForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="course-order">Display order</Label>
                <Input id="course-order" type="number" min={1} className="rounded-xl"
                  value={courseForm.display_order}
                  onChange={(e) => setCourseForm((p) => ({ ...p, display_order: Number(e.target.value) || 1 }))} />
              </div>
              <div className="flex items-center justify-between rounded-xl border p-3">
                <Label htmlFor="course-active" className="text-sm">Active</Label>
                <Switch id="course-active" checked={courseForm.active}
                  onCheckedChange={(v) => setCourseForm((p) => ({ ...p, active: v }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setCourseDialog(false)}>Cancel</Button>
            <Button className="rounded-xl" disabled={!courseForm.title.trim() || saveCourseMut.isPending}
              onClick={() => saveCourseMut.mutate()}>
              {saveCourseMut.isPending && <Loader2 className="size-4 animate-spin" />}
              Save course
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════ SERIES DIALOG ════════════ */}
      <Dialog open={seriesDialog} onOpenChange={(o) => !o && setSeriesDialog(false)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{seriesIsNew ? "New Series" : "Edit Series"}</DialogTitle>
            <DialogDescription>A series groups related tests, e.g. "Week 1" or "Mock Test Set A".</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="series-title">Title</Label>
              <Input id="series-title" className="rounded-xl" placeholder="Week 1 — Arrays"
                value={seriesForm.title}
                onChange={(e) => setSeriesForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="series-desc">Description</Label>
              <Textarea id="series-desc" className="rounded-xl" rows={2}
                value={seriesForm.description}
                onChange={(e) => setSeriesForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="series-type">Type</Label>
                <Select value={seriesForm.type}
                  onValueChange={(v) => setSeriesForm((p) => ({ ...p, type: v as SeriesDoc["type"] }))}>
                  <SelectTrigger id="series-type" className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SERIES_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="series-order">Order</Label>
                <Input id="series-order" type="number" min={1} className="rounded-xl"
                  value={seriesForm.display_order}
                  onChange={(e) => setSeriesForm((p) => ({ ...p, display_order: Number(e.target.value) || 1 }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setSeriesDialog(false)}>Cancel</Button>
            <Button className="rounded-xl" disabled={!seriesForm.title.trim() || saveSeriesMut.isPending}
              onClick={() => saveSeriesMut.mutate()}>
              {saveSeriesMut.isPending && <Loader2 className="size-4 animate-spin" />}
              Save series
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════ TEST DIALOG ════════════ */}
      <Dialog open={testDialog} onOpenChange={(o) => !o && setTestDialog(false)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{testIsNew ? "Add Test" : "Edit Test"}</DialogTitle>
            <DialogDescription>
              Link an assessment to this test slot. For MSA, compose multiple sections.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="content" className="w-full">
            <TabsList className="rounded-xl w-full">
              <TabsTrigger value="content" className="flex-1">Content</TabsTrigger>
              <TabsTrigger value="settings" className="flex-1">Settings</TabsTrigger>
              <TabsTrigger value="schedule" className="flex-1">Schedule</TabsTrigger>
              <TabsTrigger value="targeting" className="flex-1">Colleges</TabsTrigger>
            </TabsList>

            {/* ── CONTENT TAB ── */}
            <TabsContent value="content" className="space-y-4 pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="test-name">Test Name</Label>
                  <Input id="test-name" className="rounded-xl" placeholder="Unit Test 1 — Arrays"
                    value={testForm.name}
                    onChange={(e) => setTestForm((p) => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="test-type">Assessment Type</Label>
                  <Select value={testForm.type}
                    onValueChange={(v) => setTestForm((p) => ({ ...p, type: v as TestType, assessmentId: "", sections: [] }))}>
                    <SelectTrigger id="test-type" className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mcq">MCQ</SelectItem>
                      <SelectItem value="coding">Coding</SelectItem>
                      <SelectItem value="msa">MSA — Multi-Section</SelectItem>
                      <SelectItem value="sea">SEA — Spoken English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="test-desc">Description</Label>
                <Textarea id="test-desc" className="rounded-xl" rows={2}
                  value={testForm.description}
                  onChange={(e) => setTestForm((p) => ({ ...p, description: e.target.value }))} />
              </div>

              {/* ── Non-MSA: CDN URL picker (dropdown from registry + manual paste) ── */}
              {testForm.type !== "msa" && (() => {
                const options: ContentUrlDoc[] = contentByType[testForm.type as "mcq" | "coding" | "sea"] ?? [];
                // Find if the currently selected cdnUrl matches a registry entry
                const selectedEntry = options.find((o) => o.id === testForm.assessmentId || o.cdnUrl === testForm.cdnUrl);
                const isDraftLinked = testForm.assessmentId && !testForm.cdnUrl;

                return (
                  <div className="space-y-3">
                    {/* Assessment link status */}
                    {testForm.assessmentId && selectedEntry && (
                      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
                        <span className="font-medium">✓ Linked:</span> {selectedEntry.title}
                        <span className="text-emerald-600/60">· {selectedEntry.totalMarks} marks · {selectedEntry.durationMinutes} min · v{testForm.assessmentVersion ?? 1}</span>
                      </div>
                    )}
                    {testForm.assessmentId && !selectedEntry && (
                      <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                        <AlertTriangle className="size-3 shrink-0" />
                        Linked assessment <code className="font-mono">{testForm.assessmentId}</code> is not in the published registry. It may be a draft or deleted.
                      </div>
                    )}
                    {void isDraftLinked}
                    <div className="space-y-1.5">
                      <Label htmlFor="test-cdn-select">
                        {TYPE_LABEL[testForm.type]} Assessment
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          — select from published assessments
                        </span>
                      </Label>
                      <Select
                        value={selectedEntry?.id ?? ""}
                        onValueChange={(v) => {
                          const found = options.find((o) => o.id === v);
                          if (found) {
                            // Auto-populate from assessment — assessment is source of truth
                            setTestForm((p) => ({
                              ...p,
                              cdnUrl: found.cdnUrl,
                              assessmentId: found.id,
                              assessmentTitle: found.title,
                              duration_minutes: found.durationMinutes,
                              totalMarks: found.totalMarks,
                              type: found.type as TestType,
                            }));
                          }
                        }}
                      >
                        <SelectTrigger id="test-cdn-select" className="rounded-xl">
                          <SelectValue placeholder={
                            contentUrlsQ.isLoading
                              ? "Loading saved assessments…"
                              : options.length === 0
                                ? "No saved assessments yet — create one in MCQ/Coding/SEA Creator"
                                : "Select a published assessment…"
                          } />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              <span className="font-medium">{o.title}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                · {o.totalMarks} marks · {o.durationMinutes} min
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="test-cdn-url" className="text-xs text-muted-foreground">
                        Or paste the test JSON URL manually (overrides selection above)
                      </Label>
                      <Input
                        id="test-cdn-url"
                        className="rounded-xl font-mono text-xs"
                        placeholder={`https://raw.githubusercontent.com/seeditDev/seed-contents/main/${testForm.type === "mcq" ? "mcq" : testForm.type === "sea" ? "spoken_english" : "coding"}/testbank/your-test.json`}
                        value={testForm.cdnUrl}
                        onChange={(e) => setTestForm((p) => ({ ...p, cdnUrl: e.target.value.trim() }))}
                      />
                      {testForm.cdnUrl && (
                        <a href={testForm.cdnUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-primary underline underline-offset-2">
                          ↗ Verify JSON URL
                        </a>
                      )}
                    </div>
                  </div>
                );
              })()}


              {/* ── MSA: section builder ── */}
              {testForm.type === "msa" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Sections <span className="text-muted-foreground font-normal">({testForm.sections.length})</span></Label>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Total: {msaDuration} min</span>
                      <Button size="sm" variant="outline" className="rounded-xl h-7" onClick={addSection}>
                        <Plus className="size-3" /> Add Section
                      </Button>
                    </div>
                  </div>
                  {testForm.sections.length === 0 ? (
                    <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                      Click "Add Section" to build an MSA.
                    </p>
                  ) : (
                    testForm.sections.map((sec, idx) => (
                      <div key={sec.sectionId} className="rounded-xl border p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground">Section {idx + 1}</span>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="size-7 rounded-lg"
                              disabled={idx === 0} onClick={() => moveSection(idx, -1)}>
                              <ArrowUp className="size-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7 rounded-lg"
                              disabled={idx === testForm.sections.length - 1} onClick={() => moveSection(idx, 1)}>
                              <ArrowDown className="size-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7 rounded-lg text-destructive"
                              onClick={() => removeSection(idx)}>
                              <X className="size-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label className="text-xs" htmlFor={`sec-name-${idx}`}>Section Name</Label>
                            <Input id={`sec-name-${idx}`} className="rounded-xl h-8 text-sm"
                              placeholder="MCQ Section"
                              value={sec.name}
                              onChange={(e) => updateSection(idx, { name: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs" htmlFor={`sec-type-${idx}`}>Type</Label>
                            <Select value={sec.type}
                              onValueChange={(v) => updateSection(idx, { type: v as MSASection["type"], assessmentId: "" })}>
                              <SelectTrigger id={`sec-type-${idx}`} className="rounded-xl h-8 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="mcq">MCQ</SelectItem>
                                <SelectItem value="coding">Coding</SelectItem>
                                <SelectItem value="sea">SEA</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs" htmlFor={`sec-cdn-${idx}`}>
                            Test JSON URL
                            <span className="ml-1 text-muted-foreground font-normal">— select a saved {sec.type.toUpperCase()} assessment</span>
                          </Label>
                          {(() => {
                            const opts = contentByType[sec.type as "mcq" | "coding" | "sea"] ?? [];
                            return (
                              <Select
                                value={opts.find((o) => o.cdnUrl === sec.cdnUrl)?.id ?? ""}
                                onValueChange={(v) => {
                                  const found = opts.find((o) => o.id === v);
                                  if (found) updateSection(idx, {
                                    cdnUrl: found.cdnUrl,
                                    assessmentId: found.id,
                                    // Auto-capture marks and duration from the linked assessment
                                    totalMarks: found.totalMarks ?? 0,
                                    duration_minutes: found.durationMinutes ?? sec.duration_minutes,
                                  });
                                }}
                              >
                                <SelectTrigger id={`sec-cdn-${idx}`} className="rounded-xl h-8 text-sm">
                                  <SelectValue placeholder={
                                    contentUrlsQ.isLoading
                                      ? "Loading…"
                                      : opts.length === 0
                                        ? `No saved ${sec.type.toUpperCase()} assessments yet`
                                        : "Select a saved assessment…"
                                  } />
                                </SelectTrigger>
                                <SelectContent>
                                  {opts.map((o) => (
                                    <SelectItem key={o.id} value={o.id}>
                                      <span className="font-medium">{o.title}</span>
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        · {o.totalMarks} marks · {o.durationMinutes} min
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            );
                          })()}
                          {/* Fallback: allow manual paste if needed */}
                          {sec.cdnUrl && !(contentByType[sec.type as "mcq" | "coding" | "sea"] ?? []).some((o) => o.cdnUrl === sec.cdnUrl) && (
                            <Input
                              className="rounded-xl h-7 text-xs font-mono mt-1"
                              placeholder="or paste CDN URL…"
                              value={sec.cdnUrl}
                              onChange={(e) => updateSection(idx, { cdnUrl: e.target.value.trim() })}
                            />
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs" htmlFor={`sec-dur-${idx}`}>Duration (min)</Label>
                            <Input id={`sec-dur-${idx}`} type="number" min={1} className="rounded-xl h-8 text-sm"
                              value={sec.duration_minutes}
                              onChange={(e) => updateSection(idx, { duration_minutes: Number(e.target.value) || 30 })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs" htmlFor={`sec-timer-${idx}`}>Q. Timer (sec, 0=off)</Label>
                            <Input id={`sec-timer-${idx}`} type="number" min={0} className="rounded-xl h-8 text-sm"
                              value={sec.questionTimer}
                              onChange={(e) => updateSection(idx, { questionTimer: Number(e.target.value) || 0 })} />
                          </div>
                        </div>
                        {sec.type === "coding" && (
                          <div className="space-y-1">
                            <Label className="text-xs" htmlFor={`sec-timer-list-${idx}`}>Custom timers per challenge (secs, comma-separated)</Label>
                            <Input id={`sec-timer-list-${idx}`} className="rounded-xl h-8 text-xs font-mono"
                              placeholder="e.g. 600, 900, 1200"
                              value={sec.questionTimerList ?? ""}
                              onChange={(e) => updateSection(idx, { questionTimerList: e.target.value })} />
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3 pt-1">
                          <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                            <Switch
                              checked={!!sec.timerRestrictedSubmit}
                              onCheckedChange={(v) => updateSection(idx, { timerRestrictedSubmit: v })}
                              className="scale-75" />
                            <span className="font-medium">Auto-Submit Only</span>
                            <span className="text-muted-foreground">(timer forces submit, no manual exit)</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                            <Switch
                              checked={!!sec.forwardOnly}
                              onCheckedChange={(v) => updateSection(idx, { forwardOnly: v })}
                              className="scale-75" />
                            <span className="font-medium">Forward-Only</span>
                            <span className="text-muted-foreground">(can't go back to previous questions)</span>
                          </label>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── SETTINGS TAB ── */}
            <TabsContent value="settings" className="space-y-5 pt-4">

              {/* Basic timing / marks */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="test-duration">Duration (min)</Label>
                  <Input id="test-duration" type="number" min={1} className="rounded-xl"
                    value={testForm.type === "msa" ? msaDuration : testForm.duration_minutes}
                    disabled={testForm.type === "msa"}
                    onChange={(e) => setTestForm((p) => ({ ...p, duration_minutes: Number(e.target.value) || 60 }))} />
                  {testForm.type === "msa" && <p className="text-xs text-muted-foreground">Auto-computed from sections.</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="test-marks">Total Marks</Label>
                  <Input id="test-marks" type="number" min={0} className="rounded-xl"
                    value={testForm.type === "msa" ? msaMarks : testForm.totalMarks}
                    disabled={testForm.type === "msa"}
                    onChange={(e) => setTestForm((p) => ({ ...p, totalMarks: Number(e.target.value) || 100 }))} />
                  {testForm.type === "msa" && <p className="text-xs text-muted-foreground">Auto-computed from sections.</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="test-difficulty">Difficulty</Label>
                  <Select value={testForm.difficulty}
                    onValueChange={(v) => setTestForm((p) => ({ ...p, difficulty: v as TestDoc["difficulty"] }))}>
                    <SelectTrigger id="test-difficulty" className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Easy", "Medium", "Hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Passkey */}
              <div className="space-y-2">
                <Label htmlFor="test-passkey">Passkey (leave blank for open access)</Label>
                <Input id="test-passkey" className="rounded-xl" placeholder="optional passkey"
                  value={testForm.passkey}
                  onChange={(e) => setTestForm((p) => ({ ...p, passkey: e.target.value }))} />
              </div>

              {/* Guest Access */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Guest Access</p>
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <div>
                    <Label className="text-sm">🔓 Allow guest (non-login) access</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Students select their college on the Guest Portal and see this test automatically.
                      Assign targeting below to control which college(s) this appears for.
                    </p>
                  </div>
                  <Switch checked={testForm.guestEnabled ?? false}
                    onCheckedChange={(v) => {
                      setTestForm((p) => ({ ...p, guestEnabled: v }));
                    }} />
                </div>
                {testForm.guestEnabled && (
                  <div className="rounded-xl border bg-accent/20 px-3 py-2 text-xs text-muted-foreground">
                    ℹ️ Guest-enabled tests are visible on the Guest Portal for colleges listed in the <strong>Targeting</strong> section below.
                    Students find them by selecting their college — no code required.
                    Add a <strong>Passkey</strong> above if you want to restrict access.
                  </div>
                )}
              </div>

              {/* Proctoring */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proctoring</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-xl border p-3">
                    <Label className="text-sm">🎥 Camera proctoring (AI)</Label>
                    <Switch checked={testForm.proctored}
                      onCheckedChange={(v) => setTestForm((p) => ({ ...p, proctored: v }))} />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border p-3">
                    <Label className="text-sm">🔊 Audio proctoring</Label>
                    <Switch checked={testForm.audioProctored}
                      onCheckedChange={(v) => setTestForm((p) => ({ ...p, audioProctored: v }))} />
                  </div>
                  {testForm.proctored && (
                    <div className="space-y-2">
                      <Label htmlFor="test-violations">Max camera violations</Label>
                      <Input id="test-violations" type="number" min={0} className="rounded-xl"
                        value={testForm.maxViolations}
                        onChange={(e) => setTestForm((p) => ({ ...p, maxViolations: Number(e.target.value) || 5 }))} />
                    </div>
                  )}
                  {testForm.audioProctored && (
                    <div className="space-y-2">
                      <Label htmlFor="test-audio-violations">Max audio violations</Label>
                      <Input id="test-audio-violations" type="number" min={0} className="rounded-xl"
                        value={testForm.maxAudioViolations}
                        onChange={(e) => setTestForm((p) => ({ ...p, maxAudioViolations: Number(e.target.value) || 3 }))} />
                    </div>
                  )}
                </div>
              </div>

              {/* Attempt control */}
              <div className="space-y-2">
                <Label htmlFor="test-max-attempts">Max attempts per question</Label>
                <Input id="test-max-attempts" type="number" min={1} className="rounded-xl max-w-48"
                  value={testForm.maxAttempts ?? 1}
                  onChange={(e) => setTestForm((p) => ({ ...p, maxAttempts: Number(e.target.value) || 1 }))} />
                <p className="text-xs text-muted-foreground">Set 1 for strict placement exam rigor (no re-attempts).</p>
              </div>

              {/* Behaviour toggles */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Behaviour</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-xl border p-3">
                    <Label className="text-sm">Shuffle questions</Label>
                    <Switch checked={testForm.settings?.shuffleQuestions ?? false}
                      onCheckedChange={(v) => setTestForm((p) => ({ ...p, settings: { ...p.settings, shuffleQuestions: v } }))} />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border p-3">
                    <Label className="text-sm">Shuffle options (MCQ)</Label>
                    <Switch checked={testForm.settings?.shuffleOptions ?? false}
                      onCheckedChange={(v) => setTestForm((p) => ({ ...p, settings: { ...p.settings, shuffleOptions: v } }))} />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border p-3">
                    <Label className="text-sm">Show result after submit</Label>
                    <Switch checked={testForm.settings?.showResultAfterSubmit ?? true}
                      onCheckedChange={(v) => setTestForm((p) => ({ ...p, settings: { ...p.settings, showResultAfterSubmit: v } }))} />
                  </div>
                  {(testForm.type === "coding" || testForm.type === "msa") && (
                    <div className="flex items-center justify-between rounded-xl border p-3">
                      <Label className="text-sm">Allow language switch (coding)</Label>
                      <Switch checked={testForm.settings?.allowLanguageSwitch ?? true}
                        onCheckedChange={(v) => setTestForm((p) => ({ ...p, settings: { ...p.settings, allowLanguageSwitch: v } }))} />
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-xl border p-3">
                    <Label className="text-sm">⭐ Premium access only</Label>
                    <Switch checked={testForm.isPremium}
                      onCheckedChange={(v) => setTestForm((p) => ({ ...p, isPremium: v }))} />
                  </div>
                </div>
              </div>

              {/* Allowed languages (coding only) */}
              {(testForm.type === "coding" || testForm.type === "msa") && (
                <div className="space-y-2">
                  <Label>Allowed coding languages</Label>
                  <div className="flex flex-wrap gap-2">
                    {["C", "C++", "Java", "Python3", "JavaScript"].map((lang) => {
                      const allowed = testForm.settings?.allowedLanguages ?? ["C", "C++", "Java", "Python3"];
                      const on = allowed.includes(lang);
                      return (
                        <button key={lang} type="button"
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary"}`}
                          onClick={() => setTestForm((p) => {
                            const cur = p.settings?.allowedLanguages ?? ["C", "C++", "Java", "Python3"];
                            return { ...p, settings: { ...p.settings, allowedLanguages: on ? cur.filter((l) => l !== lang) : [...cur, lang] } };
                          })}>
                          {lang}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">Toggle which languages students can use in the coding sandbox.</p>
                </div>
              )}

            </TabsContent>

            {/* ── SCHEDULE TAB ── */}
            <TabsContent value="schedule" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="schedule-type">Schedule Type</Label>
                <Select value={testForm.schedule.type}
                  onValueChange={(v) => setTestForm((p) => ({ ...p, schedule: { ...p.schedule, type: v as ScheduleConfig["type"] } }))}>
                  <SelectTrigger id="schedule-type" className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No schedule (always open)</SelectItem>
                    <SelectItem value="one_time">One-time window</SelectItem>
                    <SelectItem value="daily">Daily recurring</SelectItem>
                    <SelectItem value="weekly">Weekly recurring</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {testForm.schedule.type !== "none" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sched-start-date">Start Date</Label>
                    <Input id="sched-start-date" type="date" className="rounded-xl"
                      value={testForm.schedule.startDate}
                      onChange={(e) => setTestForm((p) => ({ ...p, schedule: { ...p.schedule, startDate: e.target.value } }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sched-start-time">Start Time</Label>
                    <Input id="sched-start-time" type="time" className="rounded-xl"
                      value={testForm.schedule.startTime}
                      onChange={(e) => setTestForm((p) => ({ ...p, schedule: { ...p.schedule, startTime: e.target.value } }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sched-end-date">End Date</Label>
                    <Input id="sched-end-date" type="date" className="rounded-xl"
                      value={testForm.schedule.endDate}
                      onChange={(e) => setTestForm((p) => ({ ...p, schedule: { ...p.schedule, endDate: e.target.value } }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sched-end-time">End Time</Label>
                    <Input id="sched-end-time" type="time" className="rounded-xl"
                      value={testForm.schedule.endTime}
                      onChange={(e) => setTestForm((p) => ({ ...p, schedule: { ...p.schedule, endTime: e.target.value } }))} />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Timezone: Asia/Kolkata (IST)</p>
            </TabsContent>

            {/* ── COLLEGES / TARGETING TAB ── */}
            <TabsContent value="targeting" className="space-y-4 pt-4">
              <p className="text-xs text-muted-foreground">
                Choose which colleges, years and departments can see this test. You can also update this later from the test card.
              </p>
              <TargetingPicker
                targeting={testForm.targeting}
                tenants={tenants}
                onChange={(targeting) => setTestForm((p) => ({ ...p, targeting }))}
              />
            </TabsContent>
          </Tabs>

          {testErrors.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive mt-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <ul className="list-disc pl-3 space-y-0.5">
                {testErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setTestDialog(false)}>Cancel</Button>
            <Button className="rounded-xl" disabled={testErrors.length > 0 || saveTestMut.isPending}
              onClick={() => saveTestMut.mutate()}>
              {saveTestMut.isPending && <Loader2 className="size-4 animate-spin" />}
              Save test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════ ASSIGN COLLEGES DIALOG ════════════ */}
      <Dialog open={assignDialog} onOpenChange={(o) => !o && setAssignDialog(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="size-4" />
              Assign to Colleges — {assignTest?.name}
            </DialogTitle>
            <DialogDescription>
              Select which colleges, years and departments can access this test.
              Saves directly to the test document's targeting field.
            </DialogDescription>
          </DialogHeader>
          <TargetingPicker
            targeting={assignTargeting}
            tenants={tenants}
            onChange={setAssignTargeting}
          />
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setAssignDialog(false)}>Cancel</Button>
            <Button className="rounded-xl" disabled={assignTargetingMut.isPending}
              onClick={() => assignTargetingMut.mutate()}>
              {assignTargetingMut.isPending && <Loader2 className="size-4 animate-spin" />}
              Save assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════ JSON PREVIEW DIALOG ════════════ */}
      <Dialog open={previewJson !== null} onOpenChange={(o) => !o && setPreviewJson(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Test JSON — Firestore document preview</DialogTitle>
            <DialogDescription>This is the exact JSON stored in Firestore, equivalent to the old access_control.json module entry.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <pre className="overflow-x-auto rounded-xl bg-muted p-4 text-xs leading-relaxed">
              {previewJson}
            </pre>
            <Button size="sm" variant="ghost" className="absolute right-2 top-2 rounded-lg h-7 text-xs gap-1"
              onClick={() => { navigator.clipboard.writeText(previewJson ?? ""); toast.success("Copied!"); }}>
              <Copy className="size-3" /> Copy
            </Button>
          </div>
          <DialogFooter>
            <Button className="rounded-xl" onClick={() => setPreviewJson(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
