import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarRange,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  deleteCohort,
  deleteTenant,
  listCohorts,
  listTenants,
  upsertCohort,
  upsertTenant,
} from "@/lib/firestore/tenants";
import { listAllUsers } from "@/lib/firestore/users";
import {
  ALLOWED_YEARS,
  DEFAULT_TENANT_SETTINGS,
  DEPARTMENTS,
  YEAR_RANGE_HINT,
  normaliseYear,
  slugify,
  yearToCohortCode,
  type Cohort,
  type ProctorMode,
  type Tenant,
  type TenantSettings,
} from "@/types/seedit";


export const Route = createFileRoute("/_portal/colleges")({
  head: () => ({
    meta: [
      { title: "Colleges & Cohorts | SEED-IT Admin" },
      {
        name: "description",
        content:
          "Create institutional tenants, build academic-year cohorts with department tags and manage default proctor settings.",
      },
      { property: "og:title", content: "Colleges & Cohorts | SEED-IT Admin" },
      {
        property: "og:description",
        content: "Manage SEED-IT college tenants, cohorts and proctoring defaults.",
      },
    ],
  }),
  component: CollegesPage,
});

const PROCTOR_MODES: ProctorMode[] = ["face+audio", "face", "audio", "off"];

interface CollegeEntry { code: string; name: string; shortName: string; city: string; }
interface SouthIndiaIndex { states: string[]; citiesByState: Record<string, string[]>; collegesByCity: Record<string, unknown[]>; }

/** Flatten the south_india_index.json into a flat list of {code, name, shortName, city}. */
function flattenCollegeIndex(data: SouthIndiaIndex): CollegeEntry[] {
  const result: CollegeEntry[] = [];
  if (!data?.collegesByCity) return result;
  for (const [city, colleges] of Object.entries(data.collegesByCity)) {
    for (const c of colleges) {
      if (typeof c === "object" && c !== null) {
        const entry = c as Record<string, string>;
        if (entry['code']) result.push({ code: entry['code'], name: entry['name'] ?? entry['code'], shortName: entry['shortName'] ?? "", city });
      } else if (typeof c === "string") {
        const codeM = c.match(/code=([^;\s}]+)/);
        const nameM = c.match(/name=([^;]+?)(?:;|})/);
        const shortM = c.match(/shortName=([^;\s}]+)/);
        if (codeM?.[1] && nameM?.[1]) result.push({ code: codeM[1].trim(), name: nameM[1].trim(), shortName: shortM?.[1]?.trim() ?? "", city });
      }
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

interface TenantDraft {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  /** Optional guest portal gate key for this college */
  gateKey: string;
  settings: TenantSettings;
  isNew: boolean;
}

interface CohortDraft extends Cohort {
  isNew: boolean;
}

function emptyTenantDraft(): TenantDraft {
  return {
    id: "",
    name: "",
    slug: "",
    active: true,
    gateKey: "",
    settings: { ...DEFAULT_TENANT_SETTINGS },
    isNew: true,
  };
}

function emptyCohortDraft(): CohortDraft {
  return {
    id: "",
    label: "",
    year: "",
    departments: [],
    allowedModules: [],
    batchStart: "",
    batchEnd: "",
    active: true,
    isNew: true,
  };
}

