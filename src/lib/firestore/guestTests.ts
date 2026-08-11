/**
 * guestTests.ts
 *
 * CRUD for  tenantAssessments/{tenantId}/guestTests/{testId}
 *
 * Written by the Admin Portal whenever a test has guestEnabled toggled.
 * Read by the SEB Guest Portal to list available assessments per college.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";

export interface GuestTestDoc {
  testId: string;
  tenantId: string;
  assessmentId?: string;
  assessmentName: string;
  type: string;
  cdnUrl: string;
  passkey: string;
  duration: number;
  sections?: unknown[];
  totalMarks: number;
  proctored: boolean;
  audioProctored: boolean;
  guestEnabled: true;
  expiresAt: string | null;
  enabledBy?: string;
}

const TENANT_ASSESSMENTS = "tenantAssessments";
const GUEST_TESTS = "guestTests";

function guestTestsCol(tenantId: string) {
  return collection(getDb(), TENANT_ASSESSMENTS, tenantId, GUEST_TESTS);
}

function guestTestDocRef(tenantId: string, testId: string) {
  return doc(getDb(), TENANT_ASSESSMENTS, tenantId, GUEST_TESTS, testId);
}

/**
 * Upsert a guest test entry for a tenant.
 * Called when admin enables guestEnabled on a test.
 */
export async function upsertGuestTest(
  tenantId: string,
  testId: string,
  data: Omit<GuestTestDoc, "testId" | "tenantId" | "guestEnabled">,
  enabledByUid?: string,
): Promise<void> {
  await setDoc(
    guestTestDocRef(tenantId, testId),
    {
      testId,
      tenantId,
      guestEnabled: true,
      enabledBy: enabledByUid ?? "",
      enabledAt: serverTimestamp(),
      ...data,
    },
    { merge: true },
  );
}

/**
 * Remove a guest test entry.
 * Called when admin disables guestEnabled on a test.
 */
export async function deleteGuestTest(
  tenantId: string,
  testId: string,
): Promise<void> {
  await deleteDoc(guestTestDocRef(tenantId, testId));
}

/**
 * List all guest-enabled tests for a tenant.
 * Used by the SEB Guest Portal.
 */
export async function listGuestTests(tenantId: string): Promise<GuestTestDoc[]> {
  const snap = await getDocs(guestTestsCol(tenantId));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      testId: d.id,
      tenantId,
      assessmentId: String(data["assessmentId"] ?? ""),
      assessmentName: String(data["assessmentName"] ?? d.id),
      type: String(data["type"] ?? "mcq"),
      cdnUrl: String(data["cdnUrl"] ?? ""),
      passkey: String(data["passkey"] ?? ""),
      duration: Number(data["duration"] ?? 30),
      sections: Array.isArray(data["sections"]) ? data["sections"] : [],
      totalMarks: Number(data["totalMarks"] ?? 0),
      proctored: Boolean(data["proctored"]),
      audioProctored: Boolean(data["audioProctored"]),
      guestEnabled: true,
      expiresAt: data["expiresAt"] ? String(data["expiresAt"]) : null,
      enabledBy: String(data["enabledBy"] ?? ""),
    } satisfies GuestTestDoc;
  });
}
