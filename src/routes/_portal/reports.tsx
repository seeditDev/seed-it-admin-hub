import { useMemo, useState } from "react";
import { generateMarksExcel, generateSectionExcel, generateAssessmentWorkbook } from "@/services/reports/excelReport";
import { generateCsv } from "@/services/reports/csvReport";
import { generateStudentPdf, generateBulkPdf, generateBulkZip } from "@/services/reports/pdfReport";
import { generateAnalysisPdf } from "@/services/reports/analysisReport";
import {
  normalizeResults,
  normalizeReportResult,
  formatDateDisplay,
  formatTime,
  formatHrMinSec,
} from "@/services/reports/reportNormalizer";
import { computeAssessmentGroups } from "@/services/reports/reportAnalytics";
import type { NormalizedResult, NormalizedSection, NormalizedCodingSubmission } from "@/services/reports/reportTypes";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Award,
  BarChart2,
  BookOpen,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  GraduationCap,
  Layers,
  Medal,
  Printer,
  RotateCcw,
  School,
  Search,
  ShieldAlert,
  Table2,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { listResultsByAssessment, fetchAssessmentRawDocs, listAssessmentIdsWithResults, type ResultRow } from "@/lib/firestore/results";
import { listProctorEvents } from "@/lib/firestore/proctoring";
import { listTenants, listCohorts } from "@/lib/firestore/tenants";
import { listAssessments } from "@/lib/firestore/assessments";
import { listCourses } from "@/lib/firestore/courses";
import { ALLOWED_YEARS, DEPARTMENTS, normaliseYear, type ProctorEventRow } from "@/types/seedit";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_portal/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Student Analysis | SEED-IT Admin" },
      { name: "description", content: "Performance, rankings and proctoring violation history." },
      { property: "og:title", content: "Reports & Student Analysis | SEED-IT Admin" },
      { property: "og:description", content: "Performance, rankings and proctoring violation history." },
    ],
  }),
  component: ReportsPage,
});

const nf = new Intl.NumberFormat("en-US");
const pf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const SEVERITY_VARIANT: Record<ProctorEventRow["severity"], "secondary" | "default" | "destructive"> = {
  low: "secondary",
  medium: "default",
  high: "destructive",
};

const PIE_COLORS = ["#22c55e", "#ef4444"];

/* ─────────────────── helpers ─────────────────── */

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex size-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
  color,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Target;
  loading: boolean;
  color?: string;
}) {
  return (
    <Card className="glass-panel rounded-2xl">
      <CardContent className="flex items-start gap-4 p-5">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: color ?? "hsl(var(--primary))" }}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-20 rounded-lg" />
          ) : (
            <p className="font-display mt-1 text-3xl font-bold leading-none">{value}</p>
          )}
          <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function medalBadge(rank: number) {
  if (rank === 1)
    return <Badge className="rounded-full border-transparent bg-yellow-500 text-white"><Medal className="mr-1 size-3" /> 1st</Badge>;
  if (rank === 2)
    return <Badge variant="secondary" className="rounded-full"><Medal className="mr-1 size-3" /> 2nd</Badge>;
  if (rank === 3)
    return <Badge variant="outline" className="rounded-full"><Medal className="mr-1 size-3" /> 3rd</Badge>;
  return <span className="text-sm text-muted-foreground">#{rank}</span>;
}

