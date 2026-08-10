import { collectionGroup, getDocs, limit, query } from "firebase/firestore";
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
  totalScore: number;
  maxScore: number;
  percentage: number;
  status: string;
  submittedAt: Date | null;
  violations: number;
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
 * `assessmentResults/{assessmentId}/students`.
 */
export async function listResults(max = 2000): Promise<ResultRow[]> {
  const snap = await getDocs(query(collectionGroup(getDb(), "students"), limit(max)));
  return snap.docs
    .filter((d) => d.ref.path.startsWith("assessmentResults/"))
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const proctor = (data['proctorSummary'] ?? {}) as Record<string, unknown>;
      const maxScore = Number(data['maxScore'] ?? 0);
      const totalScore = Number(data['totalScore'] ?? 0);
      return {
        path: d.ref.path,
        userId: String(data['userId'] ?? d.id),
        email: String(data['email'] ?? ""),
        displayName: String(data['displayName'] ?? ""),
        tenantId: String(data['tenantId'] ?? ""),
        cohortId: String(data['cohortId'] ?? ""),
        department: String(data['department'] ?? ""),
        rollNumber: String(data['rollNumber'] ?? ""),
        assessmentId: String(data['assessmentId'] ?? d.ref.parent.parent?.id ?? ""),
        assessmentTitle: String(data['assessmentTitle'] ?? ""),
        totalScore,
        maxScore,
        percentage: Number(data['percentage'] ?? (maxScore ? (totalScore / maxScore) * 100 : 0)),
        status: String(data['status'] ?? "submitted"),
        submittedAt: toDate(data['submittedAt'] ?? data['submittedAtISO']),
        violations: Number(proctor['totalViolations'] ?? 0),
      } satisfies ResultRow;
    });
}
