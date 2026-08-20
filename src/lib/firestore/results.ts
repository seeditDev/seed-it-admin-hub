import { collectionGroup, collection, getDocs, limit, query, where, orderBy } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

export interface ResultRow {
  path: string;
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  cohortId: string;
  year: string;
  department: string;
  rollNumber: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentType: string;
  type: string;
  assessmentVersion: number;
  totalScore: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  status: string;
  startedAt: Date | null;
  submittedAt: Date | null;
  violations: number;
  timeTakenSeconds: number;
  autoSubmitted?: boolean;
  submissionReason?: string;
  rawDoc?: Record<string, unknown>;
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value > 1e11 ? value : value * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "—" || trimmed === "N/A" || trimmed === "null") return null;
    if (/^\d{10,13}$/.test(trimmed)) {
      const num = Number(trimmed);
      const d = new Date(num > 1e11 ? num : num * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  const ts = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof ts.toDate === "function") {
    try {
      const d = ts.toDate();
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof ts.seconds === "number") {
    const d = new Date(ts.seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts._seconds === "number") {
    const d = new Date(ts._seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function rowFromDoc(
  d: { id: string; ref: { path: string }; data: () => Record<string, unknown> },
  overrideAssessmentId?: string,
  overrideTenantId?: string,
): ResultRow {
  const data = d.data() as Record<string, unknown>;
  const proctor = (data["proctorSummary"] ?? {}) as Record<string, unknown>;

  const totalScore = Number(data["score"] ?? data["totalScore"] ?? 0);
  const maxScore = Number(data["totalMarks"] ?? data["maxScore"] ?? data["totalQuestions"] ?? 0);
  const assessmentTitle = String(
    data["assessmentTitle"] ?? data["assessmentName"] ?? data["testName"] ?? data["title"] ?? data["name"] ?? ""
  );

  // Path: assessmentResults/{tenantId}/{assessmentId}/{userId}
  const pathParts = d.ref.path.split("/");
  const tenantIdFromPath = pathParts[0] === "assessmentResults" ? (pathParts[1] ?? "") : "";
  const assessmentIdFromPath = pathParts[0] === "assessmentResults" ? (pathParts[2] ?? "") : "";

  const assessmentId = overrideAssessmentId ?? String(data["assessmentId"] ?? data["testID"] ?? data["testId"] ?? assessmentIdFromPath);
  const tenantId = overrideTenantId ?? String(data["tenantId"] ?? data["college"] ?? tenantIdFromPath ?? "");

  const rawType = String(data["type"] ?? data["assessmentType"] ?? data["testType"] ?? "mcq");
  const assessmentType = rawType.replace("multi-section", "multisection");
  const assessmentVersion = Number(data["assessmentVersion"] ?? 1);

  const startedAt = toDate(
    data["startedAt"] ??
    data["startedAtISO"] ??
    data["timeStarted"] ??
    data["timeStartedISO"] ??
    data["startTime"] ??
    data["startTimeISO"] ??
    data["started_at"]
  );

  const submittedAt = toDate(
    data["submittedAt"] ??
    data["submittedAtISO"] ??
    data["completedAt"] ??
    data["completedAtISO"] ??
    data["timeCompleted"] ??
    data["timestamp"]
  );

  let timeTakenSeconds = Number(data["timeTakenSeconds"] ?? data["timeTaken"] ?? data["durationSeconds"] ?? 0);
  if (!timeTakenSeconds && startedAt && submittedAt) {
    timeTakenSeconds = Math.max(0, Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000));
  }

  const pct = Number(data["percentage"] ?? (maxScore > 0 ? (totalScore / maxScore) * 100 : 0));
  const passThreshold = Number(data["passPercentage"] ?? data["passMark"] ?? 40);
  const passed = typeof data["passed"] === "boolean" ? (data["passed"] as boolean) : (pct >= passThreshold);
  const cohortId = String(data["cohortId"] ?? data["year"] ?? "");
  const year = String(data["year"] ?? cohortId ?? "");

  const autoSubmitted = Boolean(data["autoSubmitted"] ?? data["auto_submitted"] ?? false);
  const submissionReason = String(data["submissionReason"] ?? data["autoSubmitReason"] ?? (autoSubmitted ? "auto_submit" : "manual"));

  return {
    path: d.ref.path,
    userId: String(data["userId"] ?? data["uid"] ?? data["email"] ?? d.id),
    email: String(data["email"] ?? data["Email"] ?? ""),
    displayName: String(data["displayName"] ?? data["name"] ?? data["Name"] ?? ""),
    tenantId,
    cohortId,
    year,
    department: String(data["department"] ?? data["Department"] ?? ""),
    rollNumber: String(data["rollNumber"] ?? data["Roll Number"] ?? data["rollNo"] ?? data["RollNo"] ?? data["regNo"] ?? data["registerNumber"] ?? data["roll"] ?? ""),
    assessmentId,
    assessmentTitle: assessmentTitle || assessmentId,
    assessmentType,
    type: assessmentType,
    assessmentVersion,
    totalScore,
    maxScore,
    percentage: Math.round(pct * 10) / 10,
    passed,
    status: String(data["status"] ?? "submitted"),
    startedAt,
    submittedAt,
    violations: Number(proctor["totalViolations"] ?? data["violationCount"] ?? (Array.isArray(data["violations"]) ? data["violations"].length : 0)),
    timeTakenSeconds,
    autoSubmitted,
    submissionReason,
    rawDoc: data,
  } satisfies ResultRow;
}

/**
 * Global admin read: all results via collection-group on "students" or direct queries.
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

  const rows = allDocs.map((d) => rowFromDoc(d));

  const dedupeMap = new Map<string, ResultRow>();
  for (const row of rows) {
    const key = `${row.userId}::${row.assessmentId}`;
    const existing = dedupeMap.get(key);
    if (!existing) {
      dedupeMap.set(key, row);
    } else {
      const existingTime = existing.submittedAt?.getTime() ?? 0;
      const rowTime = row.submittedAt?.getTime() ?? 0;
      if (rowTime > existingTime) dedupeMap.set(key, row);
    }
  }
  return Array.from(dedupeMap.values());
}

/**
 * Staff-scoped read from assessmentResults/{tenantId}/{assessmentId}/{userId}.
 */
export async function listResultsByTenant(
  tenantId: string,
  opts?: { assessmentId?: string; cohortId?: string; maxResults?: number },
): Promise<ResultRow[]> {
  if (!tenantId) return [];

  if (opts?.assessmentId) {
    const col = collection(getDb(), "assessmentResults", tenantId, opts.assessmentId);
    const constraints: Parameters<typeof query>[1][] = [];
    if (opts?.cohortId) constraints.push(where("cohortId", "==", opts.cohortId));
    constraints.push(orderBy("submittedAt", "desc"));
    constraints.push(limit(opts?.maxResults ?? 2000));
    const snap = await getDocs(query(col, ...constraints));
    return snap.docs.map((d) => rowFromDoc(d, opts.assessmentId, tenantId));
  }

  // Scan via collection-group
  const snap = await getDocs(
    query(collectionGroup(getDb(), "students"), limit(opts?.maxResults ?? 2000))
  );
  return snap.docs
    .filter((d) => {
      const parts = d.ref.path.split("/");
      return parts[0] === "assessmentResults" && parts[1] === tenantId;
    })
    .map((d) => rowFromDoc(d, undefined, tenantId));
}

/**
 * Returns distinct {id, title} pairs for assessments that have actual results.
 */
export async function listAssessmentIdsWithResults(
  tenantId?: string,
): Promise<{ id: string; title: string }[]> {
  const snap = await getDocs(
    query(collectionGroup(getDb(), "students"), limit(5000))
  );

  const seen = new Map<string, string>();
  for (const d of snap.docs) {
    if (!d.ref.path.startsWith("assessmentResults/")) continue;
    const parts = d.ref.path.split("/");
    const tid = parts[1] ?? "";
    const aid = parts[2] ?? "";
    // If tenant scoped, filter by tenantId in path
    if (tenantId && tenantId !== "all" && tid !== tenantId) continue;
    if (!aid || seen.has(aid)) continue;
    const data = d.data() as Record<string, unknown>;
    const title = String(
      data["assessmentName"] ?? data["testName"] ?? data["assessmentTitle"] ?? aid
    );
    seen.set(aid, title);
  }

  return Array.from(seen.entries()).map(([id, title]) => ({ id, title }));
}

/**
 * Fetch result rows for one specific assessment.
 * Path: assessmentResults/{tenantId}/{assessmentId}/{userId}
 */
export async function listResultsByAssessment(
  assessmentId: string,
  tenantId?: string,
  max = 2000,
): Promise<ResultRow[]> {
  let allRows: ResultRow[] = [];

  if (tenantId && tenantId !== "all") {
    const col = collection(getDb(), "assessmentResults", tenantId, assessmentId);
    const snap = await getDocs(query(col, limit(max)));
    allRows = snap.docs.map((d) => rowFromDoc(d, assessmentId, tenantId));
  } else {
    const snap = await getDocs(
      query(collectionGroup(getDb(), assessmentId), limit(max))
    );
    allRows = snap.docs
      .filter((d) => d.ref.path.startsWith(`assessmentResults/`))
      .map((d) => rowFromDoc(d, assessmentId));
  }

  const dedupeMap = new Map<string, ResultRow>();
  for (const row of allRows) {
    const existing = dedupeMap.get(row.userId);
    if (!existing) {
      dedupeMap.set(row.userId, row);
    } else {
      const existingTime = existing.submittedAt?.getTime() ?? 0;
      const rowTime = row.submittedAt?.getTime() ?? 0;
      if (rowTime > existingTime) dedupeMap.set(row.userId, row);
    }
  }
  return Array.from(dedupeMap.values());
}

/**
 * Full raw docs for Workbook export.
 * Path: assessmentResults/{tenantId}/{assessmentId}/{userId}
 */
export async function fetchAssessmentRawDocs(
  assessmentId: string,
  tenantId?: string,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();

  if (tenantId && tenantId !== "all") {
    const col = collection(getDb(), "assessmentResults", tenantId, assessmentId);
    const snap = await getDocs(col);
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const userId = String(data["userId"] ?? data["email"] ?? d.id);
      map.set(userId, data);
      const email = String(data["email"] ?? "");
      if (email && email !== userId) map.set(email, data);
    }
  } else {
    const snap = await getDocs(query(collectionGroup(getDb(), assessmentId), limit(5000)));
    for (const d of snap.docs) {
      if (!d.ref.path.startsWith(`assessmentResults/`)) continue;
      const data = d.data() as Record<string, unknown>;
      const userId = String(data["userId"] ?? data["email"] ?? d.id);
      map.set(userId, data);
      const email = String(data["email"] ?? "");
      if (email && email !== userId) map.set(email, data);
    }
  }
  return map;
}

