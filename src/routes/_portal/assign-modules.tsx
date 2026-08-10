import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Layers, ListChecks, Loader2, Search } from "lucide-react";
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
import { listAssessments, type AssessmentDoc } from "@/lib/firestore/assessments";
import { listCohorts, listTenants, setAllowedModules } from "@/lib/firestore/tenants";
import { ALLOWED_YEARS, type AssessmentType } from "@/types/seedit";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_portal/assign-modules")({
  head: () => ({
    meta: [
      { title: "Module Assignment Matrix | SEED-IT Admin" },
      { name: "description", content: "Assign assessment modules to college cohorts." },
      { property: "og:title", content: "Module Assignment Matrix | SEED-IT Admin" },
      { property: "og:description", content: "Assign assessment modules to college cohorts." },
    ],
  }),
  component: AssignModulesPage,
});

const TYPE_LABELS: Record<AssessmentType, string> = {
  mcq: "MCQ",
  coding: "Coding",
  multisection: "Multi-section",
  "spoken-english": "Spoken English",
};

function TypeBadge({ type }: { type: AssessmentType }) {
  return (
    <Badge variant="secondary" className="rounded-full text-[10px]">
      {TYPE_LABELS[type] ?? type}
    </Badge>
  );
}

function AssignModulesPage() {
  const qc = useQueryClient();
  const { scopedTenantId } = useAuth();

  const [tenantId, setTenantId] = useState(scopedTenantId ?? "");
  const [cohortId, setCohortId] = useState("");
  const [assigned, setAssigned] = useState<string[] | null>(null);
  const [yearFilter, setYearFilter] = useState<string>("all");

  const [availSearch, setAvailSearch] = useState("");
  const [availType, setAvailType] = useState<string>("all");
  const [assignedSearch, setAssignedSearch] = useState("");
  const [assignedType, setAssignedType] = useState<string>("all");
  const [availSelected, setAvailSelected] = useState<Set<string>>(new Set());
  const [assignedSelected, setAssignedSelected] = useState<Set<string>>(new Set());

  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const assessmentsQ = useQuery({ queryKey: ["assessments"], queryFn: listAssessments });

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

  const assessments = assessmentsQ.data ?? [];
  const assessmentMap = useMemo(() => new Map(assessments.map((a) => [a.id, a])), [assessments]);

  const availableAssessments = useMemo(() => {
    const q = availSearch.trim().toLowerCase();
    return assessments.filter((a) => {
      if (currentAllowed.includes(a.id)) return false;
      if (availType !== "all" && a.type !== availType) return false;
      if (!q) return true;
      return a.title.toLowerCase().includes(q);
    });
  }, [assessments, currentAllowed, availSearch, availType]);

  const assignedAssessments = useMemo(() => {
    const q = assignedSearch.trim().toLowerCase();
    return currentAllowed
      .map((id) => assessmentMap.get(id))
      .filter((a): a is AssessmentDoc => Boolean(a))
      .filter((a) => {
        if (assignedType !== "all" && a.type !== assignedType) return false;
        if (!q) return true;
        return a.title.toLowerCase().includes(q);
      });
  }, [currentAllowed, assessmentMap, assignedSearch, assignedType]);

  function selectCohort(id: string) {
    setCohortId(id);
    setAssigned(null);
    setAvailSelected(new Set());
    setAssignedSelected(new Set());
  }

  function addIds(ids: string[]) {
    setAssigned((prev) => {
      const base = prev ?? activeCohort?.allowedModules ?? [];
      const merged = new Set(base);
      ids.forEach((id) => merged.add(id));
      return [...merged];
    });
    setAvailSelected(new Set());
  }

  function removeIds(ids: string[]) {
    setAssigned((prev) => {
      const base = prev ?? activeCohort?.allowedModules ?? [];
      return base.filter((id) => !ids.includes(id));
    });
    setAssignedSelected(new Set());
  }

  const syncMutation = useMutation({
    mutationFn: () => setAllowedModules(effectiveTenantId, cohortId, currentAllowed),
    onSuccess: () => {
      toast.success("Module assignment synced");
      setAssigned(null);
      void qc.invalidateQueries({ queryKey: ["cohorts", effectiveTenantId] });
    },
    onError: () => toast.error("Could not sync assignment"),
  });

  const matrixCounts = useMemo(() => {
    return (cohortsQ.data ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      year: c.year,
      count: c.id === cohortId && assigned !== null ? assigned.length : c.allowedModules.length,
    }));
  }, [cohortsQ.data, cohortId, assigned]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Module Assignment Matrix</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a college and cohort, then move assessments between available and assigned.
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="am-tenant">College</Label>
            {scopedTenantId ? (
              <Input
                id="am-tenant"
                className="rounded-xl"
                value={tenants.find((t) => t.id === scopedTenantId)?.name ?? scopedTenantId}
                disabled
              />
            ) : (
              <Select
                value={tenantId}
                onValueChange={(v) => {
                  setTenantId(v);
                  selectCohort("");
                }}
              >
                <SelectTrigger id="am-tenant" className="rounded-xl" aria-label="Select college">
                  <SelectValue placeholder="Select a college" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="am-year">Academic year</Label>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger id="am-year" className="rounded-xl" aria-label="Filter cohorts by year">
                <SelectValue placeholder="All years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {ALLOWED_YEARS.map((y) => (
                  <SelectItem key={y} value={y} className="font-mono">
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="am-cohort">Cohort</Label>
            <Select value={cohortId} onValueChange={selectCohort} disabled={!effectiveTenantId}>
              <SelectTrigger id="am-cohort" className="rounded-xl" aria-label="Select cohort">
                <SelectValue placeholder="Select a cohort" />
              </SelectTrigger>
              <SelectContent>
                {cohorts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label} • {c.allowedModules.length} modules
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!effectiveTenantId || !cohortId ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <ListChecks className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Select a college and cohort above to manage its assigned modules.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full">
                <Layers className="mr-1 size-3" />
                {currentAllowed.length} assigned
              </Badge>
              {dirty ? (
                <Badge variant="destructive" className="rounded-full text-[11px]">
                  Unsaved changes
                </Badge>
              ) : null}
            </div>
            <Button
              className="rounded-xl"
              disabled={!dirty || syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
            >
              {syncMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowLeftRight className="size-4" />
              )}
              Sync assignment
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Available assessments
                  <Badge variant="secondary" className="ml-2 rounded-full text-[11px]">
                    {availableAssessments.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="rounded-xl pl-9"
                      placeholder="Search available…"
                      value={availSearch}
                      onChange={(e) => setAvailSearch(e.target.value)}
                      aria-label="Search available assessments"
                    />
                  </div>
                  <Select value={availType} onValueChange={setAvailType}>
                    <SelectTrigger className="w-36 rounded-xl" aria-label="Filter available by type">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="mcq">MCQ</SelectItem>
                      <SelectItem value="coding">Coding</SelectItem>
                      <SelectItem value="spoken-english">Spoken English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={availSelected.size === 0}
                    onClick={() => addIds([...availSelected])}
                  >
                    <ArrowRight className="size-3.5" />
                    Add selected
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={availableAssessments.length === 0}
                    onClick={() => addIds(availableAssessments.map((a) => a.id))}
                  >
                    Add all
                  </Button>
                </div>
                <div className="max-h-96 space-y-1 overflow-y-auto rounded-xl border p-2">
                  {assessmentsQ.isLoading ? (
                    [0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)
                  ) : availableAssessments.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Nothing to show.</p>
                  ) : (
                    availableAssessments.map((a) => {
                      const checked = availSelected.has(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() =>
                            setAvailSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.id)) next.delete(a.id);
                              else next.add(a.id);
                              return next;
                            })
                          }
                          className={`flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-left transition-colors ${
                            checked ? "border-primary bg-primary-muted" : "border-transparent hover:bg-muted/60"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{a.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {a.durationMinutes} min • {a.totalMarks} marks
                            </p>
                          </div>
                          <TypeBadge type={a.type} />
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
                  <Badge variant="secondary" className="ml-2 rounded-full text-[11px]">
                    {assignedAssessments.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="rounded-xl pl-9"
                      placeholder="Search assigned…"
                      value={assignedSearch}
                      onChange={(e) => setAssignedSearch(e.target.value)}
                      aria-label="Search assigned assessments"
                    />
                  </div>
                  <Select value={assignedType} onValueChange={setAssignedType}>
                    <SelectTrigger className="w-36 rounded-xl" aria-label="Filter assigned by type">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="mcq">MCQ</SelectItem>
                      <SelectItem value="coding">Coding</SelectItem>
                      <SelectItem value="spoken-english">Spoken English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={assignedSelected.size === 0}
                    onClick={() => removeIds([...assignedSelected])}
                  >
                    <ArrowLeft className="size-3.5" />
                    Remove selected
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={assignedAssessments.length === 0}
                    onClick={() => removeIds(assignedAssessments.map((a) => a.id))}
                  >
                    Remove all
                  </Button>
                </div>
                <div className="max-h-96 space-y-1 overflow-y-auto rounded-xl border p-2">
                  {assignedAssessments.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No modules assigned to this cohort yet.
                    </p>
                  ) : (
                    assignedAssessments.map((a) => {
                      const checked = assignedSelected.has(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() =>
                            setAssignedSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.id)) next.delete(a.id);
                              else next.add(a.id);
                              return next;
                            })
                          }
                          className={`flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-left transition-colors ${
                            checked ? "border-primary bg-primary-muted" : "border-transparent hover:bg-muted/60"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{a.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {a.durationMinutes} min • {a.totalMarks} marks
                            </p>
                          </div>
                          <TypeBadge type={a.type} />
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
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Cohort overview</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {cohortsQ.isLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-10 rounded-xl" />
                ))}
              </div>
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
                      <tr key={c.id} className={c.id === cohortId ? "bg-primary-muted/50" : ""}>
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
