import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type {
  Assessment,
  AssessmentStatus,
  AssessmentTargeting,
  AssessmentType,
  CodingProblem,
  McqQuestion,
  ProctorConfig,
  SeaPrompt,
  SeaRubric,
} from "@/types/seedit";
import { DEFAULT_PROCTOR_CONFIG, DEFAULT_TARGETING, normaliseYear, slugify } from "@/types/seedit";

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

function normaliseTargeting(raw: unknown, fallbackTenant: string): AssessmentTargeting {
  const t = (raw ?? {}) as Record<string, unknown>;
  const tenantIds = Array.isArray(t['tenantIds'])
    ? (t['tenantIds'] as string[])
    : fallbackTenant && fallbackTenant !== "ALL"
      ? [fallbackTenant]
      : [];
  const years = (Array.isArray(t['years']) ? (t['years'] as unknown[]) : [])
    .map((y) => normaliseYear(y))
    .filter((y): y is NonNullable<ReturnType<typeof normaliseYear>> => y !== null)
    .map((y) => String(y));

  return {
    tenantIds,
    years,
    departments: Array.isArray(t['departments']) ? (t['departments'] as string[]) : [],
  };
}

/** Full assessment document, including the authoring payload for each module type. */
export interface AssessmentDoc extends Assessment {
  description: string;
  instructions: string;
  targeting: AssessmentTargeting;
  negativeMarking: number;
  passPercentage: number;
  questions: McqQuestion[];
  problem: CodingProblem | null;
  prompts: SeaPrompt[];
  rubric: SeaRubric | null;
}

export const DEFAULT_CODING_PROBLEM: CodingProblem = {
  statement: "",
  inputFormat: "",
  outputFormat: "",
  constraints: "",
  memoryLimitMb: 256,
  timeLimitSeconds: 2,
  languages: ["python", "cpp", "java"],
  blockCopyPaste: true,
  fullScreenLock: true,
  testCases: [],
};

export const DEFAULT_SEA_RUBRIC: SeaRubric = {
  fluencyWeight: 30,
  pronunciationWeight: 30,
  grammarWeight: 25,
  keywordWeight: 15,
  passThreshold: 50,
};

function mapAssessment(id: string, data: Record<string, unknown>): AssessmentDoc {
  const rawStatus = String(data['status'] ?? "draft");
  const status: AssessmentStatus = rawStatus === "closed" ? "archived" : (rawStatus as AssessmentStatus);
  const tenantId = String(data['tenantId'] ?? "ALL");
  return {
    id,
    title: String(data['title'] ?? id),
    type: String(data['type'] ?? "mcq").replace("multi-section", "multisection") as AssessmentType,
    tenantId,
    cohortIds: Array.isArray(data['cohortIds']) ? (data['cohortIds'] as string[]) : undefined,
    durationMinutes: Number(data['durationMinutes'] ?? 0),
    totalMarks: Number(data['totalMarks'] ?? 0),
    status,
    scheduledStart: toIso(data['scheduledStart']),
    scheduledEnd: toIso(data['scheduledEnd']),
    createdBy: data['createdBy'] ? String(data['createdBy']) : undefined,
    createdAt: (data['createdAt'] ?? null) as Assessment["createdAt"],
    proctorConfig: normaliseProctor(data['proctorConfig']),
    description: String(data['description'] ?? ""),
    instructions: String(data['instructions'] ?? ""),
    targeting: normaliseTargeting(data['targeting'], tenantId),
    negativeMarking: Number(data['negativeMarking'] ?? 0),
    passPercentage: Number(data['passPercentage'] ?? 40),
    questions: Array.isArray(data['questions']) ? (data['questions'] as McqQuestion[]) : [],
    problem: (data['problem'] as CodingProblem | undefined) ?? null,
    prompts: Array.isArray(data['prompts']) ? (data['prompts'] as SeaPrompt[]) : [],
    rubric: (data['rubric'] as SeaRubric | undefined) ?? null,
  };
}

export async function listAssessments(): Promise<AssessmentDoc[]> {
  const snap = await getDocs(collection(getDb(), ASSESSMENTS));
  return snap.docs
    .map((d) => mapAssessment(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getAssessment(id: string): Promise<AssessmentDoc | null> {
  const snap = await getDoc(doc(getDb(), ASSESSMENTS, id));
  return snap.exists() ? mapAssessment(snap.id, snap.data() as Record<string, unknown>) : null;
}

export type AssessmentInput = Partial<Omit<AssessmentDoc, "createdAt">> & {
  title: string;
  type: AssessmentType;
};

/** Creates or updates an assessment. Returns the document id. */
export async function saveAssessment(input: AssessmentInput, createdBy?: string): Promise<string> {
  const id = input.id?.trim() || `${input.type}-${slugify(input.title)}-${Date.now().toString(36)}`;
  const payload: Record<string, unknown> = {
    id,
    title: input.title.trim(),
    type: input.type,
    description: input.description ?? "",
    instructions: input.instructions ?? "",
    tenantId: input.targeting?.tenantIds?.length === 1 ? input.targeting.tenantIds[0] : "ALL",
    targeting: input.targeting ?? DEFAULT_TARGETING,
    durationMinutes: Number(input.durationMinutes ?? 0),
    totalMarks: Number(input.totalMarks ?? 0),
    negativeMarking: Number(input.negativeMarking ?? 0),
    passPercentage: Number(input.passPercentage ?? 40),
    status: input.status ?? "draft",
    scheduledStart: input.scheduledStart ?? null,
    scheduledEnd: input.scheduledEnd ?? null,
    proctorConfig: input.proctorConfig ?? DEFAULT_PROCTOR_CONFIG,
    updatedAt: serverTimestamp(),
  };
  if (input.questions) payload['questions'] = input.questions;
  if (input.problem) payload['problem'] = input.problem;
  if (input.prompts) payload['prompts'] = input.prompts;
  if (input.rubric) payload['rubric'] = input.rubric;
  if (!input.id) {
    payload['createdAt'] = serverTimestamp();
    if (createdBy) payload['createdBy'] = createdBy;
  }
  await setDoc(doc(getDb(), ASSESSMENTS, id), payload, { merge: true });
  return id;
}

export async function setAssessmentStatus(id: string, status: AssessmentStatus): Promise<void> {
  await setDoc(doc(getDb(), ASSESSMENTS, id), { status, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deleteAssessment(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), ASSESSMENTS, id));
}

/** Duplicates an assessment into a fresh draft. */
export async function duplicateAssessment(id: string): Promise<string> {
  const existing = await getAssessment(id);
  if (!existing) throw new Error("Assessment not found");
  const { id: _drop, createdAt: _c, ...rest } = existing;
  return saveAssessment({ ...rest, title: `${existing.title} (copy)`, status: "draft" });
}
