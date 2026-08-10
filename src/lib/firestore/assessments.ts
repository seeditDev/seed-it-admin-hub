import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { Assessment, AssessmentStatus, AssessmentType, ProctorConfig } from "@/types/seedit";
import { DEFAULT_PROCTOR_CONFIG } from "@/types/seedit";

const ASSESSMENTS = "assessments";

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

function normaliseProctor(raw: unknown): ProctorConfig {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: p['enabled'] !== false,
    cameraRequired: p['cameraRequired'] !== false,
    audioRequired: p['audioRequired'] === true || String(p['mode'] ?? "").includes("audio"),
    tabSwitchLimit: Number(p['tabSwitchLimit'] ?? DEFAULT_PROCTOR_CONFIG.tabSwitchLimit),
    maxViolations: Number(p['maxViolations'] ?? p['maxFaceViolations'] ?? DEFAULT_PROCTOR_CONFIG.maxViolations),
    autoSubmitOnViolation: p['autoSubmitOnViolation'] !== false,
  };
}

export async function listAssessments(): Promise<Assessment[]> {
  const snap = await getDocs(collection(getDb(), ASSESSMENTS));
  return snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const rawStatus = String(data['status'] ?? "draft");
      const status: AssessmentStatus =
        rawStatus === "closed" ? "archived" : (rawStatus as AssessmentStatus);
      return {
        id: d.id,
        title: String(data['title'] ?? d.id),
        type: String(data['type'] ?? "mcq").replace("multi-section", "multisection") as AssessmentType,
        tenantId: String(data['tenantId'] ?? "ALL"),
        cohortIds: Array.isArray(data['cohortIds']) ? (data['cohortIds'] as string[]) : undefined,
        durationMinutes: Number(data['durationMinutes'] ?? 0),
        totalMarks: Number(data['totalMarks'] ?? 0),
        status,
        scheduledStart: toIso(data['scheduledStart']),
        scheduledEnd: toIso(data['scheduledEnd']),
        createdBy: data['createdBy'] ? String(data['createdBy']) : undefined,
        createdAt: (data['createdAt'] ?? null) as Assessment["createdAt"],
        proctorConfig: normaliseProctor(data['proctorConfig']),
      } satisfies Assessment;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
