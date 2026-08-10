import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
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
  Medal,
  Printer,
  Search,
  ShieldAlert,
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
import { listResults, type ResultRow } from "@/lib/firestore/results";
import { listProctorEvents } from "@/lib/firestore/proctoring";
import { listTenants } from "@/lib/firestore/tenants";
import { listAssessments } from "@/lib/firestore/assessments";
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
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Target;
  loading: boolean;
}) {
  return (
    <Card className="glass-panel rounded-2xl">
      <CardContent className="flex items-start gap-4 p-5">
        <span className="brand-gradient flex size-11 shrink-0 items-center justify-center rounded-xl text-primary-foreground">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
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
    return (
      <Badge className="rounded-full border-transparent bg-chart-4 text-primary-foreground">
        <Medal className="mr-1 size-3" /> 1st
      </Badge>
    );
  if (rank === 2)
    return (
      <Badge variant="secondary" className="rounded-full">
        <Medal className="mr-1 size-3" /> 2nd
      </Badge>
    );
  if (rank === 3)
    return (
      <Badge variant="outline" className="rounded-full">
        <Medal className="mr-1 size-3" /> 3rd
      </Badge>
    );
  return <span className="text-sm text-muted-foreground">#{rank}</span>;
}

function printRows(title: string, headers: string[], rows: (string | number)[][]) {
  const win = window.open("", "_blank", "width=1000,height=700");
  if (!win) {
    toast.error("Pop-up blocked — allow pop-ups to export PDF");
    return;
  }
  const style = `
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 24px; color: #111; }
    h1 { font-size: 18px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f2f2f2; }
  `;
  const body = `
    <h1>${title}</h1>
    <table>
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
        .join("")}</tbody>
    </table>`;
  win.document.write(`<!doctype html><html><head><title>${title}</title><style>${style}</style></head><body>${body}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

const BUCKETS = ["0-20", "20-40", "40-60", "60-80", "80-100"];

function ReportsPage() {
  const { scopedTenantId } = useAuth();

  const [tenantFilter, setTenantFilter] = useState(scopedTenantId || "all");
  const [yearFilter, setYearFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [assessmentFilter, setAssessmentFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [passThreshold, setPassThreshold] = useState(40);
  const [tab, setTab] = useState("overview");

  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const assessmentsQ = useQuery({ queryKey: ["assessments"], queryFn: listAssessments });
  const resultsQ = useQuery({ queryKey: ["results", "reports"], queryFn: () => listResults(3000) });
  const eventsQ = useQuery({ queryKey: ["proctor-events", "reports"], queryFn: () => listProctorEvents(3000) });

  const loading = resultsQ.isLoading || assessmentsQ.isLoading || tenantsQ.isLoading;

  if (resultsQ.isError || eventsQ.isError || tenantsQ.isError || assessmentsQ.isError) {
    toast.error("Some report data failed to load");
  }

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
      if (!q) return true;
      return [r.displayName, r.email, r.rollNumber].filter(Boolean).some((f) =>
        String(f).toLowerCase().includes(q),
      );
    });
  }, [resultsQ.data, effectiveTenant, yearFilter, deptFilter, assessmentFilter, search]);

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

  // KPIs
  const kpis = useMemo(() => {
    const rows = filteredResults;
    const attempts = rows.length;
    const avg = attempts ? rows.reduce((s, r) => s + r.percentage, 0) / attempts : 0;
    const passed = rows.filter((r) => r.percentage >= passThreshold).length;
    const passRate = attempts ? (passed / attempts) * 100 : 0;
    const highest = attempts ? Math.max(...rows.map((r) => r.percentage)) : 0;
    const lowest = attempts ? Math.min(...rows.map((r) => r.percentage)) : 0;
    const flagged = new Set(rows.filter((r) => r.violations > 0).map((r) => r.userId)).size;
    return { attempts, avg, passRate, highest, lowest, flagged };
  }, [filteredResults, passThreshold]);

  const byCollege = useMemo(() => {
    const map = new Map<string, { sum: number; count: number }>();
    for (const r of filteredResults) {
      const key = tenantNameOf.get(r.tenantId) ?? r.tenantId || "Unknown";
      const cur = map.get(key) ?? { sum: 0, count: 0 };
      cur.sum += r.percentage;
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([college, v]) => ({ college, avg: v.count ? Math.round((v.sum / v.count) * 10) / 10 : 0 }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10);
  }, [filteredResults, tenantNameOf]);

  const byDepartment = useMemo(() => {
    const map = new Map<string, { sum: number; count: number }>();
    for (const r of filteredResults) {
      const key = r.department || "Unassigned";
      const cur = map.get(key) ?? { sum: 0, count: 0 };
      cur.sum += r.percentage;
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([department, v]) => ({ department, avg: v.count ? Math.round((v.sum / v.count) * 10) / 10 : 0 }))
      .sort((a, b) => b.avg - a.avg);
  }, [filteredResults]);

  const submissionsOverTime = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredResults) {
      if (!r.submittedAt) continue;
      const key = r.submittedAt.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-21)
      .map(([date, submissions]) => ({
        date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        submissions,
      }));
  }, [filteredResults]);

  const distribution = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    for (const r of filteredResults) {
      const p = Math.min(99.99, Math.max(0, r.percentage));
      const idx = Math.min(4, Math.floor(p / 20));
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    return BUCKETS.map((bucket, i) => ({ bucket, count: counts[i] ?? 0 }));
  }, [filteredResults]);

  // Rank list
  const ranked = useMemo(() => {
    return [...filteredResults]
      .sort((a, b) => b.percentage - a.percentage)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [filteredResults]);

  // Violation charts
  const violationsByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredEvents) map.set(e.type, (map.get(e.type) ?? 0) + 1);
    return [...map.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [filteredEvents]);

  const severitySummary = useMemo(() => {
    const map = { low: 0, medium: 0, high: 0 };
    for (const e of filteredEvents) map[e.severity] += 1;
    return map;
  }, [filteredEvents]);

  async function exportExcel() {
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.utils.book_new();
      if (tab === "overview") {
        const sheet = XLSX.utils.json_to_sheet(
          filteredResults.map((r) => ({
            Student: r.displayName,
            Email: r.email,
            Roll: r.rollNumber,
            College: tenantNameOf.get(r.tenantId) ?? r.tenantId,
            Department: r.department,
            Assessment: r.assessmentTitle,
            Score: r.totalScore,
            Max: r.maxScore,
            Percentage: pf.format(r.percentage),
            Submitted: r.submittedAt?.toISOString() ?? "",
            Violations: r.violations,
          })),
        );
        XLSX.utils.book_append_sheet(book, sheet, "Overview");
      } else if (tab === "rank") {
        const sheet = XLSX.utils.json_to_sheet(
          ranked.map((r) => ({
            Rank: r.rank,
            Student: r.displayName,
            Roll: r.rollNumber,
            College: tenantNameOf.get(r.tenantId) ?? r.tenantId,
            Year: normaliseYear(r.cohortId) ?? "",
            Department: r.department,
            Assessment: r.assessmentTitle,
            Score: `${r.totalScore}/${r.maxScore}`,
            Percentage: pf.format(r.percentage),
            Submitted: r.submittedAt?.toLocaleDateString() ?? "",
            Violations: r.violations,
            Result: r.percentage >= passThreshold ? "Pass" : "Fail",
          })),
        );
        XLSX.utils.book_append_sheet(book, sheet, "Rank list");
      } else {
        const sheet = XLSX.utils.json_to_sheet(
          filteredEvents.map((e) => ({
            Timestamp: e.at?.toISOString() ?? "",
            Student: e.displayName,
            Email: e.email,
            Assessment: e.assessmentTitle,
            Type: e.type,
            Severity: e.severity,
            Detail: e.detail,
          })),
        );
        XLSX.utils.book_append_sheet(book, sheet, "Violations");
      }
      XLSX.writeFile(book, `seed-it-reports-${tab}-${Date.now()}.xlsx`);
      toast.success("Excel export ready");
    } catch {
      toast.error("Excel export failed");
    }
  }

  function exportPdf() {
    if (tab === "overview") {
      printRows(
        "Performance Overview",
        ["Student", "College", "Department", "Assessment", "Score", "%", "Submitted"],
        filteredResults.map((r) => [
          r.displayName,
          tenantNameOf.get(r.tenantId) ?? r.tenantId,
          r.department,
          r.assessmentTitle,
          `${r.totalScore}/${r.maxScore}`,
          pf.format(r.percentage),
          r.submittedAt?.toLocaleDateString() ?? "—",
        ]),
      );
    } else if (tab === "rank") {
      printRows(
        "Rank List",
        ["Rank", "Student", "Roll", "College", "Assessment", "Score", "%", "Result"],
        ranked.map((r) => [
          r.rank,
          r.displayName,
          r.rollNumber,
          tenantNameOf.get(r.tenantId) ?? r.tenantId,
          r.assessmentTitle,
          `${r.totalScore}/${r.maxScore}`,
          pf.format(r.percentage),
          r.percentage >= passThreshold ? "Pass" : "Fail",
        ]),
      );
    } else {
      printRows(
        "Proctoring Violations",
        ["Timestamp", "Student", "Assessment", "Type", "Severity", "Detail"],
        filteredEvents.map((e) => [
          e.at?.toLocaleString() ?? "—",
          e.displayName,
          e.assessmentTitle,
          e.type,
          e.severity,
          e.detail,
        ]),
      );
    }
    toast.success("Opening printable PDF view");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Reports & Student Analysis</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance, rankings and proctoring violation history across colleges.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl" onClick={exportExcel}>
            <FileSpreadsheet className="size-4" />
            Export Excel
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={exportPdf}>
            <Printer className="size-4" />
            Export PDF
          </Button>
        </div>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-xl pl-9"
              placeholder="Search name, email, roll…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search students"
            />
          </div>
          {!scopedTenantId ? (
            <Select value={tenantFilter} onValueChange={setTenantFilter}>
              <SelectTrigger className="rounded-xl" aria-label="Filter by college">
                <SelectValue placeholder="All colleges" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All colleges</SelectItem>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by academic year">
              <SelectValue placeholder="All years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {ALLOWED_YEARS.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by department">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assessmentFilter} onValueChange={setAssessmentFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by assessment">
              <SelectValue placeholder="All assessments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assessments</SelectItem>
              {assessments.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Label htmlFor="pass-threshold" className="whitespace-nowrap text-xs text-muted-foreground">
              Pass ≥
            </Label>
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
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl">
          <TabsTrigger value="overview" className="rounded-lg">
            Performance overview
          </TabsTrigger>
          <TabsTrigger value="rank" className="rounded-lg">
            Rank list
          </TabsTrigger>
          <TabsTrigger value="violations" className="rounded-lg">
            Proctoring violations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard label="Attempts" value={nf.format(kpis.attempts)} hint="Total submitted results" icon={ClipboardList} loading={loading} />
            <KpiCard label="Average score" value={`${pf.format(kpis.avg)}%`} hint="Across filtered attempts" icon={Target} loading={loading} />
            <KpiCard label="Pass rate" value={`${pf.format(kpis.passRate)}%`} hint={`Threshold ≥ ${passThreshold}%`} icon={Award} loading={loading} />
            <KpiCard label="Highest score" value={`${pf.format(kpis.highest)}%`} hint="Best performance" icon={TrendingUp} loading={loading} />
            <KpiCard label="Lowest score" value={`${pf.format(kpis.lowest)}%`} hint="Weakest performance" icon={TrendingDown} loading={loading} />
            <KpiCard label="Flagged students" value={nf.format(kpis.flagged)} hint="Have ≥1 proctoring violation" icon={ShieldAlert} loading={loading} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Average % by college</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {loading ? (
                  <Skeleton className="size-full rounded-xl" />
                ) : byCollege.length === 0 ? (
                  <EmptyChart message="No results for these filters." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byCollege} margin={{ left: -20, top: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                      <XAxis dataKey="college" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} interval={0} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                      <Bar dataKey="avg" name="Avg %" fill="var(--color-chart-1)" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Average % by department</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {loading ? (
                  <Skeleton className="size-full rounded-xl" />
                ) : byDepartment.length === 0 ? (
                  <EmptyChart message="No results for these filters." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byDepartment} margin={{ left: -20, top: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                      <XAxis dataKey="department" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} interval={0} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                      <Bar dataKey="avg" name="Avg %" fill="var(--color-chart-2)" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Submissions over time</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {loading ? (
                  <Skeleton className="size-full rounded-xl" />
                ) : submissionsOverTime.length === 0 ? (
                  <EmptyChart message="No submissions recorded yet." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={submissionsOverTime} margin={{ left: -20, top: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                      <Area type="monotone" dataKey="submissions" stroke="var(--color-chart-3)" fill="var(--color-chart-3)" fillOpacity={0.25} strokeWidth={2.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Score distribution</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {loading ? (
                  <Skeleton className="size-full rounded-xl" />
                ) : filteredResults.length === 0 ? (
                  <EmptyChart message="No results for these filters." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={distribution} margin={{ left: -20, top: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                      <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                      <Bar dataKey="count" name="Students" fill="var(--color-chart-4)" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="rank" className="mt-4">
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Rank list ({nf.format(ranked.length)})</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {loading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-10 rounded-xl" />
                  ))}
                </div>
              ) : ranked.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No results match these filters.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Roll</TableHead>
                      <TableHead>College</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Assessment</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>%</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Violations</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ranked.map((r) => (
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
                        <TableCell>{r.submittedAt?.toLocaleDateString() ?? "—"}</TableCell>
                        <TableCell>{r.violations}</TableCell>
                        <TableCell>
                          {r.percentage >= passThreshold ? (
                            <Badge className="rounded-full">Pass</Badge>
                          ) : (
                            <Badge variant="destructive" className="rounded-full">Fail</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="violations" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Low severity" value={nf.format(severitySummary.low)} hint="Minor flags" icon={ShieldAlert} loading={eventsQ.isLoading} />
            <KpiCard label="Medium severity" value={nf.format(severitySummary.medium)} hint="Needs review" icon={ShieldAlert} loading={eventsQ.isLoading} />
            <KpiCard label="High severity" value={nf.format(severitySummary.high)} hint="Likely malpractice" icon={ShieldAlert} loading={eventsQ.isLoading} />
          </div>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Violations by type</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {eventsQ.isLoading ? (
                <Skeleton className="size-full rounded-xl" />
              ) : violationsByType.length === 0 ? (
                <EmptyChart message="No proctoring events recorded." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={violationsByType} margin={{ left: -20, top: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                    <XAxis dataKey="type" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} interval={0} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }} />
                    <Bar dataKey="count" name="Events" fill="var(--color-destructive)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Violation log ({nf.format(filteredEvents.length)})</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {eventsQ.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 rounded-xl" />
                  ))}
                </div>
              ) : filteredEvents.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No violations match these filters.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Assessment</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEvents.slice(0, 500).map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>{e.at?.toLocaleString() ?? "—"}</TableCell>
                        <TableCell className="font-medium">{e.displayName || e.email}</TableCell>
                        <TableCell className="max-w-40 truncate">{e.assessmentTitle || e.assessmentId}</TableCell>
                        <TableCell>{e.type}</TableCell>
                        <TableCell>
                          <Badge variant={SEVERITY_VARIANT[e.severity]} className="rounded-full capitalize">
                            {e.severity}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-64 truncate">{e.detail || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
