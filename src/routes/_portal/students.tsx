import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listCohorts, listTenants } from "@/lib/firestore/tenants";
import {
  bulkSetPremium,
  deleteStudent,
  listAllUsers,
  provisionAccount,
  updateStudent,
  type StudentInput,
} from "@/lib/firestore/users";
import {
  ALLOWED_YEARS,
  DEPARTMENTS,
  YEAR_RANGE_HINT,
  normaliseYear,
  yearToCohortCode,
  type AppUser,
} from "@/types/seedit";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_portal/students")({
  head: () => ({
    meta: [
      { title: "Student Roster | SEED-IT Admin" },
      {
        name: "description",
        content:
          "Search, provision and bulk-import students with Excel upload, premium licence toggles and cohort assignment.",
      },
      { property: "og:title", content: "Student Roster | SEED-IT Admin" },
      {
        property: "og:description",
        content: "Provision SEED-IT students individually or in bulk from Excel.",
      },
    ],
  }),
  component: StudentsPage,
});

/** Password assigned on onboarding = rollNumber@SEEDIT (e.g. 22CSE001@SEEDIT) */
const makePassword = (rollNumber: string) =>
  rollNumber.trim() ? `${rollNumber.trim()}@SEEDIT` : `SEED${Date.now()}@SEEDIT`;

interface ParsedRow extends StudentInput {
  rowNumber: number;
  errors: string[];
}

interface UploadOutcome {
  email: string;
  ok: boolean;
  detail: string;
}

const HEADER_ALIASES: Record<keyof StudentInput | "password", string[]> = {
  email: ["email", "emailid", "mailid", "email address", "mail", "mail id", "e-mail"],
  password: ["password", "pwd", "passcode"],
  displayName: ["name", "displayname", "student name", "fullname", "full name"],
  rollNumber: [
    "rollnumber",
    "rollno",
    "roll number",
    "registerno",
    "register number",
    "regno",
    "universityno",
  ],
  tenantId: ["tenantid", "tenant", "collegecode", "college code"],
  college: ["college", "collegename", "college name", "institution"],
  cohortId: ["cohortid", "cohort", "batch"],
  year: ["year", "academicyear", "academic year", "yearofstudy"],
  department: ["department", "dept", "branch"],
  premium: ["premium", "ispremium", "licence", "license"],
  role: ["role"],
};

interface CollegeEntry { code: string; name: string; shortName: string; }

