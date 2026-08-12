import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type {
  Assessment,
  AssessmentStatus,
  AssessmentTargeting,
  AssessmentType,
  CodingChallenge,
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
  /** Multi-challenge coding assessments (one problem per challenge). */
  challenges: CodingChallenge[];
  prompts: SeaPrompt[];
  rubric: SeaRubric | null;
  /**
   * Assessment schema version. Starts at 1 on first publish (status → active).
   * Incremented every time a published (active) assessment is saved.
   * Tests mirror this as `assessmentVersion` so Admin can detect stale links.
   */
  version: number;

  /**
   * Public CDN URL to the full assessment JSON in seed-contents GitHub repo.
   * Set when the assessment is published; null for draft-only assessments.
   */
  cdnUrl: string | null;

  /**
   * Assessment access code — a short alphanumeric code (e.g. "SEED2024A") that
   * allows ANYONE to access and take this specific assessment without logging in.
   *
   * Guest flow:
   *   1. User goes to /guest (no login)
   *   2. Enters assessmentCode
   *   3. If guestEnabled = true, they fill in name / college / year / rollno
   *   4. They can start the assessment immediately
   *
   * Null = no guest access (login required).
   */
  assessmentCode: string | null;

  /**
   * Whether this assessment allows unauthenticated (guest) access via assessmentCode.
   * When true, the assessmentCode acts as a passkey that anyone can use.
   */
  guestEnabled: boolean;
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
    challenges: Array.isArray(data['challenges']) ? (data['challenges'] as CodingChallenge[]) : [],
    prompts: Array.isArray(data['prompts']) ? (data['prompts'] as SeaPrompt[]) : [],
    rubric: (data['rubric'] as SeaRubric | undefined) ?? null,
    cdnUrl: data['cdnUrl'] ? String(data['cdnUrl']) : null,
    assessmentCode: data['assessmentCode'] ? String(data['assessmentCode']) : null,
    guestEnabled: Boolean(data['guestEnabled'] ?? false),
    version: Number(data['version'] ?? 1),
  };
}

/**
 * Generate a unique 8-character alphanumeric assessment code.
 * e.g. "SEED2024", "MCQ7AB3X"
 * Admin can regenerate this from the UI.
 */
