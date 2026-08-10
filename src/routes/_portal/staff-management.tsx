import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserSquare2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
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
import { listTenants } from "@/lib/firestore/tenants";
import {
  deleteStaff,
  listStaff,
  provisionStaff,
  setStaffActive,
  updateStaff,
  type StaffInput,
} from "@/lib/firestore/staff";
import { DEPARTMENTS, type AppUser } from "@/types/seedit";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_portal/staff-management")({
  head: () => ({
    meta: [
      { title: "Staff Management | SEED-IT Admin" },
      {
        name: "description",
        content:
          "Provision faculty and admin accounts, scope them to a college and manage their access status.",
      },
      { property: "og:title", content: "Staff Management | SEED-IT Admin" },
      {
        property: "og:description",
        content: "Create, edit, suspend and remove SEED-IT staff and admin accounts.",
      },
    ],
  }),
  component: StaffManagementPage,
});

const DEFAULT_PASSWORD = "Seedit@123";

interface StaffDraft {
  uid?: string | undefined;
  email: string;
  password: string;
  displayName: string;
  tenantId: string;
  college: string;
  department: string;
  role: "staff" | "admin";
}

function emptyDraft(defaultTenant: string, defaultCollege: string): StaffDraft {
  return {
    email: "",
    password: DEFAULT_PASSWORD,
    displayName: "",
    tenantId: defaultTenant,
    college: defaultCollege,
    department: "",
    role: "staff",
  };
}

