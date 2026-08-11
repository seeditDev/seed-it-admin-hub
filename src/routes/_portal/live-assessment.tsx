/**
 * live-assessment.tsx
 *
 * Admin page: Live Assessment Monitor
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows every contestAttempt where completed == false.
 *
 * Per-session admin actions:
 *
 * ── MCQ / Coding ──────────────────────────────────────────────────────────────
 *   • Resume: no action needed — student can continue from where they left off
 *     (MCQ answers are persisted per question in the session doc).
 *   • Reset Attempt: deletes contestAttempts + assessmentResults → fresh start.
 *   • Force Complete: marks completed = true → blocks further attempts.
 *
 * ── MSA (Multi-Section Assessment) ───────────────────────────────────────────
 *   All of the above, PLUS a "Manage Sections" drawer:
 *   • Allow all unstarted/incomplete sections → student can continue from
 *     whichever section isn't done yet (in-progress sections resume).
 *   • Reset specific section(s) → mark section back to 'not_started' so the
 *     student can retake just that section.
 *   • Full reset → deletes the entire session (same as MCQ Reset).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  collectionGroup,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Shield,
  Trash2,
  User,
  Zap,
  ChevronRight,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_portal/live-assessment")({
  head: () => ({
    meta: [
      { title: "Live Assessment Monitor | SEED-IT Admin" },
      {
        name: "description",
        content:
          "Real-time view of active assessment sessions and emergency reset controls.",
      },
    ],
  }),
  component: LiveAssessmentPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface SectionStatus {
  status: "not_started" | "in_progress" | "completed";
  startedAt?: string;
  completedAt?: string;
}

interface ActiveSection {
  id: string;
  name: string;
  idx: number;
  durationMinutes?: number;
}

interface ActiveSession {
  docPath: string;
  uid: string;
  assessmentId: string;
  assessmentName: string;
  type: "mcq" | "msa" | "coding" | string;
  startedAtISO: string;
  lastSavedAt: Timestamp | null;
  timeRemainingSeconds: number;
  sections: Record<string, SectionStatus>;
  activeSection: ActiveSection | null;
  completed: boolean;
  autoSubmitted: boolean;
}

type ConfirmAction = "reset" | "force-complete" | "section-reset" | "allow-resume";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function elapsed(isoStart: string): string {
  if (!isoStart) return "—";
  const ms = Date.now() - new Date(isoStart).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "< 1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function lastSeen(ts: Timestamp | null): string {
  if (!ts) return "never";
  const ms = Date.now() - ts.toMillis();
  if (ms < 60000) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function staleLevel(ts: Timestamp | null): "active" | "warn" | "stale" {
  if (!ts) return "stale";
  const ms = Date.now() - ts.toMillis();
  if (ms < 5 * 60000) return "active";
  if (ms < 15 * 60000) return "warn";
  return "stale";
}

function sectionIcon(status: SectionStatus["status"]) {
  if (status === "completed")
    return <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />;
  if (status === "in_progress")
    return <Zap className="size-4 text-yellow-400 shrink-0 animate-pulse" />;
  return <Circle className="size-4 text-muted-foreground/40 shrink-0" />;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function LiveAssessmentPage() {
  const { isAdmin } = useAuth();
  const db = getDb();

  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "mcq" | "msa" | "coding">("all");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: ConfirmAction | null;
    session: ActiveSession | null;
    sectionIds?: string[]; // for section-reset
  }>({ open: false, action: null, session: null });
  const [actionLoading, setActionLoading] = useState(false);

  // MSA section management sheet
  const [sectionSheet, setSectionSheet] = useState<{
    open: boolean;
    session: ActiveSession | null;
    selectedSections: Set<string>; // for selective reset
  }>({ open: false, session: null, selectedSections: new Set() });

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch both contestAttempts (MCQ/coding) AND multiSectionAttempts (MSA)
      // in parallel — all assessments are treated identically in the monitor.
      const [contestSnap, msaSnap] = await Promise.all([
        getDocs(query(
          collectionGroup(db, "contestAttempts"),
          where("completed", "==", false),
        )),
        getDocs(query(
          collectionGroup(db, "multiSectionAttempts"),
          where("completed", "==", false),
        )),
      ]);

      // Merge and deduplicate by docPath (in case of duplicate writes)
      const seen = new Set<string>();
      const allDocs = [...contestSnap.docs, ...msaSnap.docs].filter((d) => {
        if (seen.has(d.ref.path)) return false;
        seen.add(d.ref.path);
        return true;
      });

      const result: ActiveSession[] = allDocs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const pathParts = d.ref.path.split("/");
        const uid = pathParts[1] ?? "unknown";
        const assessmentId =
          pathParts[3] ?? (data["assessmentId"] as string) ?? "";
        return {
          docPath: d.ref.path,
          uid,
          assessmentId,
          assessmentName: String(data["assessmentName"] ?? assessmentId),
          type: String(data["type"] ?? "msa") as ActiveSession["type"],
          startedAtISO: String(data["startedAtISO"] ?? ""),
          lastSavedAt: (data["lastSavedAt"] as Timestamp) ?? null,
          timeRemainingSeconds: Number(data["timeRemainingSeconds"] ?? 0),
          sections:
            (data["sections"] as Record<string, SectionStatus>) ?? {},
          activeSection:
            (data["activeSection"] as ActiveSession["activeSection"]) ?? null,
          completed: Boolean(data["completed"]),
          autoSubmitted: Boolean(data["autoSubmitted"]),
        };
      });
      result.sort((a, b) => {
        const aMs = a.lastSavedAt?.toMillis() ?? 0;
        const bMs = b.lastSavedAt?.toMillis() ?? 0;
        return bMs - aMs;
      });
      setSessions(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("[LiveAssessment] fetchSessions error:", err);
      toast.error(
        "Failed to load sessions. Deploy Firestore rules and ensure you have admin access.",
      );
    } finally {
      setLoading(false);
    }

  }, [db]);

  useEffect(() => {
    void fetchSessions();
    const id = setInterval(() => void fetchSessions(), 60000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  /** Delete contestAttempts doc + any results → student retakes from scratch */
  async function doReset(session: ActiveSession) {
    await deleteDoc(doc(db, session.docPath));
    // Delete result docs (try both path patterns)
    const resultPaths = [
      `assessmentResults/${session.assessmentId}/students/${session.uid}`,
      `assessmentResults/${session.assessmentId}/${session.uid}`,
    ];
    await Promise.allSettled(resultPaths.map((p) => deleteDoc(doc(db, p))));
    setSessions((prev) => prev.filter((s) => s.docPath !== session.docPath));
    toast.success(`✅ Full reset done — ${session.uid.slice(0, 12)}… can retake from scratch.`);
  }

  /** Mark completed=true to block resume without touching result */
  async function doForceComplete(session: ActiveSession) {
    await setDoc(
      doc(db, session.docPath),
      { completed: true, autoSubmitted: true, autoReason: "admin_force_complete", completedAt: serverTimestamp() },
      { merge: true },
    );
    setSessions((prev) => prev.filter((s) => s.docPath !== session.docPath));
    toast.success(`Session force-completed for ${session.uid.slice(0, 12)}…`);
  }

  /**
   * Reset specific MSA sections back to 'not_started'.
   * Student can re-enter those sections; completed sections stay completed.
   */
  async function doSectionReset(session: ActiveSession, sectionIds: string[]) {
    const updates: Record<string, unknown> = { lastSavedAt: serverTimestamp() };
    for (const sid of sectionIds) {
      updates[`sections.${sid}.status`] = "not_started";
      updates[`sections.${sid}.startedAt`] = null;
      updates[`sections.${sid}.completedAt`] = null;
      // Clear saved answers for that section
      updates[`sectionAnswers.${sid}`] = {};
    }
    // If the active section is being reset, clear it
    if (session.activeSection && sectionIds.includes(session.activeSection.id)) {
      updates["activeSection"] = null;
    }
    await setDoc(doc(db, session.docPath), updates, { merge: true });
    // Refresh the local session
    setSessions((prev) =>
      prev.map((s) => {
        if (s.docPath !== session.docPath) return s;
        const newSections = { ...s.sections };
        for (const sid of sectionIds) {
          newSections[sid] = { status: "not_started" };
        }
        return { ...s, sections: newSections, activeSection: null };
      }),
    );
    toast.success(
      `Section(s) reset: ${sectionIds.join(", ")} — student can retake them.`,
    );
  }

  /**
   * Allow resume: does nothing on the server (student already can resume).
   * This is informational — admin confirms the student just needs to reload.
   */
  function doAllowResume(session: ActiveSession) {
    toast.info(
      `Student ${session.uid.slice(0, 12)}… can resume by reloading the assessment page. No server action needed.`,
      { duration: 6000 },
    );
  }

  // Dispatch from dialog
  const dispatchAction = async () => {
    const { action, session, sectionIds } = confirmDialog;
    if (!session || !action) return;
    setActionLoading(true);
    try {
      if (action === "reset") await doReset(session);
      else if (action === "force-complete") await doForceComplete(session);
      else if (action === "section-reset" && sectionIds) await doSectionReset(session, sectionIds);
      else if (action === "allow-resume") doAllowResume(session);
    } catch (err) {
      console.error("[LiveAssessment] action error:", err);
      toast.error("Action failed. Check your admin permissions.");
    } finally {
      setActionLoading(false);
      setConfirmDialog({ open: false, action: null, session: null });
      setSectionSheet({ open: false, session: null, selectedSections: new Set() });
    }
  };

  // ── Filtered sessions ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (typeFilter !== "all" && s.type !== typeFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        s.uid.toLowerCase().includes(q) ||
        s.assessmentName.toLowerCase().includes(q) ||
        s.assessmentId.toLowerCase().includes(q)
      );
    });
  }, [sessions, typeFilter, search]);

  const staleCount = sessions.filter(
    (s) => s.lastSavedAt && Date.now() - s.lastSavedAt.toMillis() > 10 * 60000,
  ).length;

  const msaCount = sessions.filter((s) => s.type === "msa").length;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Radio className="size-6 text-red-400 animate-pulse" />
            Live Assessment Monitor
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time active sessions (not yet completed).
            {lastRefresh && (
              <span className="ml-2 text-xs text-muted-foreground/60">
                Refreshed: {lastRefresh.toLocaleTimeString()} · auto every 60 s
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-xl gap-2"
          onClick={() => void fetchSessions()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Active Sessions", value: sessions.length, color: "text-emerald-400" },
          { label: "Stale (>10 min)", value: staleCount, color: staleCount > 0 ? "text-red-400" : "text-muted-foreground" },
          { label: "MSA Sessions", value: msaCount, color: "text-indigo-400" },
          { label: "Role", value: isAdmin ? "Super Admin" : "Staff", color: "text-sm font-semibold", icon: <Shield className="size-4 text-indigo-400 mr-1" /> },
        ].map(({ label, value, color, icon }) => (
          <Card key={label} className="glass-panel rounded-2xl border">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`mt-1 text-3xl font-bold ${color} flex items-center`}>
                {icon}{value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="live-search"
            className="rounded-xl pl-9 w-64"
            placeholder="Search UID, assessment…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {(["all", "mcq", "msa", "coding"] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={typeFilter === t ? "default" : "outline"}
              className="rounded-xl h-8 text-xs"
              onClick={() => setTypeFilter(t)}
            >
              {t.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading && sessions.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span>Loading active sessions…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle2 className="size-12 text-emerald-500/40 mb-3" />
          <p className="text-lg font-semibold">No active sessions</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search || typeFilter !== "all"
              ? "No sessions match your filters."
              : "All assessments are idle right now."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((session) => {
            const level = staleLevel(session.lastSavedAt);
            const borderColor =
              level === "active"
                ? "border-emerald-500/20"
                : level === "warn"
                  ? "border-yellow-500/30"
                  : "border-red-500/30";
            const dotColor =
              level === "active"
                ? "text-emerald-400"
                : level === "warn"
                  ? "text-yellow-400"
                  : "text-red-400";
            const isMSA = session.type === "msa";
            const sectionEntries = Object.entries(session.sections);

            return (
              <Card
                key={session.docPath}
                className={`glass-panel rounded-2xl border transition-all ${borderColor}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-semibold truncate">
                        {session.assessmentName}
                      </CardTitle>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className="rounded-full text-[10px] px-2 py-0"
                        >
                          {session.type.toUpperCase()}
                        </Badge>
                        {level === "stale" && (
                          <Badge
                            variant="destructive"
                            className="rounded-full text-[10px] px-2 py-0 gap-1"
                          >
                            <AlertTriangle className="size-2.5" /> Stale
                          </Badge>
                        )}
                        {level === "warn" && (
                          <Badge className="rounded-full text-[10px] px-2 py-0 bg-yellow-500/20 text-yellow-300 border-yellow-500/30">
                            Idle
                          </Badge>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs font-mono shrink-0 ${dotColor}`}>●</span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <User className="size-3 shrink-0" />
                    <span className="font-mono truncate">{session.uid}</span>
                  </div>

                  {session.activeSection && (
                    <div className="flex items-center gap-1.5 text-indigo-300">
                      <Zap className="size-3 shrink-0" />
                      <span>
                        Active:{" "}
                        <strong>{session.activeSection.name}</strong>
                      </span>
                    </div>
                  )}

                  {/* MSA section progress summary */}
                  {isMSA && sectionEntries.length > 0 && (
                    <div className="space-y-0.5 rounded-lg bg-muted/20 p-2">
                      {sectionEntries.map(([id, sec]) => (
                        <div
                          key={id}
                          className="flex items-center gap-1.5 text-[11px]"
                        >
                          {sectionIcon(sec.status)}
                          <span className="truncate">{id}</span>
                          <span
                            className={`ml-auto shrink-0 font-mono ${
                              sec.status === "completed"
                                ? "text-emerald-400"
                                : sec.status === "in_progress"
                                  ? "text-yellow-400"
                                  : "text-muted-foreground/50"
                            }`}
                          >
                            {sec.status.replace("_", " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Timing */}
                  <div className="flex items-center justify-between pt-1 border-t border-border/40">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {elapsed(session.startedAtISO)} ago
                    </span>
                    <span className={level === "stale" ? "text-red-400" : ""}>
                      Seen {lastSeen(session.lastSavedAt)}
                    </span>
                  </div>

                  {session.timeRemainingSeconds > 0 && (
                    <div className="text-[11px] text-muted-foreground/60">
                      ~{Math.ceil(session.timeRemainingSeconds / 60)} min remaining (at last save)
                    </div>
                  )}

                  {/* ── Action buttons ── */}
                  <div className="pt-2 space-y-1.5">
                    {/* Allow resume (informational) */}
                    <Button
                      id={`resume-${session.uid}-${session.assessmentId}`}
                      variant="outline"
                      size="sm"
                      className="w-full rounded-xl h-8 text-xs gap-1 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                      onClick={() =>
                        setConfirmDialog({ open: true, action: "allow-resume", session })
                      }
                    >
                      <ChevronRight className="size-3" />
                      {isMSA
                        ? "Resume (student continues unfinished sections)"
                        : "Resume (student continues from last save)"}
                    </Button>

                    {/* MSA: Manage Sections */}
                    {isMSA && (
                      <Button
                        id={`sections-${session.uid}-${session.assessmentId}`}
                        variant="outline"
                        size="sm"
                        className="w-full rounded-xl h-8 text-xs gap-1 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10"
                        onClick={() =>
                          setSectionSheet({
                            open: true,
                            session,
                            selectedSections: new Set(),
                          })
                        }
                      >
                        <Settings2 className="size-3" />
                        Manage Sections
                      </Button>
                    )}

                    <div className="flex gap-1.5">
                      <Button
                        id={`reset-${session.uid}-${session.assessmentId}`}
                        variant="destructive"
                        size="sm"
                        className="flex-1 rounded-xl h-8 text-xs gap-1"
                        onClick={() =>
                          setConfirmDialog({ open: true, action: "reset", session })
                        }
                      >
                        <RotateCcw className="size-3" /> Full Reset
                      </Button>
                      <Button
                        id={`force-${session.uid}-${session.assessmentId}`}
                        variant="outline"
                        size="sm"
                        className="flex-1 rounded-xl h-8 text-xs gap-1"
                        onClick={() =>
                          setConfirmDialog({ open: true, action: "force-complete", session })
                        }
                      >
                        <XCircle className="size-3" /> Force Complete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── MSA Section Management Sheet ── */}
      <Sheet
        open={sectionSheet.open}
        onOpenChange={(v) =>
          !actionLoading &&
          setSectionSheet((p) => ({ ...p, open: v }))
        }
      >
        <SheetContent className="w-full max-w-lg space-y-4 overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Settings2 className="size-5 text-indigo-400" />
              Manage MSA Sections
            </SheetTitle>
            <SheetDescription>
              {sectionSheet.session?.assessmentName} —{" "}
              <code className="text-xs">{sectionSheet.session?.uid}</code>
            </SheetDescription>
          </SheetHeader>

          <Separator />

          {/* Option A: Allow Resume */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-1">
            <p className="text-sm font-semibold text-emerald-300 flex items-center gap-1.5">
              <ChevronRight className="size-4" /> Option A — Allow Resume
            </p>
            <p className="text-xs text-muted-foreground">
              The student just needs to reload the assessment page. They will
              continue from whichever section is <strong>in_progress</strong>.
              Sections already <strong>completed</strong> are locked.
            </p>
            <Button
              size="sm"
              className="mt-2 rounded-xl gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                if (!sectionSheet.session) return;
                doAllowResume(sectionSheet.session);
                setSectionSheet((p) => ({ ...p, open: false }));
              }}
            >
              <ChevronRight className="size-3" /> Confirm — Student Can Resume
            </Button>
          </div>

          {/* Option B: Reset specific sections */}
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 space-y-3">
            <p className="text-sm font-semibold text-indigo-300 flex items-center gap-1.5">
              <Settings2 className="size-4" /> Option B — Reset Selected Sections
            </p>
            <p className="text-xs text-muted-foreground">
              Selected sections are reset to <strong>not_started</strong> — the
              student can retake them. Unselected sections remain unchanged.
            </p>
            <div className="space-y-2">
              {sectionSheet.session &&
                Object.entries(sectionSheet.session.sections).map(
                  ([id, sec]) => (
                    <label
                      key={id}
                      className="flex items-center gap-3 cursor-pointer rounded-lg p-2 hover:bg-muted/30 transition-colors"
                    >
                      <Checkbox
                        id={`sec-check-${id}`}
                        checked={sectionSheet.selectedSections.has(id)}
                        onCheckedChange={(checked) => {
                          setSectionSheet((prev) => {
                            const next = new Set(prev.selectedSections);
                            if (checked) next.add(id);
                            else next.delete(id);
                            return { ...prev, selectedSections: next };
                          });
                        }}
                        disabled={sec.status === "not_started"}
                      />
                      <div className="flex items-center gap-2 flex-1">
                        {sectionIcon(sec.status)}
                        <span className="text-sm">{id}</span>
                        <span className="ml-auto text-xs font-mono text-muted-foreground">
                          {sec.status.replace("_", " ")}
                        </span>
                      </div>
                    </label>
                  ),
                )}
            </div>
            {sectionSheet.session &&
              Object.values(sectionSheet.session.sections).every(
                (s) => s.status === "not_started",
              ) && (
                <p className="text-xs text-muted-foreground/60 italic">
                  All sections are already not_started — nothing to reset.
                </p>
              )}
            <Button
              size="sm"
              className="rounded-xl gap-1"
              variant="outline"
              disabled={sectionSheet.selectedSections.size === 0 || actionLoading}
              onClick={() => {
                if (!sectionSheet.session) return;
                setConfirmDialog({
                  open: true,
                  action: "section-reset",
                  session: sectionSheet.session,
                  sectionIds: [...sectionSheet.selectedSections],
                });
              }}
            >
              <RotateCcw className="size-3" />
              Reset {sectionSheet.selectedSections.size > 0
                ? `${sectionSheet.selectedSections.size} section(s)`
                : "selected sections"}
            </Button>
          </div>

          {/* Option C: Full reset */}
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-1">
            <p className="text-sm font-semibold text-red-400 flex items-center gap-1.5">
              <Trash2 className="size-4" /> Option C — Full Reset
            </p>
            <p className="text-xs text-muted-foreground">
              Deletes the entire session and result. Student starts completely
              fresh — all sections back to zero.
            </p>
            <Button
              size="sm"
              variant="destructive"
              className="mt-2 rounded-xl gap-1"
              onClick={() => {
                if (!sectionSheet.session) return;
                setConfirmDialog({ open: true, action: "reset", session: sectionSheet.session });
              }}
            >
              <RotateCcw className="size-3" /> Full Reset
            </Button>
          </div>

          <SheetFooter>
            <Button
              variant="ghost"
              onClick={() => setSectionSheet((p) => ({ ...p, open: false }))}
            >
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Confirm Dialog ── */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(v) =>
          !actionLoading && setConfirmDialog((p) => ({ ...p, open: v }))
        }
      >
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmDialog.action === "reset" ? (
                <><RotateCcw className="size-5 text-destructive" /> Full Reset</>
              ) : confirmDialog.action === "force-complete" ? (
                <><XCircle className="size-5 text-yellow-500" /> Force Complete</>
              ) : confirmDialog.action === "section-reset" ? (
                <><Settings2 className="size-5 text-indigo-400" /> Reset Sections</>
              ) : (
                <><ChevronRight className="size-5 text-emerald-400" /> Allow Resume</>
              )}
            </DialogTitle>
            <DialogDescription className="pt-2 space-y-2 text-sm">
              {confirmDialog.action === "reset" && (
                <>
                  <p>Permanently delete this session and any saved result for:</p>
                  <div className="rounded-xl bg-muted/40 p-3 space-y-1 text-sm">
                    <p><strong>Assessment:</strong> {confirmDialog.session?.assessmentName}</p>
                    <p><strong>UID:</strong> <code className="text-xs">{confirmDialog.session?.uid}</code></p>
                  </div>
                  <p className="text-destructive font-medium">
                    ⚠️ The student will retake the entire assessment from scratch.
                  </p>
                </>
              )}
              {confirmDialog.action === "force-complete" && (
                <>
                  <p>Mark this session as completed. The student <strong>cannot</strong> resume or retake.</p>
                  <div className="rounded-xl bg-muted/40 p-3 space-y-1 text-sm">
                    <p><strong>Assessment:</strong> {confirmDialog.session?.assessmentName}</p>
                    <p><strong>UID:</strong> <code className="text-xs">{confirmDialog.session?.uid}</code></p>
                  </div>
                </>
              )}
              {confirmDialog.action === "section-reset" && (
                <>
                  <p>Reset these sections to <strong>not_started</strong>:</p>
                  <ul className="list-disc pl-5 text-sm space-y-0.5">
                    {confirmDialog.sectionIds?.map((id) => <li key={id}>{id}</li>)}
                  </ul>
                  <p className="text-muted-foreground">The student can retake only these sections.</p>
                </>
              )}
              {confirmDialog.action === "allow-resume" && (
                <>
                  <p>No server-side changes needed. The student can resume by:</p>
                  <ol className="list-decimal pl-5 text-sm space-y-0.5">
                    <li>Reloading the assessment page</li>
                    <li>The in-progress or unstarted sections will be available</li>
                    <li>Completed sections remain locked</li>
                  </ol>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDialog({ open: false, action: null, session: null })}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              variant={
                confirmDialog.action === "reset"
                  ? "destructive"
                  : confirmDialog.action === "allow-resume"
                    ? "outline"
                    : "default"
              }
              onClick={() => void dispatchAction()}
              disabled={actionLoading}
              className="gap-2"
            >
              {actionLoading && <Loader2 className="size-4 animate-spin" />}
              {confirmDialog.action === "reset"
                ? "Yes, Full Reset"
                : confirmDialog.action === "force-complete"
                  ? "Yes, Force Complete"
                  : confirmDialog.action === "section-reset"
                    ? "Yes, Reset Sections"
                    : "Understood"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
