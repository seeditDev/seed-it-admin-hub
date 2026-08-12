import { collectionGroup, collection, getDocs, limit, query, where, orderBy } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

export interface ResultRow {
  path: string;
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  cohortId: string;
  /** Academic graduation year (e.g. "2027") derived from cohortId if not present */
  year: string;
  department: string;
  rollNumber: string;
  assessmentId: string;
  assessmentTitle: string;
  /** Normalised type: "mcq" | "coding" | "multisection" | "spoken-english" */
  assessmentType: string;
  /** @deprecated use assessmentType */
  type: string;
  assessmentVersion: number;
  totalScore: number;
  maxScore: number;
  percentage: number;
  /** true when percentage >= passPercentage (defaults to 40 if not stored) */
  passed: boolean;
  status: string;
  submittedAt: Date | null;
  violations: number;
  timeTakenSeconds: number;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ts = value as { toDate?: () => Date };
  return typeof ts.toDate === "function" ? ts.toDate() : null;
}

/**
 * Reads every canonical result doc via a collection-group query on
 * `assessmentResults/{assessmentId}/students` and
 * `assessmentResults/{assessmentId}/guests`.
 *
 * Field name normalisation:
 *  - MSA writes:     assessmentName, score, totalMarks, type='multisection'
 *  - Coding writes:  assessmentName / testName, score, totalMarks, type='coding'
 *  - MCQ writes:     assessmentName / assessmentTitle, score, totalMarks, type='mcq'
 *
 * Deduplication: if a student submitted the same assessment more than once
 * (retry or network retry), only the latest submittedAt document is kept.
 */
export async function listResults(max = 2000): Promise<ResultRow[]> {
  const [studentsSnap, guestsSnap] = await Promise.all([
    getDocs(query(collectionGroup(getDb(), "students"), limit(max))),
    getDocs(query(collectionGroup(getDb(), "guests"), limit(500))),
  ]);

  const allDocs = [
    ...studentsSnap.docs.filter((d) => d.ref.path.startsWith("assessmentResults/")),
    ...guestsSnap.docs.filter((d) => d.ref.path.startsWith("assessmentResults/")),
  ];

  const rows = allDocs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const proctor = (data['proctorSummary'] ?? {}) as Record<string, unknown>;

    // Score — MSA/Coding write 'score'; some write 'totalScore'
    const totalScore = Number(data['score'] ?? data['totalScore'] ?? 0);
    // Max — MSA/Coding write 'totalMarks'; some write 'maxScore'
    const maxScore = Number(data['totalMarks'] ?? data['maxScore'] ?? 0);
    // Title — normalise across all assessment types
    const assessmentTitle = String(
      data['assessmentName'] ?? data['testName'] ?? data['assessmentTitle'] ?? data['title'] ?? ""
    );
    // Assessment ID — from doc path: assessmentResults/{assessmentId}/students/{userId}
    const pathParts = d.ref.path.split("/");
    const assessmentIdFromPath = pathParts[0] === "assessmentResults" ? (pathParts[1] ?? "") : "";
    const assessmentId = String(
      data['assessmentId'] ?? data['testID'] ?? assessmentIdFromPath
    );
    // Type — normalise aliases
    const rawType = String(data['type'] ?? "");
    const assessmentType = rawType.replace("multi-section", "multisection");
    // Version
    const assessmentVersion = Number(data['assessmentVersion'] ?? 1);
    // Time taken
    const timeTakenSeconds = Number(data['timeTakenSeconds'] ?? data['timeTaken'] ?? 0);
    // Percentage
    const pct = Number(data['percentage'] ?? (maxScore > 0 ? (totalScore / maxScore) * 100 : 0));
    // Pass/fail — use stored passPercentage if available, else 40%
    const passThreshold = Number(data['passPercentage'] ?? 40);
    const passed = pct >= passThreshold;
    // Cohort / year
    const cohortId = String(data['cohortId'] ?? data['year'] ?? "");
    const year = String(data['year'] ?? cohortId ?? "");

    return {
      path: d.ref.path,
      userId: String(data['userId'] ?? data['email'] ?? d.id),
      email: String(data['email'] ?? ""),
      displayName: String(data['displayName'] ?? data['name'] ?? ""),
      tenantId: String(data['tenantId'] ?? data['college'] ?? ""),
      cohortId,
      year,
      department: String(data['department'] ?? ""),
      rollNumber: String(data['rollNumber'] ?? ""),
      assessmentId,
      assessmentTitle,
      assessmentType,
      type: assessmentType, // backward compat alias
      assessmentVersion,
      totalScore,
      maxScore,
      percentage: pct,
      passed,
      status: String(data['status'] ?? "submitted"),
      submittedAt: toDate(data['submittedAt'] ?? data['submittedAtISO']),
      violations: Number(proctor['totalViolations'] ?? data['violationCount'] ?? 0),
      timeTakenSeconds,
    } satisfies ResultRow;
  });

  // Deduplication: for same userId + assessmentId keep the doc with the latest submittedAt
  const dedupeMap = new Map<string, ResultRow>();
  for (const row of rows) {
    const key = `${row.userId}::${row.assessmentId}`;
    const existing = dedupeMap.get(key);
    if (!existing) {
      dedupeMap.set(key, row);
    } else {
      // Keep the latest submission
      const existingTime = existing.submittedAt?.getTime() ?? 0;
      const rowTime = row.submittedAt?.getTime() ?? 0;
      if (rowTime > existingTime) dedupeMap.set(key, row);
    }
  }

  return Array.from(dedupeMap.values());
}

