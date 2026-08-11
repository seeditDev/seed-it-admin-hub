import { collectionGroup, collection, getDocs, limit, query, where, orderBy } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

export interface ResultRow {
  path: string;
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  cohortId: string;
  department: string;
  rollNumber: string;
  assessmentId: string;
  assessmentTitle: string;
  type: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
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

  return allDocs.map((d) => {
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
    // Assessment ID — from doc path (assessmentResults/{assessmentId}/students/{userId})
    const assessmentId = String(
      data['assessmentId'] ?? data['testID'] ?? d.ref.parent.parent?.id ?? ""
    );
    // Type
    const type = String(data['type'] ?? "");
    // Time taken
    const timeTakenSeconds = Number(data['timeTakenSeconds'] ?? data['timeTaken'] ?? 0);

    return {
      path: d.ref.path,
      userId: String(data['userId'] ?? data['email'] ?? d.id),
      email: String(data['email'] ?? ""),
      displayName: String(data['displayName'] ?? data['name'] ?? ""),
      tenantId: String(data['tenantId'] ?? data['college'] ?? ""),
      cohortId: String(data['cohortId'] ?? data['year'] ?? ""),
      department: String(data['department'] ?? ""),
      rollNumber: String(data['rollNumber'] ?? ""),
      assessmentId,
      assessmentTitle,
      type,
      totalScore,
      maxScore,
      percentage: Number(data['percentage'] ?? (maxScore > 0 ? (totalScore / maxScore) * 100 : 0)),
      status: String(data['status'] ?? "submitted"),
      submittedAt: toDate(data['submittedAt'] ?? data['submittedAtISO']),
      violations: Number(proctor['totalViolations'] ?? data['violationCount'] ?? 0),
      timeTakenSeconds,
    } satisfies ResultRow;
  });
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
    const assessmentId = String(data['assessmentId'] ?? d.ref.parent.parent?.id ?? "");
    const type = String(data['type'] ?? "");
    const timeTakenSeconds = Number(data['timeTakenSeconds'] ?? data['timeTaken'] ?? 0);

    return {
      path: d.ref.path,
      userId: String(data['userId'] ?? data['email'] ?? d.id),
      email: String(data['email'] ?? ""),
      displayName: String(data['displayName'] ?? data['name'] ?? ""),
      tenantId: String(data['tenantId'] ?? data['college'] ?? tenantId),
      cohortId: String(data['cohortId'] ?? data['year'] ?? ""),
      department: String(data['department'] ?? ""),
      rollNumber: String(data['rollNumber'] ?? ""),
      assessmentId,
      assessmentTitle,
      type,
      totalScore,
      maxScore,
      percentage: Number(data['percentage'] ?? (maxScore > 0 ? (totalScore / maxScore) * 100 : 0)),
      status: String(data['status'] ?? "submitted"),
      submittedAt: toDate(data['submittedAt'] ?? data['submittedAtISO']),
      violations: Number(proctor['totalViolations'] ?? data['violationCount'] ?? 0),
      timeTakenSeconds,
    } satisfies ResultRow;
  });
}