function CollegesPage() {
  const qc = useQueryClient();
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [tenantDraft, setTenantDraft] = useState<TenantDraft | null>(null);
  const [cohortDraft, setCohortDraft] = useState<CohortDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "tenant"; id: string; label: string } | { kind: "cohort"; id: string; label: string } | null
  >(null);

  // South India college index
  const [collegeIndex, setCollegeIndex] = useState<CollegeEntry[]>([]);
  const [collegeSearch, setCollegeSearch] = useState("");
  const [selectedCollegeEntry, setSelectedCollegeEntry] = useState<CollegeEntry | null>(null);
  useEffect(() => {
    fetch("/south_india_index.json").then(r => r.json()).then((data: SouthIndiaIndex) => {
      setCollegeIndex(flattenCollegeIndex(data));
    }).catch(() => {});
  }, []);
  const collegeSuggestions = useMemo(() => {
    if (!collegeSearch || collegeSearch.length < 2 || selectedCollegeEntry) return [];
    const q = collegeSearch.toLowerCase();
    return collegeIndex.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.shortName.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [collegeSearch, collegeIndex, selectedCollegeEntry]);

  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const usersQ = useQuery({ queryKey: ["users", "all"], queryFn: listAllUsers });

  const tenants = tenantsQ.data ?? [];
  const activeTenantId = selectedTenantId || tenants[0]?.id || "";
  const activeTenant = tenants.find((t) => t.id === activeTenantId) ?? null;

  const cohortsQ = useQuery({
    queryKey: ["cohorts", activeTenantId],
    queryFn: () => listCohorts(activeTenantId),
    enabled: Boolean(activeTenantId),
  });
  const cohorts = cohortsQ.data ?? [];

  const studentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of usersQ.data ?? []) {
      if (u.role !== "student") continue;
      map.set(u.tenantId, (map.get(u.tenantId) ?? 0) + 1);
      map.set(`${u.tenantId}::${u.cohortId}`, (map.get(`${u.tenantId}::${u.cohortId}`) ?? 0) + 1);
    }
    return map;
  }, [usersQ.data]);

  const saveTenant = useMutation({
    mutationFn: (draft: TenantDraft) =>
      upsertTenant({
        id: draft.id,
        name: draft.name,
        slug: draft.slug,
        active: draft.active,
        gateKey: draft.gateKey,
        settings: draft.settings,
        isNew: draft.isNew,
      }),
    onSuccess: (_data, draft) => {
      toast.success(draft.isNew ? "College created" : "College updated");
      setTenantDraft(null);
      setSelectedTenantId(draft.id);
      void qc.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save college"),
  });

  const saveCohort = useMutation({
    mutationFn: (draft: CohortDraft) => {
      const { isNew: _isNew, ...cohort } = draft;
      return upsertCohort(activeTenantId, cohort);
    },
    onSuccess: (_data, draft) => {
      toast.success(draft.isNew ? "Cohort added" : "Cohort updated");
      setCohortDraft(null);
      void qc.invalidateQueries({ queryKey: ["cohorts", activeTenantId] });
    },
    onError: () => toast.error("Could not save cohort"),
  });

  const removeItem = useMutation({
    mutationFn: async (target: NonNullable<typeof pendingDelete>) => {
      if (target.kind === "tenant") await deleteTenant(target.id);
      else await deleteCohort(activeTenantId, target.id);
    },
    onSuccess: (_d, target) => {
      toast.success(target.kind === "tenant" ? "College deleted" : "Cohort deleted");
      setPendingDelete(null);
      if (target.kind === "tenant") {
        setSelectedTenantId("");
        void qc.invalidateQueries({ queryKey: ["tenants"] });
      } else {
        void qc.invalidateQueries({ queryKey: ["cohorts", activeTenantId] });
      }
    },
    onError: () => toast.error("Delete failed"),
  });

  function openEditTenant(tenant: Tenant) {
    setTenantDraft({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      active: tenant.active,
      gateKey: tenant.gateKey ?? "",
      settings: { ...tenant.settings },
      isNew: false,
    });
  }

  const totalModules = cohorts.reduce((sum, c) => sum + c.allowedModules.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Colleges &amp; Cohorts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Institutional tenants, academic-year cohorts and proctoring defaults.
          </p>
        </div>
        <Button className="rounded-xl" onClick={() => setTenantDraft(emptyTenantDraft())}>
          <Plus className="size-4" />
          New college
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Tenants
              <Badge variant="secondary" className="ml-2 rounded-full text-[11px]">
                {tenants.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tenantsQ.isLoading ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)
            ) : tenants.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No colleges yet. Create your first tenant.
              </p>
            ) : (
              tenants.map((tenant) => {
                const selected = tenant.id === activeTenantId;
                return (
                  <button
                    key={tenant.id}
                    type="button"
                    onClick={() => setSelectedTenantId(tenant.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary-muted"
                        : "border-border hover:bg-muted/60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="size-4 shrink-0 text-primary" />
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{tenant.name}</p>
                      {!tenant.active ? (
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          inactive
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{tenant.id}</span>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" />
                        {studentCounts.get(tenant.id) ?? 0}
                      </span>
                    </p>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {activeTenant ? (
            <Card className="glass-panel rounded-2xl">
              <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0">
                  <h2 className="font-display truncate text-lg font-bold">{activeTenant.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-mono">{activeTenant.id}</span> • slug{" "}
                    <span className="font-mono">{activeTenant.slug}</span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <Badge variant="secondary" className="rounded-full">
                      Proctor: {activeTenant.settings.proctorMode}
                    </Badge>
                    <Badge variant="secondary" className="rounded-full">
                      Grace: {Math.round(activeTenant.settings.gracePeriodSeconds / 60)} min
                    </Badge>
                    <Badge variant="secondary" className="rounded-full">
                      Max violations: {activeTenant.settings.maxViolations}
                    </Badge>
                    <Badge variant="outline" className="rounded-full">
                      <Layers className="mr-1 size-3" />
                      {totalModules} modules assigned
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => openEditTenant(activeTenant)}
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-destructive"
                    onClick={() =>
                      setPendingDelete({
                        kind: "tenant",
                        id: activeTenant.id,
                        label: activeTenant.name,
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold">Cohort builder</CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={!activeTenantId}
                onClick={() => setCohortDraft(emptyCohortDraft())}
              >
                <Plus className="size-3.5" />
                Add cohort
              </Button>
            </CardHeader>
            <CardContent>
              {!activeTenantId ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Select a college to manage its cohorts.
                </p>
              ) : cohortsQ.isLoading ? (
                <div className="space-y-3">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-20 rounded-xl" />
                  ))}
                </div>
              ) : cohorts.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No cohorts yet. Add 2K21, 2K22, 2K23 … with their department tags.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {cohorts.map((cohort) => (
                    <div key={cohort.id} className="surface-card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{cohort.label}</p>
                          <p className="text-xs text-muted-foreground">
                            <span className="font-mono">{cohort.id}</span> • year {cohort.year}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 rounded-lg"
                            aria-label="Edit cohort"
                            onClick={() => setCohortDraft({ ...cohort, isNew: false })}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 rounded-lg text-destructive"
                            aria-label="Delete cohort"
                            onClick={() =>
                              setPendingDelete({ kind: "cohort", id: cohort.id, label: cohort.label })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {cohort.departments.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No departments tagged</span>
                        ) : (
                          cohort.departments.map((d) => (
                            <Badge key={d} variant="secondary" className="rounded-full text-[10px]">
                              {d}
                            </Badge>
                          ))
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Layers className="size-3" />
                          {cohort.allowedModules.length} modules
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" />
                          {studentCounts.get(`${activeTenantId}::${cohort.id}`) ??
                            cohort.studentCount ??
                            0}{" "}
                          students
                        </span>
                        {cohort.batchStart || cohort.batchEnd ? (
                          <span className="inline-flex items-center gap-1">
                            <CalendarRange className="size-3" />
                            {cohort.batchStart || "—"} → {cohort.batchEnd || "—"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tenant dialog */}
      <Dialog open={Boolean(tenantDraft)} onOpenChange={(open) => !open && setTenantDraft(null)}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          {tenantDraft ? (
            <>
              <DialogHeader>
                <DialogTitle>{tenantDraft.isNew ? "New college tenant" : "Edit college"}</DialogTitle>
                <DialogDescription>
                  The tenant ID is a stable uppercase slug used across every collection.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* ── College picker (new) / Name badge (edit) ── */}
                {tenantDraft.isNew ? (
                  <div className="space-y-2">
                    <Label htmlFor="tenant-college-search">🏫 Select College</Label>
                    <div className="relative">
                      <Input
                        id="tenant-college-search"
                        className="rounded-xl"
                        placeholder="Search by name, short code or state…"
                        value={selectedCollegeEntry ? `${selectedCollegeEntry.name}` : collegeSearch}
                        onChange={(e) => {
                          if (selectedCollegeEntry) {
                            setSelectedCollegeEntry(null);
                            setTenantDraft(prev => prev ? { ...prev, id: "", name: "", slug: "", gateKey: prev.gateKey } : prev);
                          }
                          setCollegeSearch(e.target.value);
                        }}
                        autoFocus
                      />
                      {collegeSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border bg-popover shadow-xl">
                          {collegeSuggestions.map((c) => (
                            <div
                              key={c.code}
                              className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm hover:bg-accent"
                              onClick={() => {
                                setSelectedCollegeEntry(c);
                                setCollegeSearch("");
                                setTenantDraft(prev => prev ? {
                                  ...prev,
                                  id: c.code,
                                  name: c.name,
                                  slug: slugify(c.name),
                                } : prev);
                              }}
                            >
                              <div>
                                <div className="font-medium">{c.name}</div>
                                <div className="text-xs text-muted-foreground">{c.city}</div>
                              </div>
                              <span className="ml-3 shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">{c.code}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedCollegeEntry ? (
                      <div className="flex items-center gap-3 rounded-xl border bg-accent/20 px-3 py-2.5">
                        <div className="flex-1">
                          <div className="text-sm font-semibold">{selectedCollegeEntry.name}</div>
                          <div className="text-xs text-muted-foreground">{selectedCollegeEntry.city} · TenantID: <code className="text-primary">{selectedCollegeEntry.code}</code></div>
                        </div>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground underline"
                          onClick={() => {
                            setSelectedCollegeEntry(null);
                            setCollegeSearch("");
                            setTenantDraft(prev => prev ? { ...prev, id: "", name: "", slug: "" } : prev);
                          }}
                        >Change</button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Type at least 2 characters to search from the SEED college database.
                      </p>
                    )}
                  </div>
                ) : (
                  /* Edit mode — college is locked, show as read-only */
                  <div className="space-y-1">
                    <Label>College</Label>
                    <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{tenantDraft.name}</div>
                        <div className="text-xs text-muted-foreground">TenantID: <code className="text-primary">{tenantDraft.id}</code> · Slug: {tenantDraft.slug}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">🔒 locked</span>
                    </div>
                  </div>
                )}

                {/* ── Proctoring settings ── */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Proctor mode</Label>
                    <Select
                      value={tenantDraft.settings.proctorMode}
                      onValueChange={(value) =>
                        setTenantDraft((prev) =>
                          prev
                            ? { ...prev, settings: { ...prev.settings, proctorMode: value as ProctorMode } }
                            : prev,
                        )
                      }
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROCTOR_MODES.map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {mode}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="grace">Grace (sec)</Label>
                    <Input
                      id="grace"
                      type="number"
                      min={0}
                      className="rounded-xl"
                      value={tenantDraft.settings.gracePeriodSeconds}
                      onChange={(e) =>
                        setTenantDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                settings: {
                                  ...prev.settings,
                                  gracePeriodSeconds: Number(e.target.value) || 0,
                                },
                              }
                            : prev,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxv">Max violations</Label>
                    <Input
                      id="maxv"
                      type="number"
                      min={0}
                      className="rounded-xl"
                      value={tenantDraft.settings.maxViolations}
                      onChange={(e) =>
                        setTenantDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                settings: { ...prev.settings, maxViolations: Number(e.target.value) || 0 },
                              }
                            : prev,
                        )
                      }
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border p-3">
                  <div>
                    <p className="text-sm font-medium">Tenant active</p>
                    <p className="text-xs text-muted-foreground">
                      Inactive tenants cannot start new assessments.
                    </p>
                  </div>
                  <Switch
                    checked={tenantDraft.active}
                    onCheckedChange={(active) =>
                      setTenantDraft((prev) => (prev ? { ...prev, active } : prev))
                    }
                  />
                </div>

                {/* ── GateKey ── */}
                <div className="space-y-2">
                  <Label htmlFor="tenant-gatekey">🔑 Guest Portal GateKey <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    id="tenant-gatekey"
                    className="rounded-xl font-mono"
                    placeholder="e.g. KITE2025 (leave blank for open access)"
                    value={tenantDraft.gateKey}
                    onChange={(e) =>
                      setTenantDraft((prev) => (prev ? { ...prev, gateKey: e.target.value } : prev))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    If set, guests must enter this key after selecting <strong>{tenantDraft.name || "this college"}</strong> before seeing available assessments.
                    Share this key with your students during placement drives or events.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setTenantDraft(null)}>
                  Cancel
                </Button>
                <Button
                  className="rounded-xl"
                  disabled={
                    saveTenant.isPending ||
                    !tenantDraft.name.trim() ||
                    !tenantDraft.id.trim() ||
                    !tenantDraft.slug.trim()
                  }
                  onClick={() => saveTenant.mutate(tenantDraft)}
                >
                  {saveTenant.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {tenantDraft.isNew ? "Create college" : "Save changes"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Cohort dialog */}
      <Dialog open={Boolean(cohortDraft)} onOpenChange={(open) => !open && setCohortDraft(null)}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          {cohortDraft ? (
            <>
              <DialogHeader>
                <DialogTitle>{cohortDraft.isNew ? "Add cohort" : "Edit cohort"}</DialogTitle>
                <DialogDescription>
                  A cohort groups an academic year with its departments, e.g. 2K27 - CSE, ECE, IT.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Academic year</Label>
                    <Select
                      value={cohortDraft.year}
                      onValueChange={(year) =>
                        setCohortDraft((prev) =>
                          prev
                            ? { ...prev, year, ...(prev.isNew ? { id: yearToCohortCode(year) } : {}) }
                            : prev,
                        )
                      }
                    >
                      <SelectTrigger className="rounded-xl font-mono" aria-label="Academic year">
                        <SelectValue placeholder="Select year" />
                      </SelectTrigger>
                      <SelectContent>
                        {ALLOWED_YEARS.map((y) => (
                          <SelectItem key={y} value={y} className="font-mono">
                            {y} ({yearToCohortCode(y)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{YEAR_RANGE_HINT}.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cohort-id">Cohort ID</Label>
                    <Input
                      id="cohort-id"
                      className="rounded-xl font-mono"
                      placeholder="2K27 or 2K27-CSE"
                      disabled={!cohortDraft.isNew}
                      value={cohortDraft.id}
                      onChange={(e) =>
                        setCohortDraft((prev) =>
                          prev ? { ...prev, id: e.target.value.toUpperCase().replace(/\s+/g, "") } : prev,
                        )
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Departments</Label>
                  <div className="flex flex-wrap gap-2">
                    {DEPARTMENTS.map((dept) => {
                      const on = cohortDraft.departments.includes(dept);
                      return (
                        <button
                          key={dept}
                          type="button"
                          onClick={() =>
                            setCohortDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    departments: on
                                      ? prev.departments.filter((d) => d !== dept)
                                      : [...prev.departments, dept],
                                  }
                                : prev,
                            )
                          }
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          {dept}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cohort-label">Display label</Label>
                  <Input
                    id="cohort-label"
                    className="rounded-xl"
                    placeholder="2K22 - CSE, ECE, IT"
                    value={cohortDraft.label}
                    onChange={(e) =>
                      setCohortDraft((prev) => (prev ? { ...prev, label: e.target.value } : prev))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to auto-generate from year and departments.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="batch-start">Batch start</Label>
                    <Input
                      id="batch-start"
                      type="date"
                      className="rounded-xl"
                      value={cohortDraft.batchStart ?? ""}
                      onChange={(e) =>
                        setCohortDraft((prev) => (prev ? { ...prev, batchStart: e.target.value } : prev))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="batch-end">Batch end</Label>
                    <Input
                      id="batch-end"
                      type="date"
                      className="rounded-xl"
                      value={cohortDraft.batchEnd ?? ""}
                      onChange={(e) =>
                        setCohortDraft((prev) => (prev ? { ...prev, batchEnd: e.target.value } : prev))
                      }
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setCohortDraft(null)}>
                  Cancel
                </Button>
                <Button
                  className="rounded-xl"
                  disabled={saveCohort.isPending || !cohortDraft.id.trim() || !normaliseYear(cohortDraft.year)}
                  onClick={() => {
                    const label =
                      cohortDraft.label.trim() ||
                      `${cohortDraft.year}${
                        cohortDraft.departments.length ? ` - ${cohortDraft.departments.join(", ")}` : ""
                      }`;
                    saveCohort.mutate({ ...cohortDraft, label });
                  }}
                >
                  {saveCohort.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {cohortDraft.isNew ? "Add cohort" : "Save changes"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "tenant"
                ? "This removes the tenant and all of its cohorts. Student profiles are not deleted."
                : "This removes the cohort and its allowedModules assignment."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => pendingDelete && removeItem.mutate(pendingDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
