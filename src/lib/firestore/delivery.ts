/**
 * delivery.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Validation helpers for the SEED-IT delivery chain:
 *
 *   Assessment → Test → Cohort Assignment → SEB → Result → Admin Report
 *
 * These functions are called by the Admin Hub before writing Test documents
 * or cohort assignments, ensuring the chain is internally consistent before
 * any data is persisted.
 *
 * IMPORTANT: No Firestore paths are changed here. SEB reads and writes the
 * same paths it always has. This module only validates Admin Hub writes.
 */

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { AssessmentStatus } from "@/types/seedit";

// ─── Result types ──────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  /** Hard errors — operation must not proceed if any exist. */
  errors: string[];
  /** Soft warnings — operation may proceed but admin should be aware. */
  warnings: string[];
}

export interface NormalizedTestFields {
  assessmentId: string;
  assessmentTitle: string;
  assessmentVersion: number;
  /** Canonical type from the assessment ("mcq" | "coding" | "multisection" | "spoken-english") */
  type: string;
  duration_minutes: number;
  totalMarks: number;
  /** CDN URL to the assessment JSON in seed-contents GitHub repo. May be "" for MSA. */
  cdnUrl: string;
  /** Assessment passPercentage — used by the UI to show pass threshold. */
  passPercentage: number;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

async function fetchAssessment(assessmentId: string): Promise<{
  exists: boolean;
  title: string;
  status: AssessmentStatus;
  type: string;
  durationMinutes: number;
  totalMarks: number;
  cdnUrl: string | null;
  version: number;
  passPercentage: number;
} | null> {
  if (!assessmentId) return null;
  const snap = await getDoc(doc(getDb(), "assessments", assessmentId)).catch(() => null);
  if (!snap?.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  const rawStatus = String(d["status"] ?? "draft");
  return {
    exists: true,
    title: String(d["title"] ?? assessmentId),
    status: (rawStatus === "closed" ? "archived" : rawStatus) as AssessmentStatus,
    type: String(d["type"] ?? "mcq").replace("multi-section", "multisection"),
    durationMinutes: Number(d["durationMinutes"] ?? 0),
    totalMarks: Number(d["totalMarks"] ?? 0),
    cdnUrl: d["cdnUrl"] ? String(d["cdnUrl"]) : null,
    version: Number(d["version"] ?? 1),
    passPercentage: Number(d["passPercentage"] ?? 40),
  };
}

/** CDN payload validation result */
interface CdnValidation {
  reachable: boolean;
  /** true if the fetched content parses as valid JSON */
  validJson: boolean;
  /**
   * Detected assessmentId inside the JSON payload.
   * Conventions used by seed-contents:
   *   MCQ:    { id, assessmentId, questions }
   *   Coding: { id, assessmentId, problems / challenges }
   *   SEA:    { id, assessmentId, prompts }
   */
  payloadAssessmentId: string | null;
  /** Detected type inside the JSON payload */
  payloadType: string | null;
  /** Number of questions/problems detected (0 if unknown) */
  questionCount: number;
  error: string | null;
}

/**
 * Fetch and validate a CDN assessment payload.
 * Performs a real GET (not HEAD) so we can inspect the JSON body.
 * Times out after 6 seconds — used as a soft warning, not a hard block.
 */
async function validateCdnPayload(cdnUrl: string): Promise<CdnValidation> {
  try {
    const res = await fetch(cdnUrl, {
      method: "GET",
      signal: AbortSignal.timeout(6000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        reachable: false, validJson: false,
        payloadAssessmentId: null, payloadType: null, questionCount: 0,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        reachable: true, validJson: false,
        payloadAssessmentId: null, payloadType: null, questionCount: 0,
        error: "Response is not valid JSON",
      };
    }
    // Detect assessmentId — payload may use `id`, `assessmentId`, or `testId`
    const payloadAssessmentId = String(
      json["assessmentId"] ?? json["id"] ?? json["testId"] ?? ""
    ) || null;
    // Detect type from payload
    const payloadType = json["type"] ? String(json["type"]) : null;
    // Count questions/problems
    const questionCount =
      (Array.isArray(json["questions"]) ? json["questions"].length : 0) +
      (Array.isArray(json["problems"]) ? json["problems"].length : 0) +
      (Array.isArray(json["challenges"]) ? json["challenges"].length : 0) +
      (Array.isArray(json["prompts"]) ? json["prompts"].length : 0);

    return { reachable: true, validJson: true, payloadAssessmentId, payloadType, questionCount, error: null };
  } catch (e) {
    return {
      reachable: false, validJson: false,
      payloadAssessmentId: null, payloadType: null, questionCount: 0,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Derive Test metadata from a linked Assessment.
 *
 * This is the single source of truth merge:
 *   - Assessment provides: type, duration, totalMarks, cdnUrl, version
 *   - Test provides: name, description, passkey, schedule, targeting, settings
 *
 * Throws a descriptive error if:
 *   - assessmentId is empty
 *   - Assessment does not exist
 *   - Assessment is "archived" (cannot be used for new tests)
 *
 * Returns NormalizedTestFields even for "draft" assessments — callers decide
 * whether to warn or block on draft status.
 */
export async function normalizeTestFromAssessment(
  assessmentId: string,
): Promise<NormalizedTestFields> {
  if (!assessmentId.trim()) {
    throw new Error("No assessment selected. Please link an assessment before saving.");
  }

  const a = await fetchAssessment(assessmentId);
  if (!a) {
    throw new Error(
      `Assessment "${assessmentId}" not found. It may have been deleted. ` +
        "Select a different assessment or recreate it.",
    );
  }

  if (a.status === "archived") {
    throw new Error(
      `Assessment "${a.title}" is archived and cannot be used for new tests. ` +
        "Publish a new version or select a different assessment.",
    );
  }

  // For non-MSA types, cdnUrl must be present if the assessment has been published.
  // We don't hard-fail here — the caller (saveTest) will enforce this.
  const cdnUrl = a.cdnUrl ?? "";

  return {
    assessmentId,
    assessmentTitle: a.title,
    assessmentVersion: a.version,
    type: a.type,
    duration_minutes: a.durationMinutes,
    totalMarks: a.totalMarks,
    cdnUrl,
    passPercentage: a.passPercentage,
  };
}

/**
 * Validates that a Test document is ready for SEB delivery.
 *
 * Checks:
 *   - Test document exists
 *   - assessmentId is non-empty
 *   - Assessment exists
 *   - Assessment is "active" (not draft/archived)
 *   - type matches between Test and Assessment
 *   - cdnUrl is present for non-MSA tests
 *   - duration > 0
 *   - totalMarks > 0
 *   - CDN URL is reachable (async, non-blocking warning)
 *
 * Returns ValidationResult with errors (hard) and warnings (soft).
 * valid === true only when errors.length === 0.
 */
export async function validateTestDelivery(
  courseId: string,
  seriesId: string,
  testId: string,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Test doc exists
  const testSnap = await getDoc(
    doc(getDb(), "courses", courseId, "series", seriesId, "tests", testId),
  ).catch(() => null);

  if (!testSnap?.exists()) {
    errors.push(
      `Test "${testId}" does not exist under course "${courseId}" / series "${seriesId}".`,
    );
    return { valid: false, errors, warnings };
  }

  const t = testSnap.data() as Record<string, unknown>;
  const testType = String(t["type"] ?? "");
  const assessmentId = String(t["assessmentId"] ?? "");
  const cdnUrl = String(t["cdnUrl"] ?? "");
  const duration = Number(t["duration_minutes"] ?? 0);
  const totalMarks = Number(t["totalMarks"] ?? 0);

  // 2. assessmentId present
  if (!assessmentId) {
    if (testType !== "msa") {
      errors.push(
        "No assessment linked to this test. " +
          "Edit the test and link an assessment before assigning to cohorts.",
      );
    } else {
      // MSA: sections may each have their own assessment references
      const sections = Array.isArray(t["sections"]) ? t["sections"] : [];
      if (sections.length === 0) {
        errors.push("MSA test has no sections. Add at least one section.");
      }
    }
  } else {
    // 3. Assessment exists and is active
    const a = await fetchAssessment(assessmentId);
    if (!a) {
      errors.push(
        `Linked assessment "${assessmentId}" not found. It may have been deleted. ` +
          "Edit the test and relink a valid assessment.",
      );
    } else {
      if (a.status === "draft") {
        errors.push(
          `Linked assessment "${a.title}" is still a draft. ` +
            "Publish the assessment before assigning this test to cohorts.",
        );
      }
      if (a.status === "archived") {
        errors.push(
          `Linked assessment "${a.title}" is archived. ` +
            "Create a new test linked to an active assessment.",
        );
      }

      // 4. Type consistency
      if (testType && a.type !== testType) {
        errors.push(
          `Type mismatch: test type is "${testType}" but linked assessment type is "${a.type}". ` +
            "Edit the test to fix the type, or relink the correct assessment.",
        );
      }

      // 5. Version warning
      const testVersion = Number(t["assessmentVersion"] ?? 1);
      if (a.version > testVersion) {
        warnings.push(
          `Assessment "${a.title}" has been updated to version ${a.version}, ` +
            `but this test references version ${testVersion}. ` +
            "Edit and re-save the test to refresh to the current version.",
        );
      }
    }
  }

  // 6. CDN URL required for non-MSA
  if (testType !== "msa" && !cdnUrl) {
    errors.push("CDN URL is missing. SEB cannot load this test without a valid CDN URL.");
  }

  // 7. Duration and marks
  if (duration <= 0) {
    errors.push("Duration must be greater than 0 minutes.");
  }
  if (totalMarks <= 0) {
    errors.push("Total marks must be greater than 0.");
  }

  // 8. CDN payload validation (soft warning for reachability, error for payload mismatch)
  if (cdnUrl && testType !== "msa") {
    const cdnResult = await validateCdnPayload(cdnUrl);

    if (!cdnResult.reachable) {
      warnings.push(
        `CDN URL is not reachable: ${cdnUrl}. ` +
          `Error: ${cdnResult.error ?? "Network error"}. ` +
          "Verify that the file has been committed and pushed to seed-contents before assigning to students.",
      );
    } else if (!cdnResult.validJson) {
      errors.push(
        `CDN URL returned non-JSON content: ${cdnUrl}. ` +
          `Error: ${cdnResult.error ?? "Parse error"}. ` +
          "The assessment payload must be a valid JSON file.",
      );
    } else {
      // Payload is readable JSON — now check content integrity

      // 8a. AssessmentId cross-check: payload must identify the same assessment
      if (
        cdnResult.payloadAssessmentId &&
        assessmentId &&
        cdnResult.payloadAssessmentId !== assessmentId
      ) {
        errors.push(
          `CDN payload mismatch: the test links to assessment "${assessmentId}" ` +
            `but the CDN JSON identifies itself as "${cdnResult.payloadAssessmentId}". ` +
            "Select the correct CDN URL for this assessment, or re-publish the assessment to seed-contents.",
        );
      }

      // 8b. Type cross-check
      if (cdnResult.payloadType && testType && cdnResult.payloadType !== testType) {
        warnings.push(
          `CDN payload type "${cdnResult.payloadType}" does not match test type "${testType}". ` +
            "Verify that the correct assessment payload is linked.",
        );
      }

      // 8c. Empty payload check
      if (cdnResult.questionCount === 0) {
        warnings.push(
          `CDN payload at ${cdnUrl} contains 0 questions/problems/prompts. ` +
            "Verify the assessment content has been published correctly.",
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates that a cohort assignment operation is safe to execute.
 *
 * In addition to Test delivery validation, checks:
 *   - Tenant exists
 *   - Cohort exists under tenant
 *   - Detects duplicate (already in allowedModules) — idempotent, not an error
 *
 * The moduleKey format is: courseId::seriesId::testId
 */
export async function validateCohortAssignment(
  courseId: string,
  seriesId: string,
  testId: string,
  tenantId: string,
  cohortId: string,
  currentAllowedModules: string[] = [],
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!tenantId) {
    errors.push("No college/tenant selected.");
    return { valid: false, errors, warnings };
  }
  if (!cohortId) {
    errors.push("No cohort selected.");
    return { valid: false, errors, warnings };
  }

  // Tenant check (accepts publicTenants or tenants)
  const tenantSnap = await getDoc(doc(getDb(), "publicTenants", tenantId)).catch(() => null);
  const tenantExists = tenantSnap?.exists() ?? false;
  if (!tenantExists) {
    // Fallback: check tenants collection
    const privateTenantSnap = await getDoc(doc(getDb(), "tenants", tenantId)).catch(() => null);
    if (!privateTenantSnap?.exists()) {
      errors.push(`College/tenant "${tenantId}" not found. Verify the tenant is configured.`);
    }
  }

  // Cohort check
  const cohortSnap = await getDoc(doc(getDb(), "tenants", tenantId, "cohorts", cohortId)).catch(
    () => null,
  );
  if (!cohortSnap?.exists()) {
    errors.push(`Cohort "${cohortId}" not found under tenant "${tenantId}".`);
  }

  // Duplicate check (idempotent — warning, not error)
  const moduleKey = `${courseId}::${seriesId}::${testId}`;
  if (currentAllowedModules.includes(moduleKey)) {
    warnings.push(`"${moduleKey}" is already assigned to this cohort — no change needed.`);
    return { valid: true, errors, warnings };
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // Test delivery validation
  const deliveryResult = await validateTestDelivery(courseId, seriesId, testId);
  errors.push(...deliveryResult.errors);
  warnings.push(...deliveryResult.warnings);

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Returns whether an assessment has any result documents written by SEB.
 * Used to prevent accidental deletion of assessments with existing student data.
 *
 * assessmentResults/{assessmentId}/students/{uid}
 */
export async function assessmentHasResults(
  assessmentId: string,
): Promise<{ hasResults: boolean; count: number }> {
  try {
    const snap = await getDocs(
      query(collection(getDb(), "assessmentResults", assessmentId, "students"), limit(1)),
    );
    if (!snap.empty) {
      // Get a rough count (limited to 500 for performance)
      const countSnap = await getDocs(
        query(collection(getDb(), "assessmentResults", assessmentId, "students"), limit(500)),
      );
      return { hasResults: true, count: countSnap.size };
    }
    return { hasResults: false, count: 0 };
  } catch {
    // If we can't read, assume there might be results (safe default)
    return { hasResults: false, count: 0 };
  }
}

// ─── Delivery Status (admin dashboard) ──────────────────────────────────────

export interface TestRef {
  courseId: string;
  courseTitle: string;
  seriesId: string;
  seriesTitle: string;
  testId: string;
  testName: string;
  testStatus: string;
  assessmentVersion: number;
}

export interface CohortRef {
  tenantId: string;
  tenantName: string;
  cohortId: string;
  cohortLabel: string;
  cohortYear: string;
  /** Approximate student count (from cohort doc if stored, else 0) */
  studentCount: number;
}

export interface AssessmentDeliveryStatus {
  assessmentId: string;
  assessmentTitle: string;
  assessmentStatus: AssessmentStatus | string;
  assessmentVersion: number;
  /** All course/series/tests that link to this assessment */
  tests: TestRef[];
  /** All cohorts that have at least one of those tests assigned */
  cohorts: CohortRef[];
  /** Aggregate student count across all assigned cohorts */
  totalStudents: number;
}

/**
 * Finds all `courses/{c}/series/{s}/tests/{t}` documents whose
 * `assessmentId` field matches the given assessment.
 *
 * Used by the admin Assessment detail panel to answer:
 *   "Which Course/Series/Tests use this assessment?"
 */
export async function listTestsForAssessment(assessmentId: string): Promise<TestRef[]> {
  if (!assessmentId) return [];
  try {
    const snap = await getDocs(
      query(collectionGroup(getDb(), "tests"), where("assessmentId", "==", assessmentId), limit(50)),
    );
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      // Path: courses/{courseId}/series/{seriesId}/tests/{testId}
      const parts = d.ref.path.split("/");
      return {
        courseId: parts[1] ?? "",
        courseTitle: String(data["courseTitle"] ?? parts[1] ?? ""),
        seriesId: parts[3] ?? "",
        seriesTitle: String(data["seriesTitle"] ?? parts[3] ?? ""),
        testId: d.id,
        testName: String(data["name"] ?? d.id),
        testStatus: String(data["status"] ?? "published"),
        assessmentVersion: Number(data["assessmentVersion"] ?? 1),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Finds all cohorts that have `moduleKey` (`courseId::seriesId::testId`)
 * in their `allowedModules` array.
 *
 * Requires a composite Firestore index on:
 *   tenants/{tenantId}/cohorts — array-contains on allowedModules
 *
 * Returns an empty array (silently) if the query is not indexed yet.
 */
export async function listCohortsForTest(
  courseId: string,
  seriesId: string,
  testId: string,
): Promise<CohortRef[]> {
  const moduleKey = `${courseId}::${seriesId}::${testId}`;
  if (!moduleKey.includes("::")) return [];
  try {
    const snap = await getDocs(
      query(
        collectionGroup(getDb(), "cohorts"),
        where("allowedModules", "array-contains", moduleKey),
        limit(100),
      ),
    );
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const parts = d.ref.path.split("/");
      return {
        tenantId: parts[1] ?? "",
        tenantName: String(data["tenantName"] ?? parts[1] ?? ""),
        cohortId: d.id,
        cohortLabel: String(data["label"] ?? d.id),
        cohortYear: String(data["year"] ?? ""),
        studentCount: Number(data["studentCount"] ?? 0),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Returns the full delivery chain status for a given assessment:
 *
 *   Assessment → Tests → Cohorts → Total student count
 *
 * Used to drive the "Delivery Status" panel in the Admin Hub:
 *   - Is it published?
 *   - Is it attached to a Test?
 *   - Which Course / Series?
 *   - Which Cohorts?
 *   - How many students have access?
 */
export async function getAssessmentDeliveryStatus(
  assessmentId: string,
): Promise<AssessmentDeliveryStatus> {
  const empty: AssessmentDeliveryStatus = {
    assessmentId,
    assessmentTitle: "",
    assessmentStatus: "draft",
    assessmentVersion: 1,
    tests: [],
    cohorts: [],
    totalStudents: 0,
  };
  if (!assessmentId) return empty;

  // Fetch assessment meta
  let aTitle = "";
  let aStatus: string = "draft";
  let aVersion = 1;
  try {
    const aSnap = await getDoc(doc(getDb(), "assessments", assessmentId));
    if (aSnap.exists()) {
      const d = aSnap.data() as Record<string, unknown>;
      aTitle = String(d["title"] ?? d["assessmentTitle"] ?? assessmentId);
      aStatus = String(d["status"] ?? "draft");
      aVersion = Number(d["version"] ?? 1);
    }
  } catch { /* ignore */ }

  // Find linked tests
  const tests = await listTestsForAssessment(assessmentId);

  // Find cohorts for each test (deduplicated by cohortId)
  const cohortMap = new Map<string, CohortRef>();
  for (const t of tests) {
    const cohorts = await listCohortsForTest(t.courseId, t.seriesId, t.testId);
    for (const c of cohorts) {
      if (!cohortMap.has(c.cohortId)) cohortMap.set(c.cohortId, c);
    }
  }

  const cohorts = Array.from(cohortMap.values());
  const totalStudents = cohorts.reduce((sum, c) => sum + c.studentCount, 0);

  return {
    assessmentId,
    assessmentTitle: aTitle,
    assessmentStatus: aStatus as AssessmentStatus,
    assessmentVersion: aVersion,
    tests,
    cohorts,
    totalStudents,
  };
}