function formatTimestamp(ts: AppUser["lastLoginAt"]): string {
  if (!ts) return "Never";
  try {
    const date = "toDate" in ts ? ts.toDate() : new Date(ts as unknown as string);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function StaffManagementPage() {
  const qc = useQueryClient();
  const { scopedTenantId, isAdmin } = useAuth();

  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [draft, setDraft] = useState<StaffDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AppUser | null>(null);

  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const staffQ = useQuery({
    queryKey: ["staff"],
    queryFn: () => listStaff(scopedTenantId || undefined),
  });

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const staff = staffQ.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((s) => {
      if (tenantFilter !== "all" && s.tenantId !== tenantFilter) return false;
      if (roleFilter !== "all" && s.role !== roleFilter) return false;
      if (!q) return true;
      return [s.displayName, s.email, s.college, s.department]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [staff, search, tenantFilter, roleFilter]);

  const saveStaff = useMutation({
    mutationFn: async (d: StaffDraft) => {
      if (d.uid) {
        await updateStaff(d.uid, {
          displayName: d.displayName,
          tenantId: d.tenantId,
          college: d.college,
          department: d.department,
          role: d.role,
        });
        return { authCreated: false };
      }
      const input: StaffInput = {
        email: d.email,
        password: d.password || DEFAULT_PASSWORD,
        displayName: d.displayName,
        tenantId: d.tenantId,
        college: d.college,
        department: d.department,
        role: d.role,
      };
      return provisionStaff(input);
    },
    onSuccess: (res, d) => {
      toast.success(
        d.uid
          ? "Staff account updated"
          : res.authCreated
            ? "Staff account provisioned with login credentials"
            : "Profile saved (login already existed)",
      );
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save staff account"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ uid, active }: { uid: string; active: boolean }) => setStaffActive(uid, active),
    onSuccess: (_d, vars) => {
      toast.success(vars.active ? "Account reactivated" : "Account suspended");
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: () => toast.error("Could not update account status"),
  });

  const removeStaff = useMutation({
    mutationFn: (uid: string) => deleteStaff(uid),
    onSuccess: () => {
      toast.success("Staff profile removed");
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: () => toast.error("Delete failed"),
  });

  function openCreate() {
    const defaultTenant = scopedTenantId || tenants[0]?.id || "";
    const defaultCollege = tenants.find((t) => t.id === defaultTenant)?.name ?? "";
    setDraft(emptyDraft(defaultTenant, defaultCollege));
  }

  function openEdit(user: AppUser) {
    setDraft({
      uid: user.uid,
      email: user.email,
      password: "",
      displayName: user.displayName,
      tenantId: user.tenantId,
      college: user.college ?? "",
      department: user.department ?? "",
      role: user.role === "admin" ? "admin" : "staff",
    });
  }

  function handleTenantChange(tenantId: string) {
    if (!draft) return;
    const tenant = tenants.find((t) => t.id === tenantId);
    setDraft({ ...draft, tenantId, college: tenant?.name ?? draft.college });
  }

  const canSave = Boolean(
    draft &&
      draft.displayName.trim() &&
      draft.tenantId &&
      draft.department &&
      (draft.uid || (draft.email.trim() && draft.password.trim())),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Staff Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {staff.length} account{staff.length === 1 ? "" : "s"} across{" "}
            {new Set(staff.map((s) => s.tenantId)).size} tenant(s).
          </p>
        </div>
        <Button className="rounded-xl" onClick={openCreate}>
          <UserPlus className="size-4" />
          Add staff
        </Button>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-xl pl-9"
              placeholder="Search name, email, department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search staff"
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
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="rounded-xl" aria-label="Filter by role">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="staff">Staff</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {staffQ.isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              {staff.length === 0
                ? "No staff accounts yet. Add your first faculty or admin account."
                : "No accounts match your search or filters."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">College</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Last login</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.uid} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{s.displayName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.email}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={s.role === "admin" ? "default" : "secondary"}
                          className="rounded-full text-[10px]"
                        >
                          {s.role === "admin" ? (
                            <span className="inline-flex items-center gap-1">
                              <ShieldCheck className="size-3" />
                              admin
                            </span>
                          ) : (
                            "staff"
                          )}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{s.college || s.tenantId}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.department || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={s.active !== false}
                            onCheckedChange={(checked) =>
                              toggleActive.mutate({ uid: s.uid, active: checked })
                            }
                            aria-label={s.active !== false ? "Suspend account" : "Reactivate account"}
                          />
                          <span className="text-xs text-muted-foreground">
                            {s.active !== false ? "Active" : "Suspended"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatTimestamp(s.lastLoginAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 rounded-lg"
                            aria-label={`Edit ${s.displayName}`}
                            onClick={() => openEdit(s)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 rounded-lg text-destructive"
                            aria-label={`Delete ${s.displayName}`}
                            onClick={() => setPendingDelete(s)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Provision / edit dialog */}
      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserSquare2 className="size-4 text-primary" />
                  {draft.uid ? "Edit staff account" : "Provision staff account"}
                </DialogTitle>
                <DialogDescription>
                  {draft.uid
                    ? "Update this account's profile, tenant scope and role. Email cannot be changed."
                    : "Credentials are created via an isolated secondary Firebase app, so your own admin session stays signed in while the new account is provisioned."}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="staff-email">Email</Label>
                    <Input
                      id="staff-email"
                      type="email"
                      className="rounded-xl"
                      placeholder="faculty@college.edu"
                      value={draft.email}
                      disabled={Boolean(draft.uid)}
                      onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    />
                  </div>
                  {!draft.uid ? (
                    <div className="space-y-2">
                      <Label htmlFor="staff-password">Temporary password</Label>
                      <Input
                        id="staff-password"
                        className="rounded-xl"
                        value={draft.password}
                        onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="staff-name">Full name</Label>
                  <Input
                    id="staff-name"
                    className="rounded-xl"
                    placeholder="Dr. Jane Doe"
                    value={draft.displayName}
                    onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="staff-tenant">College</Label>
                    <Select
                      value={draft.tenantId}
                      onValueChange={handleTenantChange}
                      disabled={Boolean(scopedTenantId)}
                    >
                      <SelectTrigger id="staff-tenant" className="rounded-xl" aria-label="College tenant">
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
                    <Label htmlFor="staff-department">Department</Label>
                    <Select
                      value={draft.department}
                      onValueChange={(v) => setDraft({ ...draft, department: v })}
                    >
                      <SelectTrigger id="staff-department" className="rounded-xl" aria-label="Department">
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="staff-role">Role</Label>
                  <Select
                    value={draft.role}
                    onValueChange={(v) => setDraft({ ...draft, role: v as "staff" | "admin" })}
                  >
                    <SelectTrigger id="staff-role" className="rounded-xl" aria-label="Role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="staff">Staff</SelectItem>
                      {isAdmin ? <SelectItem value="admin">Admin</SelectItem> : null}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button
                  className="rounded-xl"
                  disabled={!canSave || saveStaff.isPending}
                  onClick={() => draft && saveStaff.mutate(draft)}
                >
                  {saveStaff.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {draft.uid ? "Save changes" : "Provision account"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete staff profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {pendingDelete?.displayName ?? "this account"}'s portal profile document. Their
              Firebase Auth login is not removed and should be disabled separately if required.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeStaff.isPending}
              onClick={() => pendingDelete && removeStaff.mutate(pendingDelete.uid)}
            >
              {removeStaff.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
