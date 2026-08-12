import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  ALLOWED_YEARS,
  DEPARTMENTS,
  type AssessmentStatus,
  type AssessmentTargeting,
  type ProctorConfig,
  type Tenant,
} from "@/types/seedit";
import type { AssessmentDoc } from "@/lib/firestore/assessments";
import { Archive, Copy, ExternalLink, Loader2, Pencil, PlayCircle, PauseCircle, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { AssessmentDeliveryPanel } from "@/components/AssessmentDeliveryPanel";

/* -------------------------------- Targeting -------------------------------- */

export function TargetingPicker({
  targeting,
  tenants,
  onChange,
}: {
  targeting: AssessmentTargeting;
  tenants: Tenant[];
  onChange: (next: AssessmentTargeting) => void;
}) {
  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Targeting</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Colleges</Label>
          <div className="flex flex-wrap gap-2">
            {tenants.length === 0 ? (
              <p className="text-xs text-muted-foreground">No colleges available yet.</p>
            ) : (
              tenants.map((t) => {
                const active = targeting.tenantIds.includes(t.id);
                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onChange({ ...targeting, tenantIds: toggle(targeting.tenantIds, t.id) })}
                    onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onChange({ ...targeting, tenantIds: toggle(targeting.tenantIds, t.id) })}
                    className={`flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active ? "border-primary bg-primary-muted text-primary" : "border-border hover:bg-muted/60"
                    }`}
                  >
                    <Checkbox checked={active} className="pointer-events-none size-3.5" />
                    {t.name}
                  </div>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground">Leave empty to target every college.</p>
        </div>

        <div className="space-y-2">
          <Label>Academic years</Label>
          <div className="flex flex-wrap gap-2">
            {ALLOWED_YEARS.map((year) => {
              const active = targeting.years.includes(year);
              return (
                <div
                  key={year}
                  role="button"
                  tabIndex={0}
                  onClick={() => onChange({ ...targeting, years: toggle(targeting.years, year) })}
                  onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onChange({ ...targeting, years: toggle(targeting.years, year) })}
                  className={`flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? "border-primary bg-primary-muted text-primary" : "border-border hover:bg-muted/60"
                  }`}
                >
                  <Checkbox checked={active} className="pointer-events-none size-3.5" />
                  {year}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Departments</Label>
          <div className="flex flex-wrap gap-2">
            {DEPARTMENTS.map((dept) => {
              const active = targeting.departments.includes(dept);
              return (
                <div
                  key={dept}
                  role="button"
                  tabIndex={0}
                  onClick={() => onChange({ ...targeting, departments: toggle(targeting.departments, dept) })}
                  onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onChange({ ...targeting, departments: toggle(targeting.departments, dept) })}
                  className={`flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? "border-primary bg-primary-muted text-primary" : "border-border hover:bg-muted/60"
                  }`}
                >
                  <Checkbox checked={active} className="pointer-events-none size-3.5" />
                  {dept}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Scheduling -------------------------------- */

function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function ScheduleFields({
  scheduledStart,
  scheduledEnd,
  onChange,
}: {
  scheduledStart: string | null | undefined;
  scheduledEnd: string | null | undefined;
  onChange: (next: { scheduledStart: string | null; scheduledEnd: string | null }) => void;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Scheduling</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="scheduled-start">Starts at</Label>
          <Input
            id="scheduled-start"
            type="datetime-local"
            className="rounded-xl"
            value={isoToLocal(scheduledStart)}
            onChange={(e) =>
              onChange({ scheduledStart: localToIso(e.target.value), scheduledEnd: scheduledEnd ?? null })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scheduled-end">Ends at</Label>
          <Input
            id="scheduled-end"
            type="datetime-local"
            className="rounded-xl"
            value={isoToLocal(scheduledEnd)}
            onChange={(e) =>
              onChange({ scheduledStart: scheduledStart ?? null, scheduledEnd: localToIso(e.target.value) })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Proctoring -------------------------------- */

export function ProctoringBar({
  config,
  onChange,
}: {
  config: ProctorConfig;
  onChange: (next: ProctorConfig) => void;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Proctoring</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex items-center justify-between rounded-xl border p-3">
          <Label htmlFor="proctor-enabled" className="text-sm font-medium">
            Proctoring enabled
          </Label>
          <Switch
            id="proctor-enabled"
            checked={config.enabled}
            onCheckedChange={(v) => onChange({ ...config, enabled: v })}
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border p-3">
          <Label htmlFor="proctor-camera" className="text-sm font-medium">
            Camera required
          </Label>
          <Switch
            id="proctor-camera"
            checked={config.cameraRequired}
            onCheckedChange={(v) => onChange({ ...config, cameraRequired: v })}
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border p-3">
          <Label htmlFor="proctor-audio" className="text-sm font-medium">
            Audio required
          </Label>
          <Switch
            id="proctor-audio"
            checked={config.audioRequired}
            onCheckedChange={(v) => onChange({ ...config, audioRequired: v })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tab-switch-limit">Tab-switch limit</Label>
          <Input
            id="tab-switch-limit"
            type="number"
            min={0}
            className="rounded-xl"
            value={config.tabSwitchLimit}
            onChange={(e) => onChange({ ...config, tabSwitchLimit: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max-violations">Max violations</Label>
          <Input
            id="max-violations"
            type="number"
            min={0}
            className="rounded-xl"
            value={config.maxViolations}
            onChange={(e) => onChange({ ...config, maxViolations: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border p-3">
          <Label htmlFor="proctor-autosubmit" className="text-sm font-medium">
            Auto-submit on violation
          </Label>
          <Switch
            id="proctor-autosubmit"
            checked={config.autoSubmitOnViolation}
            onCheckedChange={(v) => onChange({ ...config, autoSubmitOnViolation: v })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- List card -------------------------------- */

const STATUS_VARIANT: Record<AssessmentStatus, "secondary" | "default" | "outline"> = {
  draft: "outline",
  active: "default",
  archived: "secondary",
};

export function AssessmentListCard({
  title,
  emptyLabel,
  isLoading,
  assessments,
  onCreate,
  onEdit,
  onDuplicate,
  onToggleStatus,
  onArchive,
  onDelete,
  pendingDelete,
  setPendingDelete,
  confirmDelete,
  isDeleting,
  metaFor,
}: {
  title: string;
  emptyLabel: string;
  isLoading: boolean;
  assessments: AssessmentDoc[];
  onCreate: () => void;
  onEdit: (a: AssessmentDoc) => void;
  onDuplicate: (a: AssessmentDoc) => void;
  onToggleStatus: (a: AssessmentDoc) => void;
  onArchive: (a: AssessmentDoc) => void;
  onDelete: (a: AssessmentDoc) => void;
  pendingDelete: AssessmentDoc | null;
  setPendingDelete: (a: AssessmentDoc | null) => void;
  confirmDelete: () => void;
  isDeleting: boolean;
  metaFor: (a: AssessmentDoc) => string;
}) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? assessments.filter(
        (a) =>
          a.title.toLowerCase().includes(search.toLowerCase()) ||
          a.id.toLowerCase().includes(search.toLowerCase()),
      )
    : assessments;

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          {/* Title row — use div not CardTitle to avoid p>Badge nesting */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            <Badge variant="secondary" className="rounded-full text-[11px]">
              {filtered.length}{search.trim() && assessments.length !== filtered.length ? `/${assessments.length}` : ""}
            </Badge>
          </div>
          <Button size="sm" className="rounded-xl" onClick={onCreate}>
            New
          </Button>
        </div>
        {/* Slug search */}
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="rounded-xl pl-8 text-xs h-8"
            placeholder="Search by title or slug / ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {search.trim() ? `No assessments matching "${search}"` : emptyLabel}
          </p>
        ) : (
          filtered.map((a) => (
            <div key={a.id} className="surface-card space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.title}</p>
                  {/* Slug / ID row — copyable */}
                  <div className="mt-0.5 flex items-center gap-1">
                    <code className="truncate text-[10px] text-muted-foreground font-mono">{a.id}</code>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 hover:bg-muted"
                      title="Copy assessment ID/slug"
                      onClick={() => navigator.clipboard.writeText(a.id)}
                    >
                      <Copy className="size-2.5 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{metaFor(a)}</p>
                  {/* CDN URL indicator */}
                  {a.cdnUrl && (
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[10px] text-emerald-600 font-medium">● Published</span>
                      <a
                        href={a.cdnUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-primary underline underline-offset-2 flex items-center gap-0.5"
                      >
                        CDN <ExternalLink className="size-2.5" />
                      </a>
                      <button
                        type="button"
                        className="shrink-0 rounded p-0.5 hover:bg-muted"
                        title="Copy CDN URL"
                        onClick={() => navigator.clipboard.writeText(a.cdnUrl!)}
                      >
                        <Copy className="size-2.5 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                  {/* Guest code badge */}
                  {a.guestEnabled && a.assessmentCode && (
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[10px] text-blue-600 font-medium">Guest code:</span>
                      <code className="text-[10px] font-mono font-bold tracking-wider">{a.assessmentCode}</code>
                      <button
                        type="button"
                        className="shrink-0 rounded p-0.5 hover:bg-muted"
                        title="Copy guest code"
                        onClick={() => navigator.clipboard.writeText(a.assessmentCode!)}
                      >
                        <Copy className="size-2.5 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                  {/* Delivery status strip — shows tests/cohort/student counts */}
                  <div className="mt-1.5">
                    <AssessmentDeliveryPanel assessmentId={a.id} compact />
                  </div>
                </div>
                <Badge variant={STATUS_VARIANT[a.status]} className="shrink-0 rounded-full text-[10px] capitalize">
                  {a.status}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="icon" variant="ghost" className="size-8 rounded-lg" aria-label="Edit assessment" onClick={() => onEdit(a)}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="size-8 rounded-lg" aria-label="Duplicate assessment" onClick={() => onDuplicate(a)}>
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-lg"
                  aria-label={a.status === "active" ? "Unpublish assessment" : "Publish assessment"}
                  onClick={() => onToggleStatus(a)}
                >
                  {a.status === "active" ? <PauseCircle className="size-3.5" /> : <PlayCircle className="size-3.5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-lg"
                  aria-label="Archive assessment"
                  disabled={a.status === "archived"}
                  onClick={() => onArchive(a)}
                >
                  <Archive className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-lg text-destructive"
                  aria-label="Delete assessment"
                  onClick={() => onDelete(a)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDelete?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the assessment and its questions/problem data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

