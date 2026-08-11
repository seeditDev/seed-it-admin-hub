import { useMemo, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, BookOpen,
  Layers, ListChecks, Loader2, Search,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listCohorts, listTenants, setAllowedModules } from "@/lib/firestore/tenants";
import { listCourses, listSeries, listTests, type TestDoc } from "@/lib/firestore/courses";
import { ALLOWED_YEARS } from "@/types/seedit";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_portal/assign-modules")({
  head: () => ({
    meta: [
      { title: "Module Assignment Matrix | SEED-IT Admin" },
      { name: "description", content: "Assign assessment tests from courses to college cohorts." },
      { property: "og:title", content: "Module Assignment Matrix | SEED-IT Admin" },
    ],
  }),
  component: AssignModulesPage,
});

function typeBadgeClass(type: string) {
  if (type === "coding") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  if (type === "mcq") return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (type === "msa") return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
  return "bg-muted text-muted-foreground";
}

interface TestEntry {
  testId: string;
  testName: string;
  testType: string;
  durationMinutes: number;
  totalMarks: number;
  courseId: string;
  courseTitle: string;
  seriesId: string;
  seriesTitle: string;
  moduleKey: string;
}

function makeKey(courseId: string, seriesId: string, testId: string) {
  return courseId + "::" + seriesId + "::" + testId;
}

function parseKey(key: string): { courseId: string; seriesId: string; testId: string } | null {
  const parts = key.split("::");
  if (parts.length !== 3) return null;
  return { courseId: parts[0]!, seriesId: parts[1]!, testId: parts[2]! };
}

