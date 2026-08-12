import { useMemo, useState } from "react";
import { generateMarksExcel, generateSectionExcel } from "@/services/reports/excelReport";
import { generateCsv } from "@/services/reports/csvReport";
import { generateStudentPdf, generateBulkPdf, generateBulkZip } from "@/services/reports/pdfReport";
import { normalizeResults } from "@/services/reports/reportNormalizer";
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
  Award,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Medal,
  Printer,
  Search,
  ShieldAlert,
  Table2,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { listResults, listResultsByTenant, type ResultRow } from "@/lib/firestore/results";
import { listProctorEvents } from "@/lib/firestore/proctoring";
import { listTenants } from "@/lib/firestore/tenants";
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
  const [yearFilter, setYearFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [assessmentFilter, setAssessmentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [passThreshold, setPassThreshold] = useState(40);
  const [tab, setTab] = useState("overview");
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const assessmentsQ = useQuery({ queryKey: ["assessments"], queryFn: listAssessments });
  const coursesQ = useQuery({ queryKey: ["courses"], queryFn: listCourses });

  // Staff: read only their tenant's results (fast, targeted).
  // Admin: read all results (full scan, with tenant filter client-side).
  const effectiveTenantForQuery = isStaffRole ? (scopedTenantId ?? "") : "";
  const resultsQ = useQuery({
    queryKey: ["results", "reports", effectiveTenantForQuery],
    queryFn: () =>
      effectiveTenantForQuery
        ? listResultsByTenant(effectiveTenantForQuery, { maxResults: 2000 })
        : listResults(5000),
  });
  const eventsQ = useQuery({ queryKey: ["proctor-events", "reports"], queryFn: () => listProctorEvents(5000) });

  const loading = resultsQ.isLoading || assessmentsQ.isLoading || tenantsQ.isLoading;

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const assessments = useMemo(() => {
    const all = assessmentsQ.data ?? [];
    return scopedTenantId ? all.filter((a) => a.tenantId === scopedTenantId || a.tenantId === "ALL") : all;
  }, [assessmentsQ.data, scopedTenantId]);

  const tenantNameOf = useMemo(() => new Map(tenants.map((t) => [t.id, t.name] as const)), [tenants]);
  const effectiveTenant = scopedTenantId || (tenantFilter !== "all" ? tenantFilter : "");

  const filteredResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (resultsQ.data ?? []).filter((r) => {
      if (effectiveTenant && r.tenantId !== effectiveTenant) return false;
      if (yearFilter !== "all" && normaliseYear(r.cohortId) !== yearFilter) return false;
      if (deptFilter !== "all" && r.department !== deptFilter) return false;
      if (assessmentFilter !== "all" && r.assessmentId !== assessmentFilter) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (!q) return true;
      return [r.displayName, r.email, r.rollNumber, r.assessmentTitle].filter(Boolean).some((f) => String(f).toLowerCase().includes(q));
    });
  }, [resultsQ.data, effectiveTenant, yearFilter, deptFilter, assessmentFilter, typeFilter, search]);

  // Build assessment list from actual result data (IDs match what's in Firestore results)
  const assessmentOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of (resultsQ.data ?? [])) {
      if (r.assessmentId && !map.has(r.assessmentId)) {
        map.set(r.assessmentId, r.assessmentTitle || r.assessmentId);
      }
    }
    return [...map.entries()].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title));
  }, [resultsQ.data]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (eventsQ.data ?? []).filter((e) => {
      if (effectiveTenant && e.tenantId !== effectiveTenant) return false;
      if (yearFilter !== "all" && normaliseYear(e.year) !== yearFilter) return false;
      if (deptFilter !== "all" && e.department !== deptFilter) return false;
      if (assessmentFilter !== "all" && e.assessmentId !== assessmentFilter) return false;
      if (!q) return true;
      return [e.displayName, e.email].filter(Boolean).some((f) => String(f).toLowerCase().includes(q));
    });
  }, [eventsQ.data, effectiveTenant, yearFilter, deptFilter, assessmentFilter, search]);

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
  const detailHeaders = ["#", "Name", "Email", "Roll", "College", "Year", "Dept", "Assessment", "Score", "Max", "%", "Result", "Violations", "Submitted"];
  function detailRow(r: ResultRow & { rank?: number }) {
    return [r.rank ?? "", r.displayName || r.email, r.email, r.rollNumber || "—", tenantNameOf.get(r.tenantId) ?? r.tenantId, normaliseYear(r.cohortId) ?? "—", r.department || "—", r.assessmentTitle, r.totalScore, r.maxScore, pf.format(r.percentage), r.percentage >= passThreshold ? "Pass" : "Fail", r.violations, r.submittedAt?.toLocaleDateString() ?? "—"];
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
    const aTitle = assessmentOptions.find(a => a.id === assessmentFilter)?.title;
    if (assessmentFilter !== "all" && aTitle) f.testName = aTitle;
    const cName = tenantNameOf.get(tenantFilter);
    if (tenantFilter !== "all" && cName) f.college = cName;
    if (yearFilter !== "all") f.year = yearFilter;
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
    } catch { toast.error("Excel export failed"); }
  }

  function exportSectionAnalysis() {
    generateSectionExcel(normalizedResults);
    toast.success("Section analysis Excel ready");
  }

  function exportCsv() {
    if (tab === "violations") {
      downloadCsv(`seed-it-violations-${Date.now()}.csv`, ["Timestamp", "Student", "Email", "Assessment", "Type", "Severity", "Detail"], filteredEvents.map((e) => [e.at?.toISOString() ?? "", e.displayName, e.email, e.assessmentTitle, e.type, e.severity, e.detail]));
      toast.success("CSV downloaded");
    } else if (tab === "pivot" && pivot) {
      const hdrs = ["Name", "Email", "Roll", "College", "Dept", ...pivot.asmCols.map(([, t]) => t + " (%)")];
      downloadCsv(`seed-it-matrix-${Date.now()}.csv`, hdrs, pivot.students.map((s) => [s.name, s.email, s.roll, s.college, s.dept, ...pivot.asmCols.map(([id]) => { const sc = s.scores.get(id); return sc ? pf.format(sc.pct) : ""; })]));
      toast.success("CSV downloaded");
    } else {
      generateCsv(normalizedResults, getExportFilters());
      toast.success("CSV downloaded");
    }
  }

  async function exportPdf() {
    if (normalizedResults.length === 0) { toast.error("No results to export"); return; }
    try {
      toast.info("Generating PDF report…");
      await generateBulkPdf(normalizedResults.slice(0, 100), getExportFilters());
      toast.success("PDF report downloaded!");
    } catch { toast.error("PDF export failed"); }
  }

  async function exportZip() {
    if (normalizedResults.length === 0) { toast.error("No results to export"); return; }
    setIsZipping(true);
    setZipProgress(0);
    try {
      toast.info(`Generating ZIP for ${normalizedResults.length} students…`);
      await generateBulkZip(normalizedResults, getExportFilters(), (pct) => setZipProgress(pct));
      toast.success("ZIP archive downloaded!");
    } catch { toast.error("ZIP export failed"); }
    finally { setIsZipping(false); setZipProgress(0); }
  }

  async function printIndividualReport(r: ResultRow) {
    try {
      const normalized = normalizeResults([r], tenantNameOf, passThreshold);
      if (normalized[0]) {
        toast.info("Generating PDF…");
        await generateStudentPdf(normalized[0]);
        toast.success("Individual PDF downloaded!");
      }
    } catch { toast.error("PDF generation failed"); }
  }

  /* ─────────────────────── RENDER ─────────────────────── */
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Reports &amp; Student Analysis</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance analytics, rankings, individual analysis and proctoring violations across colleges.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl" onClick={exportCsv}>
            <Download className="size-4" /> CSV
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={exportExcel}>
            <FileSpreadsheet className="size-4" /> Excel
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={exportPdf} disabled={normalizedResults.length === 0}>
            <FileText className="size-4" /> PDF
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={exportZip} disabled={isZipping || normalizedResults.length === 0}>
            <Download className="size-4" /> {isZipping ? `ZIP ${zipProgress}%` : "ZIP All"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="rounded-2xl">
        <CardContent className="grid gap-3 p-4 md:grid-cols-7">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="rounded-xl pl-9" placeholder="Search name, email, roll…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search students" />
          </div>
          {!scopedTenantId ? (
            <Select value={tenantFilter} onValueChange={setTenantFilter}>
              <SelectTrigger className="rounded-xl" aria-label="Filter by college"><SelectValue placeholder="All colleges" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All colleges</SelectItem>
                {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by year"><SelectValue placeholder="All years" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {ALLOWED_YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by department"><SelectValue placeholder="All departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={assessmentFilter} onValueChange={setAssessmentFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by assessment"><SelectValue placeholder="All assessments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assessments ({(resultsQ.data ?? []).length} results)</SelectItem>
              {assessmentOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by type"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="mcq">MCQ</SelectItem>
              <SelectItem value="coding">Coding</SelectItem>
              <SelectItem value="multisection">Multi-Section</SelectItem>
            </SelectContent>
          </Select>
          <Select value={courseFilter} onValueChange={setCourseFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by course"><SelectValue placeholder="All courses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All courses</SelectItem>
              {(coursesQ.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Label htmlFor="pass-threshold" className="whitespace-nowrap text-xs text-muted-foreground">Pass ≥</Label>
            <Input id="pass-threshold" type="number" min={0} max={100} className="rounded-xl" value={passThreshold} onChange={(e) => setPassThreshold(Number(e.target.value) || 0)} aria-label="Pass threshold" />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl h-auto flex-wrap">
          <TabsTrigger value="overview" className="rounded-lg"><ClipboardList className="mr-1.5 size-3.5" />Overview</TabsTrigger>
          <TabsTrigger value="rank" className="rounded-lg"><Award className="mr-1.5 size-3.5" />Rank list</TabsTrigger>
          <TabsTrigger value="individual" className="rounded-lg"><FileText className="mr-1.5 size-3.5" />Individual</TabsTrigger>
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
                          <TableHead>Name</TableHead><TableHead>Roll</TableHead><TableHead>College</TableHead>
                          <TableHead>Dept</TableHead><TableHead>Year</TableHead><TableHead>Assessment</TableHead>
                          <TableHead>Score</TableHead><TableHead>%</TableHead><TableHead>Result</TableHead>
                          <TableHead>Violations</TableHead><TableHead>Submitted</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredResults.slice(0, 300).map((r) => (
                          <TableRow key={r.path}>
                            <TableCell className="font-medium">{r.displayName || r.email}</TableCell>
                            <TableCell>{r.rollNumber || "—"}</TableCell>
                            <TableCell>{tenantNameOf.get(r.tenantId) ?? r.tenantId}</TableCell>
                            <TableCell>{r.department || "—"}</TableCell>
                            <TableCell>{normaliseYear(r.cohortId) ?? "—"}</TableCell>
                            <TableCell className="max-w-40 truncate">{r.assessmentTitle}</TableCell>
                            <TableCell>{r.totalScore}/{r.maxScore}</TableCell>
                            <TableCell>{pf.format(r.percentage)}%</TableCell>
                            <TableCell>{r.percentage >= passThreshold ? <Badge className="rounded-full text-[10px]">Pass</Badge> : <Badge variant="destructive" className="rounded-full text-[10px]">Fail</Badge>}</TableCell>
                            <TableCell>{r.violations || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.submittedAt?.toLocaleDateString() ?? "—"}</TableCell>
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
                          <TableHead>Rank</TableHead><TableHead>Student</TableHead><TableHead>Roll</TableHead>
                          <TableHead>College</TableHead><TableHead>Year</TableHead><TableHead>Dept</TableHead>
                          <TableHead>Assessment</TableHead><TableHead>Score</TableHead><TableHead>%</TableHead>
                          <TableHead>Submitted</TableHead><TableHead>Violations</TableHead><TableHead>Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ranked.slice(0, 500).map((r) => (
                          <TableRow key={r.path}>
                            <TableCell>{medalBadge(r.rank)}</TableCell>
                            <TableCell className="font-medium">{r.displayName || r.email}</TableCell>
                            <TableCell>{r.rollNumber || "—"}</TableCell>
                            <TableCell>{tenantNameOf.get(r.tenantId) ?? r.tenantId}</TableCell>
                            <TableCell>{normaliseYear(r.cohortId) ?? "—"}</TableCell>
                            <TableCell>{r.department || "—"}</TableCell>
                            <TableCell className="max-w-40 truncate">{r.assessmentTitle}</TableCell>
                            <TableCell>{r.totalScore}/{r.maxScore}</TableCell>
                            <TableCell>{pf.format(r.percentage)}%</TableCell>
                            <TableCell className="whitespace-nowrap">{r.submittedAt?.toLocaleDateString() ?? "—"}</TableCell>
                            <TableCell>{r.violations}</TableCell>
                            <TableCell>{r.percentage >= passThreshold ? <Badge className="rounded-full text-[10px]">Pass</Badge> : <Badge variant="destructive" className="rounded-full text-[10px]">Fail</Badge>}</TableCell>
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
                <Button size="sm" variant="outline" className="rounded-xl h-7 text-xs" onClick={exportCsv}>
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
                            <Button size="icon" variant="ghost" className="size-7 rounded-lg" title="Download individual PDF"
                              onClick={() => printIndividualReport(r)}>
                              <Printer className="size-3.5" />
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

      </Tabs>
    </div>
  );
}