export function generateAssessmentCode(prefix = ""): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // unambiguous chars (no 0/O/I/1)
  const rand = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${prefix ? prefix.toUpperCase().slice(0, 4) : "SEED"}${rand}`;
}

/**
 * Fetch a single assessment by its assessmentCode (for guest access).
 * Returns null if not found or guest access is disabled.
 */
export async function getAssessmentByCode(code: string): Promise<AssessmentDoc | null> {
  const { query: fsQuery, where, getDocs: getDs } = await import("firebase/firestore");
  const snap = await getDs(
    fsQuery(collection(getDb(), ASSESSMENTS),
      where("assessmentCode", "==", code.toUpperCase().trim()),
      where("guestEnabled", "==", true),
    )
  );
  if (snap.empty) return null;
  return mapAssessment(snap.docs[0]!.id, snap.docs[0]!.data() as Record<string, unknown>);
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

export type AssessmentInput = {
  [K in keyof Omit<AssessmentDoc, "createdAt">]?: Omit<AssessmentDoc, "createdAt">[K] | undefined;
} & {
  title: string;
  type: AssessmentType;
};

/** Creates or updates an assessment. Returns the document id. */
export async function saveAssessment(input: AssessmentInput, createdBy?: string): Promise<string> {
  const id = input.id?.trim() || `${input.type}-${slugify(input.title)}-${Date.now().toString(36)}`;

  // Compute next version:
  //   - New doc: version = 1
  //   - Existing active doc: version = currentVersion + 1 (bump on every save)
  //   - Existing draft doc: version stays at current (or 1 if not set)
  let nextVersion = 1;
  if (input.id?.trim()) {
    const existing = await getDoc(doc(getDb(), ASSESSMENTS, id)).catch(() => null);
    if (existing?.exists()) {
      const d = existing.data() as Record<string, unknown>;
      const currentVersion = Number(d['version'] ?? 1);
      const currentStatus = String(d['status'] ?? 'draft');
      // Increment version whenever an active (published) assessment is saved
      nextVersion = currentStatus === 'active' ? currentVersion + 1 : currentVersion;
    }
  }

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
    version: nextVersion,
    updatedAt: serverTimestamp(),
  };
  if (input.questions) payload['questions'] = input.questions;
  if (input.problem) payload['problem'] = input.problem;
  if (input.challenges && input.challenges.length > 0) payload['challenges'] = input.challenges;
  if (input.prompts) payload['prompts'] = input.prompts;
  if (input.rubric) payload['rubric'] = input.rubric;
  // CDN URL — set when the assessment JSON has been published to seed-contents
  if (input.cdnUrl !== undefined) payload['cdnUrl'] = input.cdnUrl ?? null;
  // Guest access fields
  if (input.assessmentCode !== undefined) payload['assessmentCode'] = input.assessmentCode ?? null;
  if (input.guestEnabled !== undefined) payload['guestEnabled'] = Boolean(input.guestEnabled);
  if (!input.id) {
    payload['createdAt'] = serverTimestamp();
    if (createdBy) payload['createdBy'] = createdBy;
  }
  await setDoc(doc(getDb(), ASSESSMENTS, id), payload, { merge: true });
  return id;
}

export async function setAssessmentStatus(id: string, status: AssessmentStatus): Promise<void> {
  // When transitioning to active (publish), bump the version.
  const existing = await getDoc(doc(getDb(), ASSESSMENTS, id)).catch(() => null);
  const currentVersion = Number((existing?.data() as Record<string, unknown> | undefined)?.["version"] ?? 1);
  const currentStatus = String((existing?.data() as Record<string, unknown> | undefined)?.["status"] ?? "draft");
  // Bump version on every publish (draft → active, or re-activate)
  const nextVersion = status === "active" && currentStatus !== "active"
    ? currentVersion + 1
    : currentVersion;
  await setDoc(
    doc(getDb(), ASSESSMENTS, id),
    { status, version: nextVersion, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Soft-archive an assessment — sets status to "archived".
 * Archived assessments cannot be linked to new Tests but existing Test
 * references (with their assessmentVersion) remain valid for historical results.
 */
export async function archiveAssessment(id: string): Promise<void> {
  await setDoc(
    doc(getDb(), ASSESSMENTS, id),
    { status: "archived", updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Check whether an assessment has existing student result documents.
 * Use this before deleting to prevent accidental data loss.
 *
 * assessmentResults/{assessmentId}/students — if any docs exist, it's unsafe to delete.
 */
export async function checkAssessmentDeletable(
  id: string,
): Promise<{ safe: boolean; resultCount: number }> {
  try {
    const snap = await getDocs(
      query(collection(getDb(), "assessmentResults", id, "students"), limit(500)),
    );
    if (!snap.empty) {
      return { safe: false, resultCount: snap.size };
    }
    return { safe: true, resultCount: 0 };
  } catch {
    // If we can't read, conservatively allow (admin may not have results yet)
    return { safe: true, resultCount: 0 };
  }
}

/**
 * Deletes an assessment. Throws if the assessment has existing result documents
 * to prevent accidental loss of student data.
 *
 * To force-delete an assessment with results (e.g. for test data cleanup),
 * the caller must pass `{ force: true }`. The Admin UI should never pass force.
 */
export async function deleteAssessment(
  id: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!opts.force) {
    const { safe, resultCount } = await checkAssessmentDeletable(id);
    if (!safe) {
      throw new Error(
        `Cannot delete assessment "${id}" — it has ${resultCount} student result(s). ` +
          "Archive the assessment instead to preserve historical data.",
      );
    }
  }
  await deleteDoc(doc(getDb(), ASSESSMENTS, id));
  // Also remove the contentUrls registry entry so the SEB slug dropdown stays clean
  try {
    await deleteDoc(doc(getDb(), "contentUrls", id));
  } catch (_) {
    // Non-fatal: contentUrls entry may not exist for every assessment
  }
}

/** Duplicates an assessment into a fresh draft. */
export async function duplicateAssessment(id: string): Promise<string> {
  const existing = await getAssessment(id);
  if (!existing) throw new Error("Assessment not found");
  const { id: _drop, createdAt: _c, ...rest } = existing;
  return saveAssessment({ ...rest, title: `${existing.title} (copy)`, status: "draft" });
}