function AssignModulesPage() {
  const qc = useQueryClient();
  const { scopedTenantId } = useAuth();

  const [tenantId, setTenantId] = useState(scopedTenantId ?? "");
  const [cohortId, setCohortId] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [assigned, setAssigned] = useState<string[] | null>(null);

  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [seriesTests, setSeriesTests] = useState<TestDoc[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);

  const [availSearch, setAvailSearch] = useState("");
  const [assignedSearch, setAssignedSearch] = useState("");
  const [availSelected, setAvailSelected] = useState<Set<string>>(new Set());
  const [assignedSelected, setAssignedSelected] = useState<Set<string>>(new Set());

  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const coursesQ = useQuery({ queryKey: ["courses"], queryFn: listCourses });

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const effectiveTenantId = scopedTenantId || tenantId;

  const cohortsQ = useQuery({
    queryKey: ["cohorts", effectiveTenantId],
    queryFn: () => listCohorts(effectiveTenantId),
    enabled: Boolean(effectiveTenantId),
  });

  const seriesQ = useQuery({
    queryKey: ["series", selectedCourseId],
    queryFn: () => listSeries(selectedCourseId),
    enabled: Boolean(selectedCourseId),
  });

  const cohorts = useMemo(() => {
    const list = cohortsQ.data ?? [];
    return yearFilter === "all" ? list : list.filter((c) => c.year === yearFilter);
  }, [cohortsQ.data, yearFilter]);

  const activeCohort = cohorts.find((c) => c.id === cohortId) ?? null;
  const currentAllowed = assigned ?? activeCohort?.allowedModules ?? [];
  const dirty =
    assigned !== null &&
    activeCohort !== null &&
    JSON.stringify([...assigned].sort()) !== JSON.stringify([...activeCohort.allowedModules].sort());

  useEffect(() => {
    if (!selectedCourseId || !selectedSeriesId) { setSeriesTests([]); return; }
    setLoadingTests(true);
    listTests(selectedCourseId, selectedSeriesId)
      .then(setSeriesTests)
      .catch(() => setSeriesTests([]))
      .finally(() => setLoadingTests(false));
  }, [selectedCourseId, selectedSeriesId]);

  const availableEntries = useMemo((): TestEntry[] => {
    const course = (coursesQ.data ?? []).find((c) => c.id === selectedCourseId);
    const series = (seriesQ.data ?? []).find((s) => s.id === selectedSeriesId);
    if (!course || !series) return [];
    const q = availSearch.trim().toLowerCase();
    return seriesTests
      .filter((t) => {
        const key = makeKey(selectedCourseId, selectedSeriesId, t.id);
        if (currentAllowed.includes(key)) return false;
        if (q && !t.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .map((t) => ({
        testId: t.id, testName: t.name, testType: t.type,
        durationMinutes: t.duration_minutes, totalMarks: t.totalMarks,
        courseId: selectedCourseId, courseTitle: course.title,
        seriesId: selectedSeriesId, seriesTitle: series.title,
        moduleKey: makeKey(selectedCourseId, selectedSeriesId, t.id),
      }));
  }, [seriesTests, currentAllowed, selectedCourseId, selectedSeriesId, coursesQ.data, seriesQ.data, availSearch]);

  const assignedEntries = useMemo((): TestEntry[] => {
    const q = assignedSearch.trim().toLowerCase();
    return currentAllowed.map((key) => {
      const parsed = parseKey(key);
      if (!parsed) return null;
      const course = (coursesQ.data ?? []).find((c) => c.id === parsed.courseId);
      return {
        testId: parsed.testId, testName: parsed.testId, testType: "—",
        durationMinutes: 0, totalMarks: 0,
        courseId: parsed.courseId, courseTitle: course?.title ?? parsed.courseId,
        seriesId: parsed.seriesId, seriesTitle: parsed.seriesId,
        moduleKey: key,
      } as TestEntry;
    }).filter((e): e is TestEntry => e !== null)
      .filter((e) => !q || e.testName.toLowerCase().includes(q) || e.courseTitle.toLowerCase().includes(q));
  }, [currentAllowed, coursesQ.data, assignedSearch]);

  function selectCohort(id: string) {
    setCohortId(id); setAssigned(null);
    setAvailSelected(new Set()); setAssignedSelected(new Set());
  }
  function addKeys(keys: string[]) {
    setAssigned((prev) => { const base = prev ?? activeCohort?.allowedModules ?? []; const m = new Set(base); keys.forEach((k) => m.add(k)); return [...m]; });
    setAvailSelected(new Set());
  }
  function removeKeys(keys: string[]) {
    setAssigned((prev) => { const base = prev ?? activeCohort?.allowedModules ?? []; return base.filter((k) => !keys.includes(k)); });
    setAssignedSelected(new Set());
  }

  const syncMutation = useMutation({
    mutationFn: () => setAllowedModules(effectiveTenantId, cohortId, currentAllowed),
    onSuccess: () => { toast.success("Module assignment synced"); setAssigned(null); void qc.invalidateQueries({ queryKey: ["cohorts", effectiveTenantId] }); },
    onError: () => toast.error("Could not sync assignment"),
  });

  const matrixCounts = useMemo(() =>
    (cohortsQ.data ?? []).map((c) => ({
      id: c.id, label: c.label, year: c.year,
      count: c.id === cohortId && assigned !== null ? assigned.length : c.allowedModules.length,
    })),
  [cohortsQ.data, cohortId, assigned]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Module Assignment Matrix</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a college cohort, then pick tests from a Course → Series to assign.
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="am-tenant">College</Label>
            {scopedTenantId ? (
              <Input id="am-tenant" className="rounded-xl" value={tenants.find((t) => t.id === scopedTenantId)?.name ?? scopedTenantId} disabled />
            ) : (
              <Select value={tenantId} onValueChange={(v) => { setTenantId(v); selectCohort(""); }}>
                <SelectTrigger id="am-tenant" className="rounded-xl"><SelectValue placeholder="Select a college" /></SelectTrigger>
                <SelectContent>{tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="am-year">Academic year</Label>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger id="am-year" className="rounded-xl"><SelectValue placeholder="All years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {ALLOWED_YEARS.map((y) => <SelectItem key={y} value={y} className="font-mono">{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="am-cohort">Cohort</Label>
            <Select value={cohortId} onValueChange={selectCohort} disabled={!effectiveTenantId}>
              <SelectTrigger id="am-cohort" className="rounded-xl"><SelectValue placeholder="Select a cohort" /></SelectTrigger>
              <SelectContent>{cohorts.map((c) => <SelectItem key={c.id} value={c.id}>{c.label} • {c.allowedModules.length} modules</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!effectiveTenantId || !cohortId ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <ListChecks className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Select a college and cohort above to manage its assigned modules.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full"><Layers className="mr-1 size-3" />{currentAllowed.length} assigned</Badge>
              {dirty && <Badge variant="destructive" className="rounded-full text-[11px]">Unsaved changes</Badge>}
            </div>
            <Button className="rounded-xl" disabled={!dirty || syncMutation.isPending} onClick={() => syncMutation.mutate()}>
              {syncMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeftRight className="size-4" />}
              Sync assignment
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Available tests
                  <Badge variant="secondary" className="ml-2 rounded-full text-[11px]">{availableEntries.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Course</Label>
                    <Select value={selectedCourseId} onValueChange={(v) => { setSelectedCourseId(v); setSelectedSeriesId(""); setSeriesTests([]); }}>
                      <SelectTrigger className="rounded-xl h-8 text-sm"><SelectValue placeholder="Select course…" /></SelectTrigger>
                      <SelectContent>
                        {coursesQ.isLoading
                          ? <SelectItem value="__loading" disabled>Loading…</SelectItem>
                          : (coursesQ.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}><BookOpen className="inline size-3 mr-1 text-muted-foreground" />{c.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Assessment Series</Label>
                    <Select value={selectedSeriesId} onValueChange={setSelectedSeriesId} disabled={!selectedCourseId}>
                      <SelectTrigger className="rounded-xl h-8 text-sm"><SelectValue placeholder="Select series…" /></SelectTrigger>
                      <SelectContent>
                        {seriesQ.isLoading
                          ? <SelectItem value="__loading" disabled>Loading…</SelectItem>
                          : (seriesQ.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="rounded-xl pl-9" placeholder="Search tests…" value={availSearch} onChange={(e) => setAvailSearch(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="rounded-xl" disabled={availSelected.size === 0} onClick={() => addKeys([...availSelected])}>
                    <ArrowRight className="size-3.5" /> Add selected
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl" disabled={availableEntries.length === 0} onClick={() => addKeys(availableEntries.map((e) => e.moduleKey))}>
                    Add all
                  </Button>
                </div>
                <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border p-2">
                  {loadingTests ? (
                    [0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)
                  ) : !selectedCourseId || !selectedSeriesId ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Select a Course and Series above to see available tests.</p>
                  ) : availableEntries.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No unassigned tests in this series.</p>
                  ) : (
                    availableEntries.map((e) => {
                      const checked = availSelected.has(e.moduleKey);
                      return (
                        <button key={e.moduleKey} type="button"
                          onClick={() => setAvailSelected((prev) => { const next = new Set(prev); if (next.has(e.moduleKey)) next.delete(e.moduleKey); else next.add(e.moduleKey); return next; })}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-left transition-colors ${checked ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/60"}`}>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{e.testName}</p>
                            <p className="text-xs text-muted-foreground">{e.durationMinutes} min • {e.totalMarks} marks</p>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${typeBadgeClass(e.testType)}`}>{e.testType.toUpperCase()}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Assigned modules
                  <Badge variant="secondary" className="ml-2 rounded-full text-[11px]">{currentAllowed.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="rounded-xl pl-9" placeholder="Search assigned…" value={assignedSearch} onChange={(e) => setAssignedSearch(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="rounded-xl" disabled={assignedSelected.size === 0} onClick={() => removeKeys([...assignedSelected])}>
                    <ArrowLeft className="size-3.5" /> Remove selected
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl" disabled={assignedEntries.length === 0} onClick={() => removeKeys(assignedEntries.map((e) => e.moduleKey))}>
                    Remove all
                  </Button>
                </div>
                <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border p-2">
                  {currentAllowed.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No modules assigned to this cohort yet.</p>
                  ) : (
                    assignedEntries.map((e) => {
                      const checked = assignedSelected.has(e.moduleKey);
                      return (
                        <button key={e.moduleKey} type="button"
                          onClick={() => setAssignedSelected((prev) => { const next = new Set(prev); if (next.has(e.moduleKey)) next.delete(e.moduleKey); else next.add(e.moduleKey); return next; })}
                          className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors ${checked ? "border-destructive bg-destructive/10" : "border-transparent hover:bg-muted/60"}`}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{e.testName !== e.testId ? e.testName : e.moduleKey}</p>
                            <p className="text-xs text-muted-foreground truncate">{e.courseTitle} › {e.seriesTitle}</p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {effectiveTenantId ? (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Cohort overview</CardTitle></CardHeader>
          <CardContent className="p-0">
            {cohortsQ.isLoading ? (
              <div className="space-y-2 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
            ) : matrixCounts.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No cohorts for this college yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Cohort</th>
                      <th className="px-4 py-2 text-left font-medium">Year</th>
                      <th className="px-4 py-2 text-right font-medium">Assigned modules</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {matrixCounts.map((c) => (
                      <tr key={c.id} className={c.id === cohortId ? "bg-primary/5" : ""}>
                        <td className="px-4 py-2 font-medium">{c.label}</td>
                        <td className="px-4 py-2 font-mono">{c.year}</td>
                        <td className="px-4 py-2 text-right">{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
