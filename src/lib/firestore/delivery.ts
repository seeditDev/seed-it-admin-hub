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

import { collection, doc, getDoc, getDocs, limit, query } from "firebase/firestore";
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

async function cdnUrlReachable(cdnUrl: string): Promise<boolean> {
  try {
    const res = await fetch(cdnUrl, { method: "HEAD", signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
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

  // 8. CDN reachability (soft warning — non-blocking)
  if (cdnUrl && testType !== "msa") {
    const reachable = await cdnUrlReachable(cdnUrl);
    if (!reachable) {
      warnings.push(
        `CDN URL may not be reachable: ${cdnUrl}. ` +
          "Verify that the file has been committed and pushed to seed-contents.",
      );
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
