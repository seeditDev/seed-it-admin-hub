/**
 * tenantCourses.ts
 *
 * Denormalized per-college test registry.
 *
 *   tenantCourses/{tenantId}/tests/{testId}
 *
 * Written whenever a test's targeting changes (updateTestTargeting) or
 * whenever a test is saved (saveTest) — for any tenantId listed in
 * targeting.tenantIds[].
 *
 * READ by:
 *   - Guest Portal (SEB)  → filter guestEnabled == true
 *   - SEB Student Dashboard (future) → all tests for this college
 *
 * Firestore rules:
 *   - Public read (guest portal has no auth token)
 *   - Write: admin or staff scoped to that tenantId
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { ScheduleConfig, MSASection } from "@/lib/firestore/courses";

export interface TenantCourseTest {
  testId: string;
  tenantId: string;
  courseId: string;
  seriesId: string;
  /** Human-readable test name */
  name: string;
  type: string;
  cdnUrl: string;
  sections: MSASection[];
  duration: number;
  totalMarks: number;
  passkey: string;
  proctored: boolean;
  audioProctored: boolean;
  guestEnabled: boolean;
  schedule: Partial<ScheduleConfig>;
  assignedAt?: unknown;
}

const TENANT_COURSES = "tenantCourses";

function tenantTestsCol(tenantId: string) {
  return collection(getDb(), TENANT_COURSES, tenantId, "tests");
}

function tenantTestDoc(tenantId: string, testId: string) {
  return doc(getDb(), TENANT_COURSES, tenantId, "tests", testId);
}

/**
 * Upsert a test into tenantCourses/{tenantId}/tests/{testId}.
 * Called for every tenant in targeting.tenantIds[].
 */
export async function upsertTenantCourseTest(
  tenantId: string,
  testId: string,
  data: Omit<TenantCourseTest, "testId" | "tenantId" | "assignedAt">,
): Promise<void> {
  await setDoc(
    tenantTestDoc(tenantId, testId),
    {
      testId,
      tenantId,
      ...data,
      assignedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Remove a test from tenantCourses/{tenantId}/tests/{testId}.
 * Called when a tenant is removed from targeting, or the test is deleted.
 */
export async function deleteTenantCourseTest(
  tenantId: string,
  testId: string,
): Promise<void> {
  await deleteDoc(tenantTestDoc(tenantId, testId));
}

/**
 * List tests for a tenant.
 * @param tenantId  - College code (e.g. "TN000026")
 * @param guestOnly - If true, only return tests with guestEnabled == true
 */
export async function listTenantCourseTests(
  tenantId: string,
  guestOnly = false,
): Promise<TenantCourseTest[]> {
  const col = tenantTestsCol(tenantId);
  const snap = guestOnly
    ? await getDocs(query(col, where("guestEnabled", "==", true)))
    : await getDocs(col);

  return snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      testId: d.id,
      tenantId,
      courseId: String(raw["courseId"] ?? ""),
      seriesId: String(raw["seriesId"] ?? ""),
      name: String(raw["name"] ?? d.id),
      type: String(raw["type"] ?? "mcq"),
      cdnUrl: String(raw["cdnUrl"] ?? ""),
      sections: Array.isArray(raw["sections"]) ? (raw["sections"] as MSASection[]) : [],
      duration: Number(raw["duration"] ?? 30),
      totalMarks: Number(raw["totalMarks"] ?? 0),
      passkey: String(raw["passkey"] ?? ""),
      proctored: Boolean(raw["proctored"]),
      audioProctored: Boolean(raw["audioProctored"]),
      guestEnabled: Boolean(raw["guestEnabled"]),
      schedule: (raw["schedule"] ?? {}) as Partial<ScheduleConfig>,
      assignedAt: raw["assignedAt"],
    } satisfies TenantCourseTest;
  });
}

/**
 * Sync tenantCourses for a test across multiple tenants.
 *
 * - Upserts docs for every tenantId in `activeTenantIds`.
 * - Deletes docs for tenantIds that were previously assigned but are no longer.
 *
 * @param previousTenantIds  - The old targeting.tenantIds (before the change)
 * @param activeTenantIds    - The new targeting.tenantIds (after the change)
 * @param testId             - Firestore test ID
 * @param testData           - Full test snapshot to write (without testId/tenantId)
 */
export async function syncTenantCourseTests(
  previousTenantIds: string[],
  activeTenantIds: string[],
  testId: string,
  testData: Omit<TenantCourseTest, "testId" | "tenantId" | "assignedAt">,
): Promise<void> {
  const toAdd = activeTenantIds.filter((id) => id.trim());
  const toRemove = previousTenantIds.filter((id) => !activeTenantIds.includes(id));

  await Promise.all([
    ...toAdd.map((tenantId) => upsertTenantCourseTest(tenantId, testId, testData)),
    ...toRemove.map((tenantId) => deleteTenantCourseTest(tenantId, testId)),
  ]);
}
