/**
 * AssessmentDeliveryPanel.tsx
 *
 * Shows the full delivery chain for a given assessment:
 *   Assessment status → Linked Tests → Assigned Cohorts → Student count
 *
 * Answers the admin's key questions:
 *   • Is the assessment published?
 *   • Is it attached to a Course Test?
 *   • Which Course / Series?
 *   • Which Cohorts?
 *   • How many students can access it?
 */

import { useQuery } from "@tanstack/react-query";
import { getAssessmentDeliveryStatus } from "@/lib/firestore/delivery";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock,
  Layers,
  Users,
  XCircle,
} from "lucide-react";

interface Props {
  assessmentId: string;
  /** If true, renders as a compact inline strip instead of a full card */
  compact?: boolean;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <Badge className="gap-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3" />
        Published
      </Badge>
    );
  }
  if (status === "archived") {
    return (
      <Badge className="gap-1 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
        <XCircle className="size-3" />
        Archived
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      <Clock className="size-3" />
      Draft
    </Badge>
  );
}

export function AssessmentDeliveryPanel({ assessmentId, compact = false }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["assessmentDelivery", assessmentId],
    queryFn: () => getAssessmentDeliveryStatus(assessmentId),
    enabled: Boolean(assessmentId),
    staleTime: 60_000,
  });

  if (!assessmentId) return null;

  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-40 rounded-lg" />
        <Skeleton className="h-4 w-64 rounded-lg" />
      </div>
    );
  }

  const { assessmentStatus, assessmentVersion, tests, cohorts, totalStudents } = data;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge status={assessmentStatus} />
        <span className="text-muted-foreground/40">·</span>
        <span className="font-mono">v{assessmentVersion}</span>
        <span className="text-muted-foreground/40">·</span>
        <span>
          <span className="font-medium text-foreground">{tests.length}</span> test{tests.length !== 1 ? "s" : ""}
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span>
          <span className="font-medium text-foreground">{cohorts.length}</span> cohort{cohorts.length !== 1 ? "s" : ""}
        </span>
        {totalStudents > 0 && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span>
              <span className="font-medium text-foreground">{totalStudents}</span> students
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <Card className="rounded-2xl border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <CircleDot className="size-4 text-primary" />
          Delivery Status
          <span className="ml-auto font-mono text-xs font-normal text-muted-foreground">
            v{assessmentVersion}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status row */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">Assessment status</span>
          <StatusBadge status={assessmentStatus} />
        </div>

        {/* Tests */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <BookOpen className="size-3" />
            Course Tests ({tests.length})
          </div>
          {tests.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Not yet attached to any Course Test — go to{" "}
              <strong>Courses</strong> to create a test from this assessment.
            </p>
          ) : (
            <ul className="space-y-1">
              {tests.map((t) => (
                <li
                  key={t.testId}
                  className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-xs"
                >
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{t.testName}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{t.courseId}</span>
                  <span className="text-muted-foreground/60">›</span>
                  <span className="text-muted-foreground">{t.seriesId}</span>
                  {t.assessmentVersion < data.assessmentVersion && (
                    <Badge className="ml-auto rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] px-1.5 py-0">
                      stale v{t.assessmentVersion}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Cohorts */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <Layers className="size-3" />
            Assigned Cohorts ({cohorts.length})
          </div>
          {cohorts.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Not yet assigned to any cohort — go to{" "}
              <strong>Module Assignment</strong> to assign.
            </p>
          ) : (
            <ul className="space-y-1">
              {cohorts.map((c) => (
                <li
                  key={c.cohortId}
                  className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-xs"
                >
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{c.cohortLabel}</span>
                  <span className="font-mono text-muted-foreground">{c.cohortYear}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{c.tenantId}</span>
                  {c.studentCount > 0 && (
                    <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                      <Users className="size-2.5" />
                      {c.studentCount}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Total students */}
        {totalStudents > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 text-sm">
            <Users className="size-4 text-primary" />
            <span className="font-medium">{totalStudents}</span>
            <span className="text-muted-foreground">students have access to this assessment</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
