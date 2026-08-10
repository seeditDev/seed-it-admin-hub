import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Users,
  ClipboardCheck,
  UserSquare2,
  Sparkles,
  ArrowUpRight,
  Activity,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { listTenants } from "@/lib/firestore/tenants";
import { listAllUsers } from "@/lib/firestore/users";
import { listAssessments } from "@/lib/firestore/assessments";
import { listResults } from "@/lib/firestore/results";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_portal/dashboard")({
  head: () => ({
    meta: [
      { title: "Executive Dashboard | SEED-IT Admin" },
      {
        name: "description",
        content:
          "Live SEED-IT metrics: tenants, registered students, active assessments, staff and premium licences.",
      },
      { property: "og:title", content: "Executive Dashboard | SEED-IT Admin" },
      {
        property: "og:description",
        content: "Live SEED-IT tenant, roster, assessment and licence metrics.",
      },
    ],
  }),
  component: DashboardPage,
});

const nf = new Intl.NumberFormat("en-US");

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof Users;
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
            <p className="font-display mt-1 text-3xl font-bold leading-none">{nf.format(value)}</p>
          )}
          <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const { scopedTenantId, account } = useAuth();

  const tenantsQ = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const usersQ = useQuery({ queryKey: ["users", "all"], queryFn: listAllUsers });
  const assessmentsQ = useQuery({ queryKey: ["assessments"], queryFn: listAssessments });
  const resultsQ = useQuery({ queryKey: ["results"], queryFn: () => listResults(1500) });

  const loading = tenantsQ.isLoading || usersQ.isLoading || assessmentsQ.isLoading;

  const users = useMemo(() => {
    const all = usersQ.data ?? [];
    return scopedTenantId ? all.filter((u) => u.tenantId === scopedTenantId) : all;
  }, [usersQ.data, scopedTenantId]);

  const tenants = useMemo(() => {
    const all = tenantsQ.data ?? [];
    return scopedTenantId ? all.filter((t) => t.id === scopedTenantId) : all;
  }, [tenantsQ.data, scopedTenantId]);

  const assessments = useMemo(() => {
    const all = assessmentsQ.data ?? [];
    return scopedTenantId
      ? all.filter((a) => a.tenantId === scopedTenantId || a.tenantId === "ALL")
      : all;
  }, [assessmentsQ.data, scopedTenantId]);

  const students = users.filter((u) => u.role === "student");
  const staff = users.filter((u) => u.role === "staff");
  const premium = students.filter((u) => u.premium);
  const activeAssessments = assessments.filter((a) => a.status === "active");

  const byTenant = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of students) {
      const key = s.tenantId || "Unassigned";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const nameOf = new Map(tenants.map((t) => [t.id, t.name] as const));
    return [...map.entries()]
      .map(([id, count]) => ({ tenant: nameOf.get(id) ?? id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [students, tenants]);

  const submissionsOverTime = useMemo(() => {
    const rows = (resultsQ.data ?? []).filter(
      (r) => !scopedTenantId || r.tenantId === scopedTenantId,
    );
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.submittedAt) continue;
      const key = r.submittedAt.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, submissions]) => ({
        date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        submissions,
      }));
  }, [resultsQ.data, scopedTenantId]);

  const activity = useMemo(() => {
    const items: Array<{ id: string; title: string; meta: string; kind: string; at: number }> = [];
    for (const a of assessments) {
      const at = a.createdAt?.toDate?.().getTime() ?? 0;
      items.push({
        id: `a-${a.id}`,
        title: a.title,
        meta: `${a.type.toUpperCase()} • ${a.tenantId} • ${a.status}`,
        kind: "Assessment",
        at,
      });
    }
    for (const s of students) {
      const at = s.createdAt?.toDate?.().getTime() ?? 0;
      if (!at) continue;
      items.push({
        id: `s-${s.uid}`,
        title: s.displayName || s.email,
        meta: `${s.tenantId || "—"} • ${s.year || s.cohortId || "—"} • ${s.department || "—"}`,
        kind: "Student added",
        at,
      });
    }
    return items.sort((a, b) => b.at - a.at).slice(0, 10);
  }, [assessments, students]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">
            Welcome back{account?.displayName ? `, ${account.displayName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform health across tenants, rosters and assessments.
          </p>
        </div>
        <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
          <Activity className="mr-1.5 size-3" />
          Live from Firestore
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Tenants"
          value={tenants.length}
          hint={`${tenants.filter((t) => t.active).length} active`}
          icon={Building2}
          loading={loading}
        />
        <MetricCard
          label="Students"
          value={students.length}
          hint="Registered across cohorts"
          icon={Users}
          loading={loading}
        />
        <MetricCard
          label="Active assessments"
          value={activeAssessments.length}
          hint={`${assessments.length} total authored`}
          icon={ClipboardCheck}
          loading={loading}
        />
        <MetricCard
          label="Staff"
          value={staff.length}
          hint="Faculty & proctors"
          icon={UserSquare2}
          loading={loading}
        />
        <MetricCard
          label="Premium licences"
          value={premium.length}
          hint={
            students.length
              ? `${Math.round((premium.length / students.length) * 100)}% of roster`
              : "No students yet"
          }
          icon={Sparkles}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Students by college tenant</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {loading ? (
              <Skeleton className="size-full rounded-xl" />
            ) : byTenant.length === 0 ? (
              <EmptyChart message="No students provisioned yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byTenant} margin={{ left: -20, top: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                  <XAxis
                    dataKey="tenant"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    interval={0}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-card)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" name="Students" fill="var(--color-chart-1)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Test submissions over time</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {resultsQ.isLoading ? (
              <Skeleton className="size-full rounded-xl" />
            ) : submissionsOverTime.length === 0 ? (
              <EmptyChart message="No submissions recorded yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={submissionsOverTime} margin={{ left: -20, top: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-card)",
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="submissions"
                    stroke="var(--color-chart-2)"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing has been published yet.
            </p>
          ) : (
            <ul className="divide-y">
              {activity.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-accent-foreground">
                    <ArrowUpRight className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.meta}</p>
                  </div>
                  <Badge variant="secondary" className="rounded-full text-[11px]">
                    {item.kind}
                  </Badge>
                  {item.at ? (
                    <span className="hidden w-24 text-right text-[11px] text-muted-foreground sm:block">
                      {new Date(item.at).toLocaleDateString()}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex size-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
      {message}
    </div>
  );
}