/** JSON: collegesMap[state][city] = [{code, name, shortName}] */
function flattenCollegeIndex(data: Record<string, unknown>): CollegeEntry[] {
  const byState = (data as { collegesMap?: Record<string, Record<string, unknown[]>> }).collegesMap ?? {};
  const result: CollegeEntry[] = [];
  for (const cityMap of Object.values(byState)) {
    for (const colleges of Object.values(cityMap)) {
      for (const c of colleges) {
        if (typeof c === "object" && c !== null) {
          const e = c as Record<string, string>;
          if (e['code']) result.push({ code: e['code'], name: e['name'] ?? e['code'], shortName: e['shortName'] ?? "" });
        }
      }
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function normHeader(value: string): string {
  return value.toLowerCase().replace(/[\s._-]/g, "");
}

function fieldForHeader(header: string): keyof ParsedRow | null {
  const norm = normHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((alias) => normHeader(alias) === norm)) return field as keyof ParsedRow;
  }
  return null;
}

function StudentsPage() {
  const qc = useQueryClient();
  const { scopedTenantId } = useAuth();

  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [cohortFilter, setCohortFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [premiumFilter, setPremiumFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AppUser | null>(null);

  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // ── Import college picker (south_india_index.json) ──────────────────────────
  const [allImportColleges, setAllImportColleges] = useState<CollegeEntry[]>([]);
  const [importCollegeSearch, setImportCollegeSearch] = useState("");
  const [importCollegeSuggestions, setImportCollegeSuggestions] = useState<CollegeEntry[]>([]);
  const [importCollege, setImportCollege] = useState<CollegeEntry | null>(null);

  // Load college index once on mount
  useEffect(() => {
    fetch("/south_india_index.json").then(r => r.json()).then((data: Record<string, unknown>) => {
      setAllImportColleges(flattenCollegeIndex(data));
    }).catch(() => {});
  }, []);

  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const usersQ = useQuery({ queryKey: ["users", "all"], queryFn: listAllUsers });

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const effectiveTenant = scopedTenantId || (tenantFilter !== "all" ? tenantFilter : "");
  const cohortsQ = useQuery({
    queryKey: ["cohorts", effectiveTenant],
    queryFn: () => listCohorts(effectiveTenant),
    enabled: Boolean(effectiveTenant),
  });

  const students = useMemo(() => {
    let list = (usersQ.data ?? []).filter((u) => u.role === "student");
    if (scopedTenantId) list = list.filter((u) => u.tenantId === scopedTenantId);
    return list.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
  }, [usersQ.data, scopedTenantId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (tenantFilter !== "all" && s.tenantId !== tenantFilter) return false;
      if (cohortFilter !== "all" && s.cohortId !== cohortFilter) return false;
      if (deptFilter !== "all" && s.department !== deptFilter) return false;
      if (premiumFilter === "premium" && !s.premium) return false;
      if (premiumFilter === "standard" && s.premium) return false;
      if (!q) return true;
      return [s.displayName, s.email, s.rollNumber, s.college, s.department, s.year]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [students, search, tenantFilter, cohortFilter, deptFilter, premiumFilter]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.uid));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((s) => next.delete(s.uid));
      else filtered.forEach((s) => next.add(s.uid));
      return next;
    });
  }

  const premiumMutation = useMutation({
    mutationFn: ({ uids, premium }: { uids: string[]; premium: boolean }) =>
      bulkSetPremium(uids, premium),
    onSuccess: (count, vars) => {
      toast.success(`${count} student${count === 1 ? "" : "s"} set to ${vars.premium ? "premium" : "standard"}`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["users", "all"] });
    },
    onError: () => toast.error("Bulk update failed"),
  });

  const saveStudent = useMutation({
    mutationFn: async (payload: { uid?: string | undefined; input: StudentInput }) => {
      if (payload.uid) {
        const { email: _e, password: _p, ...patch } = payload.input;
        await updateStudent(payload.uid, patch);
        return { authCreated: false };
      }
      return provisionAccount(payload.input);
    },
    onSuccess: (res, vars) => {
      toast.success(
        vars.uid
          ? "Student updated"
          : res.authCreated
            ? "Student provisioned with login credentials"
            : "Profile saved (login already existed)",
      );
      setEditing(null);
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ["users", "all"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save student"),
  });

  const removeStudent = useMutation({
    mutationFn: (uid: string) => deleteStudent(uid),
    onSuccess: () => {
      toast.success("Student profile removed");
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: ["users", "all"] });
    },
    onError: () => toast.error("Delete failed"),
  });

  async function handleFile(file: File) {
    setFileName(file.name);
    setOutcomes([]);
    setUploadProgress(0);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array" });
      const sheetName = book.SheetNames[0];
      if (!sheetName) throw new Error("The workbook has no sheets");
      const sheet = book.Sheets[sheetName];
      if (!sheet) throw new Error("The first sheet could not be read");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const parsed: ParsedRow[] = raw.map((record, index) => {
        const row: ParsedRow = {
          rowNumber: index + 2,
          email: "",
          password: "",
          displayName: "",
          rollNumber: "",
          // tenantId comes from the import college picker — not from the CSV
          tenantId: importCollege?.code ?? scopedTenantId ?? "",
          college: importCollege?.name ?? "",
          cohortId: "",
          year: "",
          department: "",
          premium: false,
          errors: [],
        };

        for (const [header, value] of Object.entries(record)) {
          const field = fieldForHeader(header);
          if (!field) continue;
          if (field === "tenantId") continue; // always use picker value
          const text = String(value ?? "").trim();
          if (field === "premium") {
            row.premium = ["yes", "true", "1", "premium", "y"].includes(text.toLowerCase());
          } else if (field === "email") {
            row.email = text.toLowerCase();
          } else if (field !== "rowNumber" && field !== "errors") {
            (row[field] as string) = text;
          }
        }

        if (!row.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email))
          row.errors.push("Invalid or missing email");
        if (!row.displayName) row.errors.push("Missing name");
        if (!row.tenantId) row.errors.push("Select a college above before uploading");
        // Password auto-derived from roll number — no column needed
        row.password = makePassword(row.rollNumber);
        if (!row.college) row.college = importCollege?.name ?? tenants.find((t) => t.id === row.tenantId)?.name ?? row.tenantId;
        const normYear = normaliseYear(row.year || row.cohortId);
        if (!normYear) {
          row.errors.push(`${YEAR_RANGE_HINT} (row value: "${row.year || row.cohortId || "empty"}")`);
        } else {
          row.year = normYear;
          if (!row.cohortId) row.cohortId = yearToCohortCode(normYear);
        }
        return row;
      });

      setRows(parsed);
      const valid = parsed.filter((r) => r.errors.length === 0).length;
      toast.success(`Parsed ${parsed.length} rows — ${valid} ready to import`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file");
      setRows([]);
    }
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      const valid = rows.filter((r) => r.errors.length === 0);
      const results: UploadOutcome[] = [];
      for (let i = 0; i < valid.length; i += 1) {
        const row = valid[i]!;
        try {
          const { rowNumber: _rn, errors: _errs, ...input } = row;
          const res = await provisionAccount(input, { keepSecondaryAlive: i < valid.length - 1 });
          results.push({
            email: row.email,
            ok: true,
            detail: res.authCreated ? "Account created" : "Profile synced (login existed)",
          });
        } catch (err) {
          // Surface Firebase Auth error codes for admins (e.g. auth/too-many-requests, auth/operation-not-allowed).
          const firebaseCode = (err as { code?: string })?.code;
          const message = err instanceof Error ? err.message : "Unknown error";
          const detail = firebaseCode ? `[${firebaseCode}] ${message}` : message;
          results.push({ email: row.email, ok: false, detail });
        }
        setUploadProgress(Math.round(((i + 1) / valid.length) * 100));
        // Rate-limit guard: Firebase allows ~10 auth creations/sec; 120ms keeps us at ~8/s.
        if (i < valid.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      }
      return results;
    },
    onSuccess: (results) => {
      setOutcomes(results);
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      if (failed === 0) {
        toast.success(`Imported all ${ok} students successfully`);
      } else {
        toast.warning(`Imported ${ok} of ${results.length} students — ${failed} failed (see table below)`);
      }
      void qc.invalidateQueries({ queryKey: ["users", "all"] });
    },
    onError: () => toast.error("Import failed"),
  });

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const college = importCollege ?? tenants[0];
    const sheet = XLSX.utils.json_to_sheet([
      {
        Name: "Student Full Name",
        Email: "student@college.edu",
        RollNumber: "22CSE001",
        // Password is auto-generated as RollNumber@SEEDIT — no column needed
        Year: "2027",
        Department: "CSE",
        CohortID: "2K27",
        Premium: "no",
      },
    ]);
    // Add a note row explaining password
    XLSX.utils.sheet_add_aoa(sheet, [
      [],
      ["NOTES:"],
      [`College: ${college ? `${college.name} (${college instanceof Object && 'id' in college ? (college as {id: string}).id : importCollege?.code ?? ''})` : 'Select college in admin before upload'}`],
      ["Password: Auto-set to RollNumber@SEEDIT (e.g. 22CSE001@SEEDIT). Students use this to log in."],
      ["TenantID: Do NOT include — college is selected in the admin import panel."],
    ], { origin: -1 });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Students");
    XLSX.writeFile(book, "seed-it-student-template.xlsx");
  }

  const validCount = rows.filter((r) => r.errors.length === 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Student Roster</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {students.length} student{students.length === 1 ? "" : "s"} across{" "}
            {new Set(students.map((s) => s.tenantId)).size} tenant(s).
          </p>
        </div>
        <Button className="rounded-xl" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" />
          Add student
        </Button>
      </div>

      <Tabs defaultValue="roster">
        <TabsList className="rounded-xl">
          <TabsTrigger value="roster" className="rounded-lg">
            Roster
          </TabsTrigger>
          <TabsTrigger value="upload" className="rounded-lg">
            Excel bulk upload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-4 space-y-4">
          <Card className="rounded-2xl">
            <CardContent className="grid gap-3 p-4 md:grid-cols-5">
              <div className="relative md:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="rounded-xl pl-9"
                  placeholder="Search name, email, roll number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search students"
                />
              </div>
              {!scopedTenantId ? (
                <Select
                  value={tenantFilter}
                  onValueChange={(v) => {
                    setTenantFilter(v);
                    setCohortFilter("all");
                  }}
                >
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
              <Select value={cohortFilter} onValueChange={setCohortFilter}>
                <SelectTrigger className="rounded-xl" aria-label="Filter by cohort">
                  <SelectValue placeholder="All cohorts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cohorts</SelectItem>
                  {(cohortsQ.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
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
              <Select value={premiumFilter} onValueChange={setPremiumFilter}>
                <SelectTrigger className="rounded-xl" aria-label="Filter by licence">
                  <SelectValue placeholder="All licences" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All licences</SelectItem>
                  <SelectItem value="premium">Premium only</SelectItem>
                  <SelectItem value="standard">Standard only</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selected.size > 0 ? (
            <div className="glass-panel flex flex-wrap items-center gap-3 rounded-2xl p-3">
              <Badge className="rounded-full">{selected.size} selected</Badge>
              <Button
                size="sm"
                className="rounded-xl"
                disabled={premiumMutation.isPending}
                onClick={() => premiumMutation.mutate({ uids: [...selected], premium: true })}
              >
                <Sparkles className="size-3.5" />
                Grant premium
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={premiumMutation.isPending}
                onClick={() => premiumMutation.mutate({ uids: [...selected], premium: false })}
              >
                Revoke premium
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-xl"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          ) : null}

          <Card className="rounded-2xl">
            <CardContent className="p-0">
              {usersQ.isLoading ? (
                <div className="space-y-3 p-4">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-12 rounded-xl" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No students match these filters.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="w-10 px-4 py-3">
                          <Checkbox
                            checked={allVisibleSelected}
                            onCheckedChange={toggleAll}
                            aria-label="Select all visible students"
                          />
                        </th>
                        <th className="px-4 py-3 text-left font-medium">Student</th>
                        <th className="px-4 py-3 text-left font-medium">Roll no.</th>
                        <th className="px-4 py-3 text-left font-medium">College</th>
                        <th className="px-4 py-3 text-left font-medium">Cohort</th>
                        <th className="px-4 py-3 text-left font-medium">Dept</th>
                        <th className="px-4 py-3 text-left font-medium">Licence</th>
                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filtered.map((student) => (
                        <tr key={student.uid} className="transition-colors hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <Checkbox
                              checked={selected.has(student.uid)}
                              onCheckedChange={() =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(student.uid)) next.delete(student.uid);
                                  else next.add(student.uid);
                                  return next;
                                })
                              }
                              aria-label={`Select ${student.displayName || student.email}`}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium">{student.displayName || "—"}</p>
                            <p className="text-xs text-muted-foreground">{student.email}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{student.rollNumber || "—"}</td>
                          <td className="max-w-[180px] truncate px-4 py-3">
                            {student.college || student.tenantId}
                          </td>
                          <td className="px-4 py-3">{student.cohortId || student.year || "—"}</td>
                          <td className="px-4 py-3">{student.department || "—"}</td>
                          <td className="px-4 py-3">
                            {student.premium ? (
                              <Badge className="rounded-full text-[11px]">Premium</Badge>
                            ) : (
                              <Badge variant="secondary" className="rounded-full text-[11px]">
                                Standard
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 rounded-lg"
                              aria-label={`Edit ${student.email}`}
                              onClick={() => setEditing(student)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 rounded-lg text-destructive"
                              aria-label={`Delete ${student.email}`}
                              onClick={() => setPendingDelete(student)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload" className="mt-4 space-y-4">
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Excel bulk provisioning</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* ── College Picker ── */}
              <div className="space-y-2 rounded-2xl border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 1: Select College</p>
                <p className="text-xs text-muted-foreground">
                  All imported students will be assigned to this college (TenantID = college code from index).
                </p>
                {scopedTenantId ? (
                  <div className="rounded-xl border bg-background px-3 py-2 text-sm">
                    {tenants.find(t => t.id === scopedTenantId)?.name ?? scopedTenantId}
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      id="import-college-search"
                      className="rounded-xl"
                      placeholder="Search college by name or code…"
                      value={importCollegeSearch}
                      onChange={(e) => {
                        setImportCollegeSearch(e.target.value);
                        if (importCollege && e.target.value !== importCollege.name) setImportCollege(null);
                        const q = e.target.value.toLowerCase();
                        setImportCollegeSuggestions(
                          q.length < 2 ? [] :
                          allImportColleges.filter(c =>
                            c.name.toLowerCase().includes(q) ||
                            c.shortName.toLowerCase().includes(q) ||
                            c.code.toLowerCase().includes(q)
                          ).slice(0, 8)
                        );
                      }}
                    />
                    {importCollegeSuggestions.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border bg-popover shadow-lg">
                        {importCollegeSuggestions.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              setImportCollege(c);
                              setImportCollegeSearch(c.name);
                              setImportCollegeSuggestions([]);
                              // Re-parse rows with new tenantId if already loaded
                              if (rows.length > 0) {
                                setRows(prev => prev.map(r => ({
                                  ...r,
                                  tenantId: c.code,
                                  college: c.name,
                                  password: makePassword(r.rollNumber),
                                  errors: r.errors.filter(e => !e.includes("Select a college")),
                                })));
                              }
                            }}
                          >
                            <span className="font-mono text-xs text-muted-foreground mt-0.5">{c.code}</span>
                            <span>{c.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {importCollege && (
                  <p className="text-xs text-emerald-500">College: <strong>{importCollege.name}</strong> · TenantID: <code>{importCollege.code}</code></p>
                )}
              </div>

              {/* ── File Drop Zone ── */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 2: Upload Roster (.xlsx / .csv)</p>
              </div>
              <div
                className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors hover:border-primary/60"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleFile(file);
                }}
              >
                <FileSpreadsheet className="size-10 text-primary" />
                <p className="mt-3 text-sm font-medium">Drop an .xlsx / .csv roster here</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Columns: <strong>Name, Email, RollNumber</strong>, Year, Department, CohortID, Premium
                  &nbsp;·&nbsp; Password auto-set to <code>RollNumber@SEEDIT</code> &nbsp;·&nbsp; No TenantID column needed
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button className="rounded-xl" onClick={() => fileInput.current?.click()}>
                    <Upload className="size-4" />
                    Choose file
                  </Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => void downloadTemplate()}>
                    <Download className="size-4" />
                    Download template
                  </Button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                    e.target.value = "";
                  }}
                />
                {fileName ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Loaded <span className="font-medium">{fileName}</span>
                  </p>
                ) : null}
              </div>

              {rows.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary" className="rounded-full">
                      {rows.length} rows parsed
                    </Badge>
                    <Badge className="rounded-full">{validCount} valid</Badge>
                    {rows.length - validCount > 0 ? (
                      <Badge variant="destructive" className="rounded-full">
                        {rows.length - validCount} with errors
                      </Badge>
                    ) : null}
                    <Button
                      size="sm"
                      className="ml-auto rounded-xl"
                      disabled={validCount === 0 || importMutation.isPending}
                      onClick={() => importMutation.mutate()}
                    >
                      {importMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <UserPlus className="size-4" />
                      )}
                      Import {validCount} students
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xl"
                      onClick={() => {
                        setRows([]);
                        setOutcomes([]);
                        setFileName("");
                        setUploadProgress(0);
                      }}
                    >
                      Reset
                    </Button>
                  </div>

                  {importMutation.isPending ? (
                    <Progress value={uploadProgress} className="h-2 rounded-full" />
                  ) : null}

                  <div className="max-h-80 overflow-auto rounded-xl border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60 uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Row</th>
                          <th className="px-3 py-2 text-left font-medium">Email</th>
                          <th className="px-3 py-2 text-left font-medium">Name</th>
                          <th className="px-3 py-2 text-left font-medium">Tenant</th>
                          <th className="px-3 py-2 text-left font-medium">Cohort</th>
                          <th className="px-3 py-2 text-left font-medium">Dept</th>
                          <th className="px-3 py-2 text-left font-medium">Premium</th>
                          <th className="px-3 py-2 text-left font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {rows.map((row) => (
                          <tr key={row.rowNumber} className={row.errors.length ? "bg-destructive/5" : ""}>
                            <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                            <td className="px-3 py-2">{row.email || "—"}</td>
                            <td className="px-3 py-2">{row.displayName || "—"}</td>
                            <td className="px-3 py-2 font-mono">{row.tenantId || "—"}</td>
                            <td className="px-3 py-2">{row.cohortId || "—"}</td>
                            <td className="px-3 py-2">{row.department || "—"}</td>
                            <td className="px-3 py-2">{row.premium ? "yes" : "no"}</td>
                            <td className="px-3 py-2">
                              {row.errors.length ? (
                                <span className="inline-flex items-center gap-1 text-destructive">
                                  <XCircle className="size-3.5" />
                                  {row.errors.join("; ")}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-primary">
                                  <CheckCircle2 className="size-3.5" />
                                  Ready
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {outcomes.length > 0 ? (
                <div className="rounded-xl border p-4">
                  <p className="text-sm font-semibold">Import report</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {outcomes.map((o) => (
                      <li key={o.email} className="flex items-center gap-2">
                        {o.ok ? (
                          <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                        ) : (
                          <XCircle className="size-3.5 shrink-0 text-destructive" />
                        )}
                        <span className="font-medium">{o.email}</span>
                        <span className="text-muted-foreground">— {o.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <StudentDialog
        open={creating || Boolean(editing)}
        student={editing}
        tenants={tenants.map((t) => ({ id: t.id, name: t.name }))}
        cohorts={(cohortsQ.data ?? []).map((c) => ({ id: c.id, label: c.label }))}
        scopedTenantId={scopedTenantId}
        pending={saveStudent.isPending}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={(input, uid) => saveStudent.mutate({ uid, input })}
      />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.displayName || pendingDelete?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the Firestore profile. The Firebase Auth credential stays intact and can be
              re-linked by provisioning the same email again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => pendingDelete && removeStudent.mutate(pendingDelete.uid)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StudentDialog({
  open,
  student,
  tenants,
  cohorts,
  scopedTenantId,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  student: AppUser | null;
  tenants: Array<{ id: string; name: string }>;
  cohorts: Array<{ id: string; label: string }>;
  scopedTenantId: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: StudentInput, uid?: string) => void;
}) {
  const [form, setForm] = useState<StudentInput>({
    email: "",
    password: makePassword(""),
    displayName: "",
    rollNumber: "",
    tenantId: scopedTenantId ?? "",
    college: "",
    cohortId: "",
    year: "",
    department: "",
    premium: false,
  });
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  const key = student?.uid ?? (open ? "new" : null);
  if (open && key !== initialisedFor) {
    setInitialisedFor(key);
    setForm(
      student
        ? {
            email: student.email,
            password: "",
            displayName: student.displayName,
            rollNumber: student.rollNumber ?? "",
            tenantId: student.tenantId,
            college: student.college ?? "",
            cohortId: student.cohortId ?? "",
            year: student.year ?? "",
            department: student.department ?? "",
            premium: Boolean(student.premium),
          }
        : {
            email: "",
            password: makePassword(""),
            displayName: "",
            rollNumber: "",
            tenantId: scopedTenantId ?? tenants[0]?.id ?? "",
            college: scopedTenantId ? (tenants[0]?.name ?? "") : "",
            cohortId: "",
            year: "",
            department: "",
            premium: false,
          },
    );
  }
  if (!open && initialisedFor !== null) setInitialisedFor(null);

  const set = <K extends keyof StudentInput>(field: K, value: StudentInput[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{student ? "Edit student" : "Provision student"}</DialogTitle>
          <DialogDescription>
            {student
              ? "Profile fields update immediately; the login email cannot be changed here."
              : "The credential is created through an isolated secondary Firebase app, so your admin session stays signed in."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="s-email">Email</Label>
            <Input
              id="s-email"
              type="email"
              className="rounded-xl"
              disabled={Boolean(student)}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          {!student ? (
            <div className="space-y-2">
              <Label htmlFor="s-pass">Temporary password</Label>
              <Input
                id="s-pass"
                className="rounded-xl"
                value={form.password ?? ""}
                onChange={(e) => set("password", e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="s-name">Full name</Label>
            <Input
              id="s-name"
              className="rounded-xl"
              value={form.displayName}
              onChange={(e) => set("displayName", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-roll">Roll number</Label>
            <Input
              id="s-roll"
              className="rounded-xl font-mono"
              value={form.rollNumber}
              onChange={(e) => {
                const rn = e.target.value;
                set("rollNumber", rn);
                // Auto-derive password from roll number
                set("password", makePassword(rn));
              }}
            />
            <p className="text-xs text-muted-foreground">
              Password will be set to <code>{form.rollNumber ? `${form.rollNumber}@SEEDIT` : "RollNumber@SEEDIT"}</code>
            </p>
          </div>
          <div className="space-y-2">
            <Label>College tenant</Label>
            <Select
              value={form.tenantId}
              onValueChange={(v) => {
                set("tenantId", v);
                set("college", tenants.find((t) => t.id === v)?.name ?? "");
              }}
              disabled={Boolean(scopedTenantId)}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Select college" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Cohort</Label>
            <Select
              value={form.cohortId}
              onValueChange={(v) => {
                set("cohortId", v);
                const y = normaliseYear(v);
                if (y && !form.year) set("year", y);
              }}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Select cohort" />
              </SelectTrigger>
              <SelectContent>
                {cohorts.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No cohorts for this tenant
                  </SelectItem>
                ) : (
                  cohorts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Academic year</Label>
            <Select
              value={form.year}
              onValueChange={(v) => {
                set("year", v);
                if (!form.cohortId) set("cohortId", yearToCohortCode(v));
              }}
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
            <Label>Department</Label>
            <Select value={form.department} onValueChange={(v) => set("department", v)}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-xl border p-3 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Premium licence</p>
              <p className="text-xs text-muted-foreground">
                Unlocks paid assessment modules for this student.
              </p>
            </div>
            <Switch checked={form.premium} onCheckedChange={(v) => set("premium", v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="rounded-xl"
            disabled={
              pending ||
              !form.email.trim() ||
              !form.displayName.trim() ||
              !form.tenantId ||
              !normaliseYear(form.year)
            }
            onClick={() => onSubmit(form, student?.uid)}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {student ? "Save changes" : "Provision student"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
