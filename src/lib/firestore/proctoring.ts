import { collectionGroup, getDocs, limit, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { ProctorEventRow } from "@/types/seedit";

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ts = value as { toDate?: () => Date };
  return typeof ts.toDate === "function" ? ts.toDate() : null;
}

function severityFor(type: string, raw: unknown): ProctorEventRow["severity"] {
  const given = String(raw ?? "").toLowerCase();
  if (given === "low" || given === "medium" || given === "high") return given;
  if (/multi|absent|no_face|impersonat|second_person/.test(type)) return "high";
  if (/tab|blur|fullscreen|copy|paste/.test(type)) return "medium";
  return "low";
}

/**
 * Reads violation events from `proctoringLogs/{attemptId}/events`
 * via a collection-group query so every tenant is covered in one read.
 */
export async function listProctorEvents(max = 3000): Promise<ProctorEventRow[]> {
  const snap = await getDocs(query(collectionGroup(getDb(), "events"), limit(max)));
  return snap.docs
    .filter((d) => d.ref.path.startsWith("proctoringLogs/"))
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const type = String(data['type'] ?? data['event'] ?? "unknown");
      return {
        id: d.id,
        attemptId: String(data['attemptId'] ?? d.ref.parent.parent?.id ?? ""),
        assessmentId: String(data['assessmentId'] ?? ""),
        assessmentTitle: String(data['assessmentTitle'] ?? ""),
        userId: String(data['userId'] ?? ""),
        email: String(data['email'] ?? ""),
        displayName: String(data['displayName'] ?? ""),
        tenantId: String(data['tenantId'] ?? ""),
        year: String(data['year'] ?? data['cohortId'] ?? ""),
        department: String(data['department'] ?? ""),
        type,
        severity: severityFor(type, data['severity']),
        detail: String(data['detail'] ?? data['message'] ?? ""),
        at: toDate(data['at'] ?? data['createdAt'] ?? data['timestamp']),
      } satisfies ProctorEventRow;
    })
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}