/**
 * Staff-scoped fast read from the denormalized tenantResults collection.
 * Reads ONLY the requesting tenant's results — no cross-tenant data exposure.
 *
 * Uses  tenantResults/{tenantId}/results/{autoId}
 * which is written at submit time by all three assessment engines (MCQ / Coding / MSA).
 *
 * Firestore rules restrict this collection to:
 *   - isAdmin()         → all tenants
 *   - isStaff()         → own tenant only (myTenant() == tenantId)
 */
export async function listResultsByTenant(
  tenantId: string,
  opts?: {
    assessmentId?: string;
    cohortId?: string;
    maxResults?: number;
  },
): Promise<ResultRow[]> {
  const col = collection(getDb(), "tenantResults", tenantId, "results");
  const constraints: Parameters<typeof query>[1][] = [];

  if (opts?.assessmentId) {
    constraints.push(where("assessmentId", "==", opts.assessmentId));
  }
  if (opts?.cohortId) {
    constraints.push(where("cohortId", "==", opts.cohortId));
  }
  constraints.push(orderBy("submittedAt", "desc"));
  constraints.push(limit(opts?.maxResults ?? 2000));

  const snap = await getDocs(query(col, ...constraints));

  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const proctor = (data['proctorSummary'] ?? {}) as Record<string, unknown>;
    const totalScore = Number(data['score'] ?? data['totalScore'] ?? 0);
    const maxScore = Number(data['totalMarks'] ?? data['maxScore'] ?? 0);
    const assessmentTitle = String(
      data['assessmentName'] ?? data['testName'] ?? data['assessmentTitle'] ?? ""
    );
    // Assessment ID — from data field only (parent path resolves to tenantId here, not assessmentId)
    const assessmentId = String(data['assessmentId'] ?? data['testID'] ?? "");
    const rawType = String(data['type'] ?? "");
    const assessmentType = rawType.replace("multi-section", "multisection");
    const assessmentVersion = Number(data['assessmentVersion'] ?? 1);
    const timeTakenSeconds = Number(data['timeTakenSeconds'] ?? data['timeTaken'] ?? 0);
    const pct = Number(data['percentage'] ?? (maxScore > 0 ? (totalScore / maxScore) * 100 : 0));
    const passThreshold = Number(data['passPercentage'] ?? 40);
    const passed = pct >= passThreshold;
    const cohortId = String(data['cohortId'] ?? data['year'] ?? "");
    const year = String(data['year'] ?? cohortId ?? "");

    return {
      path: d.ref.path,
      userId: String(data['userId'] ?? data['email'] ?? d.id),
      email: String(data['email'] ?? ""),
      displayName: String(data['displayName'] ?? data['name'] ?? ""),
      tenantId: String(data['tenantId'] ?? data['college'] ?? tenantId),
      cohortId,
      year,
      department: String(data['department'] ?? ""),
      rollNumber: String(data['rollNumber'] ?? ""),
      assessmentId,
      assessmentTitle,
      assessmentType,
      type: assessmentType,
      assessmentVersion,
      totalScore,
      maxScore,
      percentage: pct,
      passed,
      status: String(data['status'] ?? "submitted"),
      submittedAt: toDate(data['submittedAt'] ?? data['submittedAtISO']),
      violations: Number(proctor['totalViolations'] ?? data['violationCount'] ?? 0),
      timeTakenSeconds,
    } satisfies ResultRow;
  });
}
