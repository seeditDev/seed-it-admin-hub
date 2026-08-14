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

function rowFromDoc(
  d: { id: string; ref: { path: string }; data: () => Record<string, unknown> },
  overrideAssessmentId?: string,
  overrideTenantId?: string,
): ResultRow {
  const data = d.data() as Record<string, unknown>;
  const proctor = (data["proctorSummary"] ?? {}) as Record<string, unknown>;

  const totalScore = Number(data["score"] ?? data["totalScore"] ?? 0);
  const maxScore = Number(data["totalMarks"] ?? data["maxScore"] ?? 0);
  const assessmentTitle = String(
    data["assessmentName"] ?? data["testName"] ?? data["assessmentTitle"] ?? data["title"] ?? ""
  );

  // New path: assessmentResults/{assessmentId}/{tenantId}/students/{userId}
  const pathParts = d.ref.path.split("/");
  const assessmentIdFromPath = pathParts[0] === "assessmentResults" ? (pathParts[1] ?? "") : "";
  const tenantIdFromPath = pathParts[0] === "assessmentResults" ? (pathParts[2] ?? "") : "";

  const assessmentId = overrideAssessmentId ?? String(data["assessmentId"] ?? data["testID"] ?? assessmentIdFromPath);
  const tenantId = overrideTenantId ?? String(data["tenantId"] ?? data["college"] ?? tenantIdFromPath ?? "");

  const rawType = String(data["type"] ?? "");
  const assessmentType = rawType.replace("multi-section", "multisection");
  const assessmentVersion = Number(data["assessmentVersion"] ?? 1);
  const timeTakenSeconds = Number(data["timeTakenSeconds"] ?? data["timeTaken"] ?? 0);
  const pct = Number(data["percentage"] ?? (maxScore > 0 ? (totalScore / maxScore) * 100 : 0));
  const passThreshold = Number(data["passPercentage"] ?? 40);
  const passed = pct >= passThreshold;
  const cohortId = String(data["cohortId"] ?? data["year"] ?? "");
  const year = String(data["year"] ?? cohortId ?? "");

  return {
    path: d.ref.path,
    userId: String(data["userId"] ?? data["email"] ?? d.id),
    email: String(data["email"] ?? ""),
    displayName: String(data["displayName"] ?? data["name"] ?? ""),
    tenantId,
    cohortId,
    year,
    department: String(data["department"] ?? ""),
    rollNumber: String(data["rollNumber"] ?? ""),
    assessmentId,
    assessmentTitle,
    assessmentType,
    type: assessmentType,
    assessmentVersion,
    totalScore,
    maxScore,
    percentage: pct,
    passed,
    status: String(data["status"] ?? "submitted"),
    submittedAt: toDate(data["submittedAt"] ?? data["submittedAtISO"]),
    violations: Number(proctor["totalViolations"] ?? data["violationCount"] ?? 0),
    timeTakenSeconds,
  } satisfies ResultRow;
}

/**
 * Global admin read: all results via collection-group on "students".
 * New path: assessmentResults/{assessmentId}/{tenantId}/students/{userId}
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
 * Staff-scoped read from tenantResults/{tenantId}/{assessmentId}/{userId}.
 * For a specific assessment: direct collection read.
 * Without assessmentId: collection-group scan (less efficient).
 */
export async function listResultsByTenant(
  tenantId: string,
  opts?: { assessmentId?: string; cohortId?: string; maxResults?: number },
): Promise<ResultRow[]> {
  if (!tenantId) return [];

  if (opts?.assessmentId) {
    const col = collection(getDb(), "tenantResults", tenantId, opts.assessmentId);
    const constraints: Parameters<typeof query>[1][] = [];
    if (opts?.cohortId) constraints.push(where("cohortId", "==", opts.cohortId));
    constraints.push(orderBy("submittedAt", "desc"));
    constraints.push(limit(opts?.maxResults ?? 2000));
    const snap = await getDocs(query(col, ...constraints));
    return snap.docs.map((d) => rowFromDoc(d, opts.assessmentId, tenantId));
  }

  // No assessmentId: scan via assessmentResults collection-group filtered by tenantId path segment
  const snap = await getDocs(
    query(collectionGroup(getDb(), "students"), limit(opts?.maxResults ?? 2000))
  );
  return snap.docs
    .filter((d) => {
      const parts = d.ref.path.split("/");
      return parts[0] === "assessmentResults" && parts[2] === tenantId;
    })
    .map((d) => rowFromDoc(d, undefined, tenantId));
}

/**
 * Returns distinct {id, title} pairs for assessments that have actual results.
 * Powers the assessment dropdown in the Reports dashboard.
 *
 * tenantId scoped: reads from assessmentResults/**  filtered by path tenantId segment.
 * No tenantId (admin): reads all and aggregates.
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
    const aid = parts[1] ?? "";
    const tid = parts[2] ?? "";
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
 * New path: assessmentResults/{assessmentId}/{tenantId}/students/{userId}
 */
export async function listResultsByAssessment(
  assessmentId: string,
  tenantId?: string,
  max = 2000,
): Promise<ResultRow[]> {
  let allRows: ResultRow[] = [];

  if (tenantId && tenantId !== "all") {
    const col = collection(getDb(), "assessmentResults", assessmentId, tenantId, "students");
    const snap = await getDocs(query(col, limit(max)));
    allRows = snap.docs.map((d) => rowFromDoc(d, assessmentId, tenantId));
  } else {
    const snap = await getDocs(
      query(collectionGroup(getDb(), "students"), limit(max))
    );
    allRows = snap.docs
      .filter((d) => d.ref.path.startsWith(`assessmentResults/${assessmentId}/`))
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
 * New path: assessmentResults/{assessmentId}/{tenantId}/students/{userId}
 */
export async function fetchAssessmentRawDocs(
  assessmentId: string,
  tenantId?: string,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();

  if (tenantId && tenantId !== "all") {
    const col = collection(getDb(), "assessmentResults", assessmentId, tenantId, "students");
    const snap = await getDocs(col);
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const userId = String(data["userId"] ?? data["email"] ?? d.id);
      map.set(userId, data);
      const email = String(data["email"] ?? "");
      if (email && email !== userId) map.set(email, data);
    }
  } else {
    const snap = await getDocs(query(collectionGroup(getDb(), "students"), limit(5000)));
    for (const d of snap.docs) {
      if (!d.ref.path.startsWith(`assessmentResults/${assessmentId}/`)) continue;
      const data = d.data() as Record<string, unknown>;
      const userId = String(data["userId"] ?? data["email"] ?? d.id);
      map.set(userId, data);
      const email = String(data["email"] ?? "");
      if (email && email !== userId) map.set(email, data);
    }
  }
  return map;
}