/** HTML-escape a value before interpolating into document.write HTML. Prevents XSS from student-controlled fields. */
function he(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function printRows(title: string, headers: string[], rows: (string | number)[][]) {
  const win = window.open("", "_blank", "width=1000,height=700");
  if (!win) { toast.error("Pop-up blocked — allow pop-ups to export PDF"); return; }
  const style = `
    body{font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;color:#111}
    h1{font-size:18px;margin-bottom:4px}p.meta{font-size:11px;color:#666;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
    th{background:#f2f2f2;font-weight:600}tr:nth-child(even){background:#fafafa}`;
  const body = `<h1>${he(title)}</h1><p class="meta">Generated: ${new Date().toLocaleString()} &middot; ${rows.length} record(s)</p>
    <table><thead><tr>${headers.map((h) => `<th>${he(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${he(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  win.document.write(`<!doctype html><html><head><title>${he(title)}</title><style>${style}</style></head><body>${body}</body></html>`);
  win.document.close(); win.focus(); win.print();
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v).replace(/"/g, '""'); return /[",\n]/.test(s) ? `"${s}"` : s; };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click(); URL.revokeObjectURL(url);
}

const BUCKETS = ["0–20", "20–40", "40–60", "60–80", "80–100"];

/* ─────────────────── Component ─────────────────── */

function ReportsPage() {
  const { scopedTenantId, role } = useAuth();
  const isStaffRole = role === "staff";

  const [tenantFilter, setTenantFilter] = useState(scopedTenantId || "all");
  const [cohortFilter, setCohortFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "passed" | "failed" | "flagged">("all");
  const [assessmentFilter, setAssessmentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [passThreshold, setPassThreshold] = useState(40);
  const [tab, setTab] = useState("overview");
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  // Filter-first: assessment must be selected before results are pulled
  const [pulledAssessmentId, setPulledAssessmentId] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [pulledRows, setPulledRows] = useState<ResultRow[]>([]);

  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const assessmentsQ = useQuery({ queryKey: ["assessments"], queryFn: listAssessments });
  const coursesQ = useQuery({ queryKey: ["courses"], queryFn: listCourses });

  // Effective tenant for filtering
  const effectiveTenant = scopedTenantId || (tenantFilter !== "all" ? tenantFilter : "");

  // Cohorts query for the selected tenant (/tenants/{tenantId}/cohorts)
  const cohortsQ = useQuery({
    queryKey: ["cohorts", effectiveTenant],
    enabled: !!effectiveTenant,
    queryFn: () => listCohorts(effectiveTenant),
  });

  const availableCohorts = useMemo(() => {
    return cohortsQ.data ?? [];
  }, [cohortsQ.data]);

  const selectedCohort = useMemo(() => {
    if (!cohortFilter || cohortFilter === "all") return null;
    return availableCohorts.find((c) => c.id === cohortFilter || c.year === cohortFilter) ?? null;
  }, [availableCohorts, cohortFilter]);

  // Only load results once a specific assessment is pulled (filter-first architecture)
  const resultsQ = useQuery({
    queryKey: ["results", "reports", effectiveTenant || "all", pulledAssessmentId ?? "none"],
    enabled: !!pulledAssessmentId,
    queryFn: () => listResultsByAssessment(pulledAssessmentId!, effectiveTenant || undefined, 2000),
  });
  const eventsQ = useQuery({ queryKey: ["proctor-events", "reports"], queryFn: () => listProctorEvents(5000) });

  // Assessment options: built from ACTUAL results
  const assessmentOptionsQ = useQuery({
    queryKey: ["assessmentIdsWithResults", effectiveTenant],
    queryFn: () => listAssessmentIdsWithResults(effectiveTenant || undefined),
    staleTime: 60_000,
  });

  const loading = isPulling || resultsQ.isLoading || assessmentOptionsQ.isLoading || tenantsQ.isLoading || cohortsQ.isLoading;

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const tenantNameOf = useMemo(() => new Map(tenants.map((t) => [t.id, t.name] as const)), [tenants]);

  // Resolving allowedModules strictly from /tenants/{tenantId}/cohorts/{cohortId}
  const resolvedAssessmentOptions = useMemo(() => {
    const allAssessments = assessmentsQ.data ?? [];
    const allCourses = coursesQ.data ?? [];
    const resultAssessmentIds = assessmentOptionsQ.data ?? [];

    const map = new Map<string, { id: string; title: string; type: string }>();

    // 1. Gather allowed module keys strictly from the tenant's cohorts (/tenants/{tenantId}/cohorts/{cohortId}/allowedModules)
    let allowedKeys: string[] = [];
    if (selectedCohort) {
      allowedKeys = Array.isArray(selectedCohort.allowedModules) ? selectedCohort.allowedModules : [];
    } else if (availableCohorts.length > 0) {
      const set = new Set<string>();
      for (const c of availableCohorts) {
        if (Array.isArray(c.allowedModules)) {
          c.allowedModules.forEach((k) => k && set.add(k));
        }
      }
      allowedKeys = Array.from(set);
    }

    if (allowedKeys.length > 0) {
      for (const modKey of allowedKeys) {
        if (!modKey) continue;
        const parts = modKey.split("::");
        const testOrAsmId: string = (parts.length === 3 ? parts[2] : modKey) || modKey;
        if (!testOrAsmId) continue;

        // A. Match against assessments collection
        const asm = allAssessments.find((a) => a.id === testOrAsmId || a.id === modKey);
        if (asm) {
          map.set(asm.id, { id: asm.id, title: asm.title, type: asm.type || "mcq" });
          continue;
        }

        // B. Match against courses -> series -> tests
        let foundInCourse = false;
        for (const c of allCourses) {
          for (const s of (c as any).seriesList || []) {
            for (const t of (s as any).tests || []) {
              if (t.id === testOrAsmId || `${c.id}::${s.id}::${t.id}` === modKey) {
                map.set(t.assessmentId || t.id, {
                  id: t.assessmentId || t.id,
                  title: t.title || t.name || testOrAsmId,
                  type: t.type || "mcq",
                });
                foundInCourse = true;
                break;
              }
            }
            if (foundInCourse) break;
          }
          if (foundInCourse) break;
        }
        if (foundInCourse) continue;

        // C. Match against actual results
        const fromResults = resultAssessmentIds.find((r) => r.id === testOrAsmId || r.id === modKey);
        if (fromResults) {
          map.set(fromResults.id, { id: fromResults.id, title: fromResults.title, type: "assessment" });
        } else {
          // Format clean title from slug/ID
          const cleanTitle = testOrAsmId.replace(/[-_]/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
          map.set(testOrAsmId, { id: testOrAsmId, title: cleanTitle, type: "assessment" });
        }
      }
    } else {
      // 2. Fallback: if no cohort allowedModules configured, populate from assessmentResults
      for (const resAsm of resultAssessmentIds) {
        if (!map.has(resAsm.id)) {
          map.set(resAsm.id, { id: resAsm.id, title: resAsm.title, type: "assessment" });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [selectedCohort, availableCohorts, assessmentsQ.data, coursesQ.data, assessmentOptionsQ.data]);

  // Available departments from selected cohort or result rows
  const availableDepartments = useMemo(() => {
    const depts = new Set<string>();
    if (selectedCohort && Array.isArray(selectedCohort.departments)) {
      selectedCohort.departments.forEach((d) => d && depts.add(d));
    }
    const baseRows = pulledRows.length > 0 ? pulledRows : (resultsQ.data ?? []);
    baseRows.forEach((r) => {
      if (r.department) depts.add(r.department);
    });
    if (depts.size === 0) {
      DEPARTMENTS.forEach((d) => depts.add(d));
    }
    return Array.from(depts).sort();
  }, [selectedCohort, pulledRows, resultsQ.data]);

  const filteredResults = useMemo(() => {
    const baseRows = pulledRows.length > 0 ? pulledRows : (resultsQ.data ?? []);
    const q = search.trim().toLowerCase();
    return baseRows.filter((r) => {
      if (effectiveTenant && r.tenantId !== effectiveTenant) return false;
      if (
        cohortFilter !== "all" &&
        normaliseYear(r.year || r.cohortId) !== normaliseYear(cohortFilter) &&
        r.cohortId !== cohortFilter &&
        r.year !== cohortFilter
      )
        return false;
      if (deptFilter !== "all" && r.department !== deptFilter) return false;
      if (statusFilter === "passed" && !r.passed) return false;
      if (statusFilter === "failed" && r.passed) return false;
      if (statusFilter === "flagged" && r.violations === 0) return false;
      if (typeFilter !== "all" && r.type !== typeFilter && r.assessmentType !== typeFilter) return false;
      if (!q) return true;
      return [r.displayName, r.email, r.rollNumber, r.department, r.assessmentTitle]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [resultsQ.data, pulledRows, effectiveTenant, cohortFilter, deptFilter, statusFilter, typeFilter, search]);

  /** Trigger scoped fetch for selected assessment */
  async function pullReports() {
    if (!assessmentFilter || assessmentFilter === "all") {
      toast.error("Please select an assessment first");
      return;
    }
    setIsPulling(true);
    try {
      const rows = await listResultsByAssessment(assessmentFilter, effectiveTenant || undefined, 2000);
      setPulledRows(rows);
      setPulledAssessmentId(assessmentFilter);
      toast.success(`Loaded ${rows.length} result(s) for this assessment`);
    } catch (err) {
      console.error("Pull reports failed", err);
      toast.error("Failed to load results");
    } finally {
      setIsPulling(false);
    }
  }

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (eventsQ.data ?? []).filter((e) => {
      if (effectiveTenant && e.tenantId !== effectiveTenant) return false;
      if (cohortFilter !== "all" && normaliseYear(e.year) !== normaliseYear(cohortFilter)) return false;
      if (deptFilter !== "all" && e.department !== deptFilter) return false;
      if (assessmentFilter !== "all" && e.assessmentId !== assessmentFilter) return false;
      if (!q) return true;
      return [e.displayName, e.email].filter(Boolean).some((f) => String(f).toLowerCase().includes(q));
    });
  }, [eventsQ.data, effectiveTenant, cohortFilter, deptFilter, assessmentFilter, search]);

  /* ── KPIs ── */
  const kpis = useMemo(() => {
    const rows = filteredResults;
    const attempts = rows.length;
    const avg = attempts ? rows.reduce((s, r) => s + r.percentage, 0) / attempts : 0;
    const passed = rows.filter((r) => r.percentage >= passThreshold).length;
    const passRate = attempts ? (passed / attempts) * 100 : 0;
    const highest = attempts ? Math.max(...rows.map((r) => r.percentage)) : 0;
    const lowest = attempts ? Math.min(...rows.map((r) => r.percentage)) : 0;
    const flagged = new Set(rows.filter((r) => r.violations > 0).map((r) => r.userId)).size;
    const unique = new Set(rows.map((r) => r.userId)).size;
    return { attempts, avg, passRate, passed, highest, lowest, flagged, unique };
  }, [filteredResults, passThreshold]);

  /* ── By college ── */
  const byCollege = useMemo(() => {
    const map = new Map<string, { sum: number; count: number; passed: number }>();
    for (const r of filteredResults) {
      const key = tenantNameOf.get(r.tenantId) ?? (r.tenantId || "Unknown");
      const cur = map.get(key) ?? { sum: 0, count: 0, passed: 0 };
      cur.sum += r.percentage; cur.count += 1;
      if (r.percentage >= passThreshold) cur.passed += 1;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([college, v]) => ({ college, avg: v.count ? Math.round((v.sum / v.count) * 10) / 10 : 0, passRate: v.count ? Math.round((v.passed / v.count) * 1000) / 10 : 0, count: v.count }))
      .sort((a, b) => b.avg - a.avg).slice(0, 10);
  }, [filteredResults, tenantNameOf, passThreshold]);

  /* ── By department ── */
  const byDepartment = useMemo(() => {
    const map = new Map<string, { sum: number; count: number }>();
    for (const r of filteredResults) {
      const key = r.department || "Unassigned";
      const cur = map.get(key) ?? { sum: 0, count: 0 };
      cur.sum += r.percentage; cur.count += 1; map.set(key, cur);
    }
    return [...map.entries()]
      .map(([department, v]) => ({ department, avg: v.count ? Math.round((v.sum / v.count) * 10) / 10 : 0, count: v.count }))
      .sort((a, b) => b.avg - a.avg);
  }, [filteredResults]);

  /* ── Submissions over time ── */
  const submissionsOverTime = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredResults) {
      if (!r.submittedAt) continue;
      const key = r.submittedAt.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b)).slice(-21)
      .map(([date, submissions]) => ({ date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }), submissions }));
  }, [filteredResults]);

  /* ── Distribution ── */
  const distribution = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    for (const r of filteredResults) { const idx = Math.min(4, Math.floor(Math.min(99.99, Math.max(0, r.percentage)) / 20)); counts[idx] = (counts[idx] ?? 0) + 1; }
    return BUCKETS.map((bucket, i) => ({ bucket, count: counts[i] ?? 0 }));
  }, [filteredResults]);

  /* ── Pass/Fail pie ── */
  const passFail = useMemo(() => [{ name: "Pass", value: kpis.passed }, { name: "Fail", value: kpis.attempts - kpis.passed }], [kpis]);

  /* ── Rank list ── */
  const ranked = useMemo(() => [...filteredResults].sort((a, b) => b.percentage - a.percentage).map((r, i) => ({ ...r, rank: i + 1 })), [filteredResults]);

  /* ── Violations ── */
  const violationsByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredEvents) map.set(e.type, (map.get(e.type) ?? 0) + 1);
    return [...map.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 12);
  }, [filteredEvents]);

  const severitySummary = useMemo(() => { const m = { low: 0, medium: 0, high: 0 }; for (const e of filteredEvents) m[e.severity] += 1; return m; }, [filteredEvents]);

  /* ── Pivot (score matrix) ── */
  const pivot = useMemo(() => {
    if (assessmentFilter !== "all") return null;
    const asmMap = new Map<string, string>();
    for (const r of filteredResults) asmMap.set(r.assessmentId, r.assessmentTitle || r.assessmentId);
    const asmCols = [...asmMap.entries()].sort(([, a], [, b]) => a.localeCompare(b));
    if (asmCols.length < 2 || asmCols.length > 20) return null;
    type SR = { key: string; name: string; email: string; roll: string; college: string; dept: string; scores: Map<string, { score: number; max: number; pct: number }> };
    const sm = new Map<string, SR>();
    for (const r of filteredResults) {
      const key = r.userId || r.email;
      if (!sm.has(key)) sm.set(key, { key, name: r.displayName || r.email, email: r.email, roll: r.rollNumber, college: tenantNameOf.get(r.tenantId) ?? r.tenantId, dept: r.department, scores: new Map() });
      sm.get(key)!.scores.set(r.assessmentId, { score: r.totalScore, max: r.maxScore, pct: r.percentage });
    }
    return { asmCols, students: [...sm.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }, [filteredResults, assessmentFilter, tenantNameOf]);

  /* ── Export helpers ── */
  const detailHeaders = [
    "#",
    "Name",
    "Email",
    "Roll",
    "College",
    "Year",
    "Dept",
    "Assessment",
    "Score",
    "Max",
    "%",
    "Result",
    "Start Time",
    "Submitted At",
    "Duration",
    "Violations",
  ];

  function detailRow(r: ResultRow & { rank?: number }) {
    return [
      r.rank ?? "",
      r.displayName || r.email,
      r.email,
      r.rollNumber || "—",
      tenantNameOf.get(r.tenantId) ?? r.tenantId,
      normaliseYear(r.year || r.cohortId) ?? "—",
      r.department || "—",
      r.assessmentTitle,
      r.totalScore,
      r.maxScore,
      pf.format(r.percentage),
      r.percentage >= passThreshold ? "Pass" : "Fail",
      r.startedAt ? `${formatDateDisplay(r.startedAt)} ${formatTime(r.startedAt)}` : "—",
      r.submittedAt ? `${formatDateDisplay(r.submittedAt)} ${formatTime(r.submittedAt)}` : "—",
      formatHrMinSec(r.timeTakenSeconds),
      r.violations,
    ];
  }

  /** Normalized result set for the report engine (summary-level, no raw doc). */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const normalizedResults = useMemo(
    () => normalizeResults(filteredResults, tenantNameOf, passThreshold),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredResults, passThreshold]
  );

  function getExportFilters(): { testName?: string; college?: string; year?: string } {
    const f: { testName?: string; college?: string; year?: string } = {};
    const aTitle = resolvedAssessmentOptions.find((a) => a.id === assessmentFilter)?.title;
    if (assessmentFilter !== "all" && aTitle) f.testName = aTitle;
    const cName = tenantNameOf.get(effectiveTenant);
    if (effectiveTenant && cName) f.college = cName;
    if (cohortFilter !== "all") f.year = selectedCohort?.label || selectedCohort?.year || cohortFilter;
    return f;
  }

  function exportExcel() {
    try {
      if (tab === "violations") {
        import("xlsx").then((XLSX) => {
          const book = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(filteredEvents.map((e) => ({ Timestamp: e.at?.toISOString() ?? "", Student: e.displayName, Email: e.email, Assessment: e.assessmentTitle, Type: e.type, Severity: e.severity, Detail: e.detail }))), "Violations");
          XLSX.writeFile(book, `seed-it-violations-${Date.now()}.xlsx`);
          toast.success("Violations Excel ready");
        }).catch(() => toast.error("Excel export failed"));
      } else if (tab === "pivot" && pivot) {
        import("xlsx").then((XLSX) => {
          const book = XLSX.utils.book_new();
          const hdrs = ["Name", "Email", "Roll", "College", "Dept", ...pivot.asmCols.map(([, t]) => t + " (%)")];
          const rows = pivot.students.map((s) => [s.name, s.email, s.roll, s.college, s.dept, ...pivot.asmCols.map(([id]) => { const sc = s.scores.get(id); return sc ? pf.format(sc.pct) : "—"; })]);
          XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([hdrs, ...rows]), "Score Matrix");
          XLSX.writeFile(book, `seed-it-matrix-${Date.now()}.xlsx`);
          toast.success("Excel export ready");
        }).catch(() => toast.error("Excel export failed"));
      } else {
        generateMarksExcel(normalizedResults, getExportFilters());
        toast.success("Styled Excel report ready");
      }
    } catch { toast.error("Export failed"); }
  }

  async function exportAssessmentReportWorkbook() {
    if (normalizedResults.length === 0) { toast.error("No results to export — pull reports first"); return; }
    if (!pulledAssessmentId) { toast.error("Select and pull a specific assessment first"); return; }
    try {
      toast.info("Preparing Assessment Report (Excel Workbook)…");
      const rawDocs = await fetchAssessmentRawDocs(pulledAssessmentId, effectiveTenant || undefined);
      const { normalizeReportResult } = await import("@/services/reports/reportNormalizer");
      const enrichedResults = (pulledRows.length > 0 ? pulledRows : (resultsQ.data ?? [])).map((row) => {
        const rawDoc = rawDocs.get(row.userId) ?? rawDocs.get(row.email);
        return normalizeReportResult(row, tenantNameOf, rawDoc ?? undefined, passThreshold);
      });
      const groups = computeAssessmentGroups(enrichedResults);
      if (groups.length === 0) { toast.error("No assessment groups found"); return; }
      for (const group of groups) {
        generateAssessmentWorkbook(group);
      }
      toast.success("Assessment Report (Excel) downloaded!");
    } catch (err) {
      console.error("Assessment workbook export failed", err);
      toast.error("Assessment workbook export failed");
    }
  }

  async function exportInstitutionalAnalysisPdf() {
    if (normalizedResults.length === 0) { toast.error("No results to export — pull reports first"); return; }
    try {
      toast.info("Generating Institutional Analysis (PDF)…");
      generateAnalysisPdf(normalizedResults, getExportFilters());
      toast.success("Institutional Analysis (PDF) downloaded!");
    } catch (err) {
      console.error("Analysis PDF export failed", err);
      toast.error("Analysis PDF export failed");
    }
  }

  function exportMarksReportCsv() {
    if (tab === "violations") {
      downloadCsv(`seed-it-violations-${Date.now()}.csv`, ["Timestamp", "Student", "Email", "Assessment", "Type", "Severity", "Detail"], filteredEvents.map((e) => [e.at?.toISOString() ?? "", e.displayName, e.email, e.assessmentTitle, e.type, e.severity, e.detail]));
      toast.success("Violations CSV downloaded");
    } else if (tab === "pivot" && pivot) {
      const hdrs = ["Name", "Email", "Roll", "College", "Dept", ...pivot.asmCols.map(([, t]) => t + " (%)")];
      downloadCsv(`seed-it-matrix-${Date.now()}.csv`, hdrs, pivot.students.map((s) => [s.name, s.email, s.roll, s.college, s.dept, ...pivot.asmCols.map(([id]) => { const sc = s.scores.get(id); return sc ? pf.format(sc.pct) : ""; })]));
      toast.success("Matrix CSV downloaded");
    } else {
      generateCsv(normalizedResults, getExportFilters());
      toast.success("Marks Report (CSV) downloaded!");
    }
  }

  async function exportCompleteZip() {
    if (normalizedResults.length === 0) { toast.error("No results to export"); return; }
    setIsZipping(true);
    setZipProgress(0);
    try {
      toast.info(`Generating complete reports ZIP for ${normalizedResults.length} students…`);
      await generateBulkZip(normalizedResults, getExportFilters(), (pct) => setZipProgress(pct));
      toast.success("Complete Reports Bundle ZIP downloaded!");
    } catch (err) {
      console.error("ZIP export failed", err);
      toast.error("ZIP export failed");
    } finally {
      setIsZipping(false);
      setZipProgress(0);
    }
  }

  // Cache for raw docs fetched during this session (keyed by userId or email)
  const [rawDocsCache, setRawDocsCache] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [selectedStudentResult, setSelectedStudentResult] = useState<NormalizedResult | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [isLoadingStudentAnalysis, setIsLoadingStudentAnalysis] = useState(false);

  async function openStudentAnalysis(r: ResultRow) {
    try {
      setIsLoadingStudentAnalysis(true);
      let rawDoc = rawDocsCache.get(r.userId) ?? rawDocsCache.get(r.email);
      if (!rawDoc && pulledAssessmentId) {
        const freshDocs = await fetchAssessmentRawDocs(pulledAssessmentId, effectiveTenant || undefined);
        setRawDocsCache(freshDocs);
        rawDoc = freshDocs.get(r.userId) ?? freshDocs.get(r.email);
      }
      const normalized = normalizeReportResult(r, tenantNameOf, rawDoc, passThreshold);
      setSelectedStudentResult(normalized);
      setIsAnalysisModalOpen(true);
    } catch (err) {
      console.error("Failed to load student analysis", err);
      toast.error("Failed to load student analysis");
    } finally {
      setIsLoadingStudentAnalysis(false);
    }
  }

  /* ─────────────────────── RENDER ─────────────────────── */
  return (
    <div className="space-y-6">
      {/* Top action header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Reports &amp; Student Analysis</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Canonical Firestore reports from <code className="text-xs bg-muted px-1.5 py-0.5 rounded">assessmentResults/{'{tenantId}'}/{'{assessmentId}'}</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* 1. Marks Report (CSV) */}
          <Button
            variant="outline"
            className="rounded-xl shadow-sm border-primary/30 hover:bg-primary/5 font-medium"
            onClick={exportMarksReportCsv}
            disabled={normalizedResults.length === 0}
            title="Download Marks Report (CSV with S.No, Timings, Scores)"
          >
            <Download className="size-4 mr-1.5 text-primary" /> Marks Report (CSV)
          </Button>

          {/* 2. Assessment Report (Excel Workbook) */}
          <Button
            variant="outline"
            className="rounded-xl shadow-sm border-emerald-500/30 hover:bg-emerald-500/5 font-medium"
            onClick={exportAssessmentReportWorkbook}
            disabled={!pulledAssessmentId || normalizedResults.length === 0}
            title="Download Assessment Report (Excel Workbook with Summary + Test Results)"
          >
            <FileSpreadsheet className="size-4 mr-1.5 text-emerald-600 dark:text-emerald-400" /> Assessment Report (Excel)
          </Button>

          {/* 3. Institutional Analysis (PDF) */}
          <Button
            variant="outline"
            className="rounded-xl shadow-sm border-purple-500/30 hover:bg-purple-500/5 font-medium"
            onClick={exportInstitutionalAnalysisPdf}
            disabled={!pulledAssessmentId || normalizedResults.length === 0}
            title="Download Complete Institutional Analysis Report (PDF)"
          >
            <FileText className="size-4 mr-1.5 text-purple-600 dark:text-purple-400" /> Institutional Analysis (PDF)
          </Button>

          {/* 4. Complete ZIP Download */}
          <Button
            className="rounded-xl shadow-sm font-medium gap-1.5"
            onClick={exportCompleteZip}
            disabled={isZipping || normalizedResults.length === 0}
            title="Download All 3 Reports + All Student Individual Performance PDFs in one ZIP"
          >
            <Download className="size-4" /> {isZipping ? `Generating ZIP (${zipProgress}%)…` : "Download All (ZIP)"}
          </Button>
        </div>
      </div>

      {/* ─── 3-Step Guided Scope Selector ─── */}
      <Card className="rounded-2xl border-primary/20 bg-card/70 shadow-sm backdrop-blur-md">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs shadow-sm">
                1
              </span>
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Step 1: Choose College</h2>
              </div>
              <span className="text-muted-foreground text-xs">→</span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs shadow-sm">
                2
              </span>
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Step 2: Choose Batch / Year</h2>
              </div>
              <span className="text-muted-foreground text-xs">→</span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs shadow-sm">
                3
              </span>
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Step 3: Choose Mapped Assessment</h2>
              </div>
            </div>

            {selectedCohort && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="rounded-md font-medium">
                  🎓 {selectedCohort.label || selectedCohort.year}
                </Badge>
                {selectedCohort.studentCount !== undefined && (
                  <Badge variant="secondary" className="rounded-md font-normal">
                    👥 {selectedCohort.studentCount} Students
                  </Badge>
                )}
                {selectedCohort.allowedModules && (
                  <Badge variant="secondary" className="rounded-md font-normal">
                    📚 {selectedCohort.allowedModules.length} Mapped Modules
                  </Badge>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Step 1: Tenant */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <School className="size-3.5 text-primary" /> 1. College / Tenant
              </Label>
              <Select
                value={tenantFilter}
                onValueChange={(val) => {
                  setTenantFilter(val);
                  setCohortFilter("all");
                  setAssessmentFilter("all");
                  setPulledRows([]);
                  setPulledAssessmentId(null);
                }}
                disabled={Boolean(scopedTenantId)}
              >
                <SelectTrigger className="rounded-xl font-medium" aria-label="Select college">
                  <SelectValue placeholder="Select College…" />
                </SelectTrigger>
                <SelectContent>
                  {!scopedTenantId && <SelectItem value="all">All Colleges (Superadmin)</SelectItem>}
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 2: Cohort / Batch Year */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <GraduationCap className="size-3.5 text-primary" /> 2. Graduation Year / Cohort
              </Label>
              <Select
                value={cohortFilter}
                onValueChange={(val) => {
                  setCohortFilter(val);
                  setAssessmentFilter("all");
                  setPulledRows([]);
                  setPulledAssessmentId(null);
                }}
                disabled={cohortsQ.isLoading || availableCohorts.length === 0}
              >
                <SelectTrigger className="rounded-xl font-medium" aria-label="Select cohort">
                  <SelectValue placeholder={cohortsQ.isLoading ? "Loading cohorts…" : (availableCohorts.length === 0 ? "All Batches / Years" : "Select Batch / Year…")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Batches / Years</SelectItem>
                  {availableCohorts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label || c.year} {c.studentCount ? `(${c.studentCount} students)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 3: Assessment (Resolved from allowedModules + results) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ClipboardList className="size-3.5 text-primary" /> 3. Mapped Assessment
              </Label>
              <Select
                value={assessmentFilter}
                onValueChange={(val) => {
                  setAssessmentFilter(val);
                  setPulledRows([]);
                  setPulledAssessmentId(null);
                }}
                disabled={resolvedAssessmentOptions.length === 0}
              >
                <SelectTrigger className="rounded-xl border-primary/40 font-medium" aria-label="Select assessment">
                  <SelectValue placeholder={resolvedAssessmentOptions.length === 0 ? "No mapped assessments" : "⚡ Choose Assessment…"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">— Select Assessment —</SelectItem>
                  {resolvedAssessmentOptions.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider py-0 px-1 font-semibold">
                          {a.type}
                        </Badge>
                        <span className="truncate">{a.title}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 4: Action Button */}
            <div className="flex items-end">
              <Button
                className="w-full rounded-xl gap-2 font-medium shadow-sm h-10"
                onClick={pullReports}
                disabled={isPulling || !assessmentFilter || assessmentFilter === "all"}
              >
                {isPulling ? (
                  <>Loading Results…</>
                ) : (
                  <>
                    <ClipboardList className="size-4" /> Pull Reports ▶
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Secondary Live Filters Bar ─── */}
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="grid gap-3 p-4 md:grid-cols-6 items-center">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-xl pl-9"
              placeholder="Search student name, roll no, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search students"
            />
          </div>

          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by department">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {availableDepartments.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by status">
              <SelectValue placeholder="All Results" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Results (Pass &amp; Fail)</SelectItem>
              <SelectItem value="passed">✅ Passed Only</SelectItem>
              <SelectItem value="failed">❌ Failed Only</SelectItem>
              <SelectItem value="flagged">🚨 Flagged with Violations</SelectItem>
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by test type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="mcq">MCQ</SelectItem>
              <SelectItem value="coding">Coding</SelectItem>
              <SelectItem value="multisection">Multi-Section</SelectItem>
              <SelectItem value="spoken-english">Spoken English</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Label htmlFor="pass-threshold" className="whitespace-nowrap text-xs text-muted-foreground font-medium">Pass ≥</Label>
            <Input
              id="pass-threshold"
              type="number"
              min={0}
              max={100}
              className="rounded-xl"
              value={passThreshold}
              onChange={(e) => setPassThreshold(Number(e.target.value) || 0)}
              aria-label="Pass threshold percentage"
            />
            <span className="text-xs text-muted-foreground font-medium">%</span>
          </div>
        </CardContent>
      </Card>

      {/* Empty state — before assessment is pulled */}
      {filteredResults.length === 0 && !isPulling && !pulledAssessmentId && (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="py-16 text-center">
            <FileSpreadsheet className="mx-auto mb-4 size-12 text-muted-foreground/40" />
            <p className="text-lg font-semibold">Select an Assessment &amp; Pull Reports</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose a College → Batch / Year → Assessment from the filters above,<br />
              then click <strong>Pull Reports ▶</strong> to query <code className="text-xs bg-muted px-1.5 py-0.5 rounded">assessmentResults/{'{tenantId}'}/{'{assessmentId}'}</code>.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl h-auto flex-wrap">
          <TabsTrigger value="overview" className="rounded-lg"><ClipboardList className="mr-1.5 size-3.5" />Overview</TabsTrigger>
          <TabsTrigger value="rank" className="rounded-lg"><Award className="mr-1.5 size-3.5" />Rank list</TabsTrigger>
          <TabsTrigger value="individual" className="rounded-lg"><FileText className="mr-1.5 size-3.5" />Individual</TabsTrigger>
          <TabsTrigger value="sections" className="rounded-lg"><Layers className="mr-1.5 size-3.5" />Sections</TabsTrigger>
          {pivot && <TabsTrigger value="pivot" className="rounded-lg"><Table2 className="mr-1.5 size-3.5" />Score matrix</TabsTrigger>}
          <TabsTrigger value="violations" className="rounded-lg"><ShieldAlert className="mr-1.5 size-3.5" />Violations</TabsTrigger>
        </TabsList>

        {/* ══ OVERVIEW ══ */}
        <TabsContent value="overview" className="mt-4 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total attempts" value={nf.format(kpis.attempts)} hint={`${nf.format(kpis.unique)} unique students`} icon={ClipboardList} loading={loading} color="#6366f1" />
            <KpiCard label="Average score" value={`${pf.format(kpis.avg)}%`} hint="Across filtered results" icon={Target} loading={loading} color="#0ea5e9" />
            <KpiCard label="Pass rate" value={`${pf.format(kpis.passRate)}%`} hint={`≥ ${passThreshold}% · ${kpis.passed} passed`} icon={Award} loading={loading} color="#22c55e" />
            <KpiCard label="Flagged students" value={nf.format(kpis.flagged)} hint="Have ≥1 proctoring violation" icon={ShieldAlert} loading={loading} color="#ef4444" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Highest score" value={`${pf.format(kpis.highest)}%`} hint="Best performance" icon={TrendingUp} loading={loading} color="#f59e0b" />
            <KpiCard label="Lowest score" value={`${pf.format(kpis.lowest)}%`} hint="Weakest performance" icon={TrendingDown} loading={loading} color="#ec4899" />
          </div>

          {/* Charts grid */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Average % by college</CardTitle></CardHeader>
              <CardContent className="h-72">
                {loading ? <Skeleton className="size-full rounded-xl" /> : byCollege.length === 0 ? <EmptyChart message="No results for these filters." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byCollege} margin={{ left: -20, top: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                      <XAxis dataKey="college" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} interval={0} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="avg" name="Avg %" fill="#6366f1" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="passRate" name="Pass %" fill="#22c55e" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Average % by department</CardTitle></CardHeader>
              <CardContent className="h-72">
                {loading ? <Skeleton className="size-full rounded-xl" /> : byDepartment.length === 0 ? <EmptyChart message="No results for these filters." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byDepartment} layout="vertical" margin={{ left: 0, top: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="department" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} width={80} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                      <Bar dataKey="avg" name="Avg %" fill="#0ea5e9" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Submissions over time</CardTitle></CardHeader>
              <CardContent className="h-72">
                {loading ? <Skeleton className="size-full rounded-xl" /> : submissionsOverTime.length === 0 ? <EmptyChart message="No submissions recorded yet." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={submissionsOverTime} margin={{ left: -20, top: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                      <Area type="monotone" dataKey="submissions" stroke="#6366f1" fill="#6366f1" fillOpacity={0.18} strokeWidth={2.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Score distribution</CardTitle></CardHeader>
                <CardContent className="h-40">
                  {loading ? <Skeleton className="size-full rounded-xl" /> : filteredResults.length === 0 ? <EmptyChart message="No results." /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={distribution} margin={{ left: -20, top: 4, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                        <Bar dataKey="count" name="Students" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Pass / Fail</CardTitle></CardHeader>
                <CardContent className="h-40">
                  {loading ? <Skeleton className="size-full rounded-xl" /> : kpis.attempts === 0 ? <EmptyChart message="No results yet." /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={passFail} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} label={({ name, percent }) => `${name} ${Math.round((percent as number) * 100)}%`} labelLine={false}>
                          {passFail.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Detail table */}
          <Card className="rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">All results ({nf.format(filteredResults.length)})</CardTitle>
              <Button size="sm" variant="outline" className="rounded-xl h-7 text-xs" onClick={() => { downloadCsv(`seed-it-detail-${Date.now()}.csv`, detailHeaders, filteredResults.map(r => detailRow(r))); toast.success("CSV downloaded"); }}>
                <Download className="mr-1 size-3" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              {loading ? (<div className="space-y-2">{[0,1,2,3,4].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>) :
                filteredResults.length === 0 ? (<p className="py-8 text-center text-sm text-muted-foreground">No results match these filters.</p>) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>Roll No</TableHead>
                          <TableHead>College</TableHead>
                          <TableHead>Dept</TableHead>
                          <TableHead>Batch</TableHead>
                          <TableHead>Assessment</TableHead>
                          <TableHead>Score</TableHead>
                          <TableHead>%</TableHead>
                          <TableHead>Result</TableHead>
                          <TableHead>Started At</TableHead>
                          <TableHead>Submitted At</TableHead>
                          <TableHead>Duration</TableHead>
                          <TableHead>Violations</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredResults.slice(0, 300).map((r) => (
                          <TableRow key={r.path}>
                            <TableCell className="font-medium">
                              <div>
                                <p className="font-medium text-foreground">{r.displayName || r.email}</p>
                                {r.displayName && <p className="text-xs text-muted-foreground">{r.email}</p>}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{r.rollNumber || "—"}</TableCell>
                            <TableCell>{tenantNameOf.get(r.tenantId) ?? r.tenantId}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{r.department || "—"}</Badge></TableCell>
                            <TableCell>{normaliseYear(r.year || r.cohortId) ?? "—"}</TableCell>
                            <TableCell className="max-w-40 truncate" title={r.assessmentTitle}>{r.assessmentTitle}</TableCell>
                            <TableCell className="font-semibold">{r.totalScore}/{r.maxScore}</TableCell>
                            <TableCell className="font-bold">{pf.format(r.percentage)}%</TableCell>
                            <TableCell>{r.percentage >= passThreshold ? <Badge className="rounded-full text-[10px] bg-emerald-500 hover:bg-emerald-600">Pass</Badge> : <Badge variant="destructive" className="rounded-full text-[10px]">Fail</Badge>}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {r.startedAt ? `${formatDateDisplay(r.startedAt)} ${formatTime(r.startedAt)}` : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {r.submittedAt ? `${formatDateDisplay(r.submittedAt)} ${formatTime(r.submittedAt)}` : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs font-medium">
                              {formatHrMinSec(r.timeTakenSeconds)}
                            </TableCell>
                            <TableCell>
                              {r.violations > 0 ? (
                                <Badge variant="destructive" className="rounded-full text-[10px] font-semibold">
                                  {r.violations}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-lg h-7 text-xs gap-1 hover:border-primary hover:text-primary transition-colors"
                                onClick={() => openStudentAnalysis(r)}
                                title="View individual student performance breakdown"
                              >
                                <Eye className="size-3" /> View Analysis
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {filteredResults.length > 300 && <p className="mt-2 text-center text-xs text-muted-foreground">Showing 300 of {nf.format(filteredResults.length)} — Export CSV for all rows.</p>}
                  </>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══ RANK LIST ══ */}
        <TabsContent value="rank" className="mt-4">
          <Card className="rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">Rank list ({nf.format(ranked.length)})</CardTitle>
              <Button size="sm" variant="outline" className="rounded-xl h-7 text-xs" onClick={() => { downloadCsv(`seed-it-rank-${Date.now()}.csv`, detailHeaders, ranked.map(detailRow)); toast.success("CSV downloaded"); }}>
                <Download className="mr-1 size-3" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              {loading ? (<div className="space-y-2">{[0,1,2,3,4].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>) :
                ranked.length === 0 ? (<p className="py-8 text-center text-sm text-muted-foreground">No results match these filters.</p>) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rank</TableHead>
                          <TableHead>Student</TableHead>
                          <TableHead>Roll No</TableHead>
                          <TableHead>College</TableHead>
                          <TableHead>Batch</TableHead>
                          <TableHead>Dept</TableHead>
                          <TableHead>Score</TableHead>
                          <TableHead>%</TableHead>
                          <TableHead>Started At</TableHead>
                          <TableHead>Submitted At</TableHead>
                          <TableHead>Duration</TableHead>
                          <TableHead>Violations</TableHead>
                          <TableHead>Result</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ranked.slice(0, 500).map((r) => (
                          <TableRow key={r.path}>
                            <TableCell>{medalBadge(r.rank)}</TableCell>
                            <TableCell className="font-medium">
                              <div>
                                <p className="font-medium text-foreground">{r.displayName || r.email}</p>
                                {r.displayName && <p className="text-xs text-muted-foreground">{r.email}</p>}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{r.rollNumber || "—"}</TableCell>
                            <TableCell>{tenantNameOf.get(r.tenantId) ?? r.tenantId}</TableCell>
                            <TableCell>{normaliseYear(r.year || r.cohortId) ?? "—"}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{r.department || "—"}</Badge></TableCell>
                            <TableCell className="font-semibold">{r.totalScore}/{r.maxScore}</TableCell>
                            <TableCell className="font-bold">{pf.format(r.percentage)}%</TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {r.startedAt ? `${formatDateDisplay(r.startedAt)} ${formatTime(r.startedAt)}` : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {r.submittedAt ? `${formatDateDisplay(r.submittedAt)} ${formatTime(r.submittedAt)}` : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs font-medium">
                              {formatHrMinSec(r.timeTakenSeconds)}
                            </TableCell>
                            <TableCell>
                              {r.violations > 0 ? (
                                <Badge variant="destructive" className="rounded-full text-[10px] font-semibold">
                                  {r.violations}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell>{r.percentage >= passThreshold ? <Badge className="rounded-full text-[10px] bg-emerald-500 hover:bg-emerald-600">Pass</Badge> : <Badge variant="destructive" className="rounded-full text-[10px]">Fail</Badge>}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-lg h-7 text-xs gap-1 hover:border-primary hover:text-primary transition-colors"
                                onClick={() => openStudentAnalysis(r)}
                                title="View individual student performance breakdown"
                              >
                                <Eye className="size-3" /> View Analysis
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {ranked.length > 500 && <p className="mt-2 text-center text-xs text-muted-foreground">Showing 500 of {nf.format(ranked.length)} — Export CSV for full list.</p>}
                  </>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══ SCORE MATRIX ══ */}
        {pivot && (
          <TabsContent value="pivot" className="mt-4">
            <Card className="rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-sm font-semibold">Score matrix — students × assessments</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">One row per student · one column per assessment — mirrors old admin scores report format</p>
                </div>
                <Button size="sm" variant="outline" className="rounded-xl h-7 text-xs" onClick={exportMarksReportCsv}>
                  <FileText className="mr-1 size-3" /> CSV
                </Button>
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>Roll</TableHead><TableHead>College</TableHead><TableHead>Dept</TableHead>
                      {pivot.asmCols.map(([id, title]) => <TableHead key={id} className="max-w-32 truncate" title={title}>{title}</TableHead>)}
                      <TableHead>Avg %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pivot.students.map((s) => {
                      const scores = pivot.asmCols.map(([id]) => s.scores.get(id)?.pct);
                      const valid = scores.filter((x): x is number => x !== undefined);
                      const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
                      return (
                        <TableRow key={s.key}>
                          <TableCell className="font-medium whitespace-nowrap">{s.name}</TableCell>
                          <TableCell>{s.roll || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{s.college}</TableCell>
                          <TableCell>{s.dept || "—"}</TableCell>
                          {scores.map((pct, i) => (
                            <TableCell key={i}>
                              {pct !== undefined ? (
                                <span className={pct >= passThreshold ? "text-green-600 font-medium" : "text-red-500"}>{pf.format(pct)}%</span>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                          ))}
                          <TableCell className="font-semibold">{avg !== null ? `${pf.format(avg)}%` : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ══ VIOLATIONS ══ */}
        <TabsContent value="violations" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Low severity" value={nf.format(severitySummary.low)} hint="Minor flags" icon={ShieldAlert} loading={eventsQ.isLoading} color="#22c55e" />
            <KpiCard label="Medium severity" value={nf.format(severitySummary.medium)} hint="Needs review" icon={ShieldAlert} loading={eventsQ.isLoading} color="#f59e0b" />
            <KpiCard label="High severity" value={nf.format(severitySummary.high)} hint="Likely malpractice" icon={ShieldAlert} loading={eventsQ.isLoading} color="#ef4444" />
          </div>
          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Violations by type</CardTitle></CardHeader>
            <CardContent className="h-72">
              {eventsQ.isLoading ? <Skeleton className="size-full rounded-xl" /> : violationsByType.length === 0 ? <EmptyChart message="No proctoring events recorded." /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={violationsByType} margin={{ left: -20, top: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                    <XAxis dataKey="type" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} interval={0} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                    <Bar dataKey="count" name="Events" fill="#ef4444" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">Violation log ({nf.format(filteredEvents.length)})</CardTitle>
              <Button size="sm" variant="outline" className="rounded-xl h-7 text-xs" onClick={() => { downloadCsv(`seed-it-violations-${Date.now()}.csv`, ["Timestamp","Student","Email","Assessment","Type","Severity","Detail"], filteredEvents.map((e) => [e.at?.toISOString() ?? "", e.displayName, e.email, e.assessmentTitle, e.type, e.severity, e.detail])); toast.success("CSV downloaded"); }}>
                <Download className="mr-1 size-3" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {eventsQ.isLoading ? (<div className="space-y-2">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>) :
                filteredEvents.length === 0 ? (<p className="py-8 text-center text-sm text-muted-foreground">No violations match these filters.</p>) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead><TableHead>Student</TableHead><TableHead>Assessment</TableHead>
                        <TableHead>Type</TableHead><TableHead>Severity</TableHead><TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEvents.slice(0, 500).map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-xs">{e.at?.toLocaleString() ?? "—"}</TableCell>
                          <TableCell className="font-medium">{e.displayName || e.email}</TableCell>
                          <TableCell className="max-w-40 truncate">{e.assessmentTitle || e.assessmentId}</TableCell>
                          <TableCell>{e.type}</TableCell>
                          <TableCell><Badge variant={SEVERITY_VARIANT[e.severity]} className="rounded-full capitalize text-[10px]">{e.severity}</Badge></TableCell>
                          <TableCell className="max-w-64 truncate">{e.detail || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══ INDIVIDUAL ANALYSIS ══ */}
        <TabsContent value="individual" className="mt-4">
          <Card className="rounded-2xl">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
              <div>
                <CardTitle className="text-sm font-semibold">
                  Individual Student Reports ({nf.format(filteredResults.length)})
                </CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Click the <Printer className="inline size-3 mx-0.5" /> button to open a printable PDF report card for any student.
                </p>
              </div>
              <Button size="sm" variant="outline" className="rounded-xl h-7 text-xs"
                onClick={() => { downloadCsv(`seed-it-individual-${Date.now()}.csv`, detailHeaders, filteredResults.map(r => detailRow(r))); toast.success("CSV downloaded"); }}>
                <Download className="mr-1 size-3" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              {loading ? (
                <div className="space-y-2">{[0,1,2,3,4].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
              ) : filteredResults.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No results match these filters.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-4"></TableHead>
                        <TableHead>Student</TableHead>
                        <TableHead>Roll</TableHead>
                        <TableHead>College</TableHead>
                        <TableHead>Year</TableHead>
                        <TableHead>Dept</TableHead>
                        <TableHead>Assessment</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>%</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Violations</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead className="w-8">PDF</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredResults.slice(0, 500).map((r) => (
                        <TableRow key={r.path} className={r.violations > 0 ? "bg-destructive/5" : undefined}>
                          <TableCell>
                            <span className={`inline-block size-2 rounded-full ${r.percentage >= passThreshold ? "bg-green-500" : "bg-red-500"}`} />
                          </TableCell>
                          <TableCell className="font-medium whitespace-nowrap">{r.displayName || r.email}</TableCell>
                          <TableCell>{r.rollNumber || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{tenantNameOf.get(r.tenantId) ?? r.tenantId}</TableCell>
                          <TableCell>{normaliseYear(r.cohortId) ?? "—"}</TableCell>
                          <TableCell>{r.department || "—"}</TableCell>
                          <TableCell className="max-w-40 truncate">{r.assessmentTitle}</TableCell>
                          <TableCell className="font-mono text-xs">{r.totalScore}/{r.maxScore}</TableCell>
                          <TableCell className={r.percentage >= passThreshold ? "text-green-600 font-semibold" : "text-red-500 font-semibold"}>
                            {pf.format(r.percentage)}%
                          </TableCell>
                          <TableCell>
                            {r.percentage >= passThreshold
                              ? <Badge className="rounded-full text-[10px]">Pass</Badge>
                              : <Badge variant="destructive" className="rounded-full text-[10px]">Fail</Badge>}
                          </TableCell>
                          <TableCell>
                            {r.violations > 0
                              ? <Badge variant="destructive" className="rounded-full text-[10px]">{r.violations}</Badge>
                              : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{r.submittedAt?.toLocaleDateString() ?? "—"}</TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" className="size-7 rounded-lg hover:text-primary" title="View individual student analysis"
                              onClick={() => openStudentAnalysis(r)}>
                              <Eye className="size-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredResults.length > 500 && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Showing 500 of {nf.format(filteredResults.length)} — Export CSV for all rows.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══ SECTION ANALYSIS ══ */}
        <TabsContent value="sections" className="mt-4">
          <Card className="rounded-2xl">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
              <div>
                <CardTitle className="text-sm font-semibold">Section-wise Performance Analysis</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  One row per student × section — shows breakdown across all multi-section assessments.
                </p>
              </div>
              <Button size="sm" variant="outline" className="rounded-xl h-7 text-xs"
                onClick={exportAssessmentReportWorkbook} disabled={normalizedResults.length === 0}>
                <FileSpreadsheet className="mr-1 size-3" /> Excel
              </Button>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              {loading ? (
                <div className="space-y-2">{[0,1,2,3,4].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
              ) : normalizedResults.filter(r => r.sections.length > 0).length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No section data found. Section data is available for multi-section assessments.
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Roll</TableHead>
                        <TableHead>College</TableHead>
                        <TableHead>Dept</TableHead>
                        <TableHead>Year</TableHead>
                        <TableHead>Assessment</TableHead>
                        <TableHead>Section</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Max</TableHead>
                        <TableHead>%</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {normalizedResults
                        .filter(r => r.sections.length > 0)
                        .slice(0, 200)
                        .flatMap(r =>
                          r.sections.map((sec, si) => (
                            <TableRow key={`${r.studentId}-${r.testId}-${si}`}>
                              <TableCell className="font-medium whitespace-nowrap">{r.name}</TableCell>
                              <TableCell>{r.rollNumber || "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">{r.college}</TableCell>
                              <TableCell>{r.department || "—"}</TableCell>
                              <TableCell>{r.year}</TableCell>
                              <TableCell className="max-w-40 truncate">{r.testName}</TableCell>
                              <TableCell className="font-medium">{sec.name}</TableCell>
                              <TableCell>{sec.score}</TableCell>
                              <TableCell>{sec.totalMarks}</TableCell>
                              <TableCell className={sec.status === "Pass" ? "text-green-600 font-semibold" : "text-red-500 font-semibold"}>{sec.percentage}%</TableCell>
                              <TableCell className="whitespace-nowrap text-xs">{sec.timeTaken}</TableCell>
                              <TableCell>
                                {sec.status === "Pass"
                                  ? <Badge className="rounded-full text-[10px]">Pass</Badge>
                                  : <Badge variant="destructive" className="rounded-full text-[10px]">Fail</Badge>}
                              </TableCell>
                            </TableRow>
                          ))
                        )
                      }
                    </TableBody>
                  </Table>
                  {normalizedResults.filter(r => r.sections.length > 0).length > 200 && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Showing first 200 students — Export Excel for full data.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

      {/* ─── Student Performance Analysis Dialog ─── */}
      <Dialog open={isAnalysisModalOpen} onOpenChange={setIsAnalysisModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-6">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight">
                  {selectedStudentResult?.name || "Student Analysis"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Individual Performance Report • {selectedStudentResult?.testName || "Assessment"}
                </DialogDescription>
              </div>
              {selectedStudentResult && (
                <div className="flex items-center gap-2">
                  <Badge className={`rounded-full px-3 py-1 font-semibold text-xs ${selectedStudentResult.percentage >= passThreshold ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "bg-destructive/15 text-destructive border-destructive/30"}`}>
                    {selectedStudentResult.status} ({selectedStudentResult.percentage}%)
                  </Badge>
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                    {selectedStudentResult.category}
                  </Badge>
                </div>
              )}
            </div>
          </DialogHeader>

          {selectedStudentResult && (
            <div className="space-y-6 pt-2">
              {/* Profile Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-muted/40 border border-border/60 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wider font-semibold">Roll Number</span>
                  <span className="font-mono font-medium">{selectedStudentResult.rollNumber || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wider font-semibold">Department</span>
                  <span className="font-medium">{selectedStudentResult.department || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wider font-semibold">Graduation Batch</span>
                  <span className="font-medium">{selectedStudentResult.year || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wider font-semibold">College</span>
                  <span className="font-medium truncate block" title={selectedStudentResult.college}>{selectedStudentResult.college || "—"}</span>
                </div>
              </div>

              {/* KPI Stat Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-card border border-border shadow-sm">
                  <p className="text-[11px] text-muted-foreground font-medium">Score Obtained</p>
                  <p className="text-xl font-bold mt-1 text-foreground">
                    {selectedStudentResult.score} <span className="text-xs font-normal text-muted-foreground">/ {selectedStudentResult.totalMarks}</span>
                  </p>
                  <div className="mt-2 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${selectedStudentResult.percentage >= passThreshold ? "bg-emerald-500" : "bg-destructive"}`} style={{ width: `${Math.min(100, selectedStudentResult.percentage)}%` }} />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-card border border-border shadow-sm">
                  <p className="text-[11px] text-muted-foreground font-medium">Duration Taken</p>
                  <p className="text-xl font-bold mt-1 text-foreground">
                    {formatHrMinSec(selectedStudentResult.timeTakenSeconds)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {selectedStudentResult.startedAt ? formatTime(selectedStudentResult.startedAt) : "—"} → {selectedStudentResult.submittedAt ? formatTime(selectedStudentResult.submittedAt) : "—"}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-card border border-border shadow-sm">
                  <p className="text-[11px] text-muted-foreground font-medium">Proctor Violations</p>
                  <p className={`text-xl font-bold mt-1 ${selectedStudentResult.violationCount > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {selectedStudentResult.violationCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {selectedStudentResult.autoSubmitted ? "Auto Submitted" : "Normal Submission"}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-card border border-border shadow-sm">
                  <p className="text-[11px] text-muted-foreground font-medium">Readiness Insight</p>
                  <p className="text-sm font-semibold mt-1 truncate" title={selectedStudentResult.insight}>
                    {selectedStudentResult.insight}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {selectedStudentResult.category}
                  </p>
                </div>
              </div>

              {/* Section-by-Section Breakdown */}
              {selectedStudentResult.sections.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Section-Wise Performance</h3>
                  <div className="border border-border/80 rounded-xl overflow-hidden shadow-sm">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="text-xs font-semibold">Section Name</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Score</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Max</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Accuracy %</TableHead>
                          <TableHead className="text-xs font-semibold">Time Taken</TableHead>
                          <TableHead className="text-xs font-semibold">Status / CEFR</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedStudentResult.sections.map((sec: NormalizedSection, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium text-xs">{sec.name}</TableCell>
                            <TableCell className="text-right text-xs font-semibold">{sec.score}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{sec.totalMarks}</TableCell>
                            <TableCell className="text-right text-xs font-bold">
                              <span className={sec.percentage >= passThreshold ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                                {sec.percentage}%
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{sec.timeTaken || "—"}</TableCell>
                            <TableCell className="text-xs">
                              {sec.cefrLevel ? (
                                <Badge variant="secondary" className="rounded-full text-[10px]">{sec.cefrLevel} {sec.wpm ? `• ${sec.wpm} wpm` : ""}</Badge>
                              ) : (
                                <Badge className={`rounded-full text-[10px] ${sec.status === "Pass" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" : "bg-destructive/15 text-destructive border-destructive/30"}`}>
                                  {sec.status}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Coding Submissions Breakdown */}
              {selectedStudentResult.codingSubmissions.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Coding Challenges Attempted</h3>
                  <div className="border border-border/80 rounded-xl overflow-hidden shadow-sm">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="text-xs font-semibold">Problem</TableHead>
                          <TableHead className="text-xs font-semibold">Language</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Score</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Test Cases</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Accuracy %</TableHead>
                          <TableHead className="text-xs font-semibold">Time Taken</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedStudentResult.codingSubmissions.map((code: NormalizedCodingSubmission, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium text-xs">
                              Q{code.questionNumber}: {code.problemTitle}
                            </TableCell>
                            <TableCell className="text-xs font-mono">{code.language || "—"}</TableCell>
                            <TableCell className="text-right text-xs font-semibold">{code.score} / {code.maxMarks}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {code.testsPassed} / {code.totalTests}
                            </TableCell>
                            <TableCell className="text-right text-xs font-bold">
                              <span className={code.accuracy >= 100 ? "text-emerald-600 dark:text-emerald-400" : code.accuracy > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                                {code.accuracy}%
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{code.timeTaken || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between sm:justify-between">
            <Button
              variant="outline"
              className="rounded-xl text-xs"
              onClick={() => setIsAnalysisModalOpen(false)}
            >
              Close
            </Button>
            {selectedStudentResult && (
              <Button
                className="rounded-xl text-xs gap-1.5 font-medium shadow-sm"
                onClick={async () => {
                  toast.info("Generating Individual Performance Report PDF…");
                  await generateStudentPdf(selectedStudentResult);
                  toast.success("Individual Performance Report PDF downloaded!");
                }}
              >
                <Download className="size-3.5" /> Download PDF (Individual Performance Report)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
