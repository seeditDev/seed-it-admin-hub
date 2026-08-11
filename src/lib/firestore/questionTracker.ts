/**
 * Question Usage Tracker
 * ──────────────────────
 * Stores a tracker document at:
 *   courses/{courseId}/series/{seriesId}/_meta/question_tracker
 *
 * This lets admins see at a glance which MCQ bank question IDs and coding
 * challenge IDs have already been used within a course series, so they don't
 * accidentally repeat questions across tests.
 *
 * Schema of the question_tracker document:
 * {
 *   courseId: string,
 *   seriesId: string,
 *   // MCQ bank question IDs, e.g. ["bank-1234", "bank-5678"]
 *   mcqIds: string[],
 *   // Firestore assessmentId → array of bank question IDs used in that test
 *   mcqByTest: Record<testId, string[]>,
 *   // Coding challenge IDs (Firestore codingChallenges/{id})
 *   codingIds: string[],
 *   // Firestore assessmentId → array of coding challenge IDs used in that test
 *   codingByTest: Record<testId, string[]>,
 *   updatedAt: Timestamp,
 * }
 */

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";

/* ─────────────────────── Types ─────────────────────── */

export interface QuestionTracker {
  courseId: string;
  seriesId: string;
  /** All MCQ bank IDs used in this series (union of all tests) */
  mcqIds: string[];
  /** Per-test breakdown: testId → MCQ bank question IDs */
  mcqByTest: Record<string, string[]>;
  /** All coding challenge IDs used in this series */
  codingIds: string[];
  /** Per-test breakdown: testId → coding challenge IDs */
  codingByTest: Record<string, string[]>;
  updatedAt?: unknown;
}

/* ─────────────────────── Path helpers ─────────────────────── */

// NOTE: Firestore reserves document IDs that start AND end with "__" (e.g. __tracker__).
// Using such IDs throws "Resource id is invalid because it is reserved".
// Safe alternative: 'question_tracker' (no double-underscore wrapping).
const TRACKER_DOC = "question_tracker";

function trackerRef(courseId: string, seriesId: string) {
  // Full path: courses/{courseId}/series/{seriesId}/_meta/question_tracker  (6 segments = valid doc)
  return doc(getDb(), "courses", courseId, "series", seriesId, "_meta", TRACKER_DOC);
}

/* ─────────────────────── Read ─────────────────────── */

/**
 * Fetch the question tracker for a series.
 * Returns an empty tracker if none exists yet.
 */
export async function getQuestionTracker(
  courseId: string,
  seriesId: string,
): Promise<QuestionTracker> {
  const snap = await getDoc(trackerRef(courseId, seriesId));
  if (!snap.exists()) {
    return {
      courseId,
      seriesId,
      mcqIds: [],
      mcqByTest: {},
      codingIds: [],
      codingByTest: {},
    };
  }
  const d = snap.data() as Record<string, unknown>;
  return {
    courseId,
    seriesId,
    mcqIds: Array.isArray(d["mcqIds"]) ? (d["mcqIds"] as string[]) : [],
    mcqByTest: (d["mcqByTest"] as Record<string, string[]>) ?? {},
    codingIds: Array.isArray(d["codingIds"]) ? (d["codingIds"] as string[]) : [],
    codingByTest: (d["codingByTest"] as Record<string, string[]>) ?? {},
    updatedAt: d["updatedAt"],
  };
}

/* ─────────────────────── Write ─────────────────────── */

/**
 * Record which question IDs a specific test uses.
 * Merges into the existing tracker — call this whenever a test is saved.
 *
 * @param courseId   Firestore course document ID
 * @param seriesId   Firestore series document ID
 * @param testId     The test document ID within the series
 * @param mcqIds     MCQ bank question IDs used (e.g. "bank-1234")
 * @param codingIds  Coding challenge Firestore IDs used
 */
export async function recordTestQuestionIds(
  courseId: string,
  seriesId: string,
  testId: string,
  mcqIds: string[],
  codingIds: string[],
): Promise<void> {
  const existing = await getQuestionTracker(courseId, seriesId);

  // Merge this test's IDs into the per-test maps
  const nextMcqByTest: Record<string, string[]> = {
    ...existing.mcqByTest,
    ...(mcqIds.length > 0 ? { [testId]: mcqIds } : {}),
  };
  const nextCodingByTest: Record<string, string[]> = {
    ...existing.codingByTest,
    ...(codingIds.length > 0 ? { [testId]: codingIds } : {}),
  };

  // Recompute the flat union sets
  const allMcq = Array.from(
    new Set(Object.values(nextMcqByTest).flat()),
  );
  const allCoding = Array.from(
    new Set(Object.values(nextCodingByTest).flat()),
  );

  await setDoc(
    trackerRef(courseId, seriesId),
    {
      courseId,
      seriesId,
      mcqIds: allMcq,
      mcqByTest: nextMcqByTest,
      codingIds: allCoding,
      codingByTest: nextCodingByTest,
      updatedAt: serverTimestamp(),
    },
    { merge: false }, // full overwrite to keep it clean
  );
}

/**
 * Remove a test's contribution from the tracker.
 * Call this when a test is deleted from the series.
 */
export async function removeTestFromTracker(
  courseId: string,
  seriesId: string,
  testId: string,
): Promise<void> {
  const existing = await getQuestionTracker(courseId, seriesId);
  const { [testId]: _mcq, ...nextMcqByTest } = existing.mcqByTest;
  const { [testId]: _coding, ...nextCodingByTest } = existing.codingByTest;
  void _mcq;
  void _coding;

  const allMcq = Array.from(new Set(Object.values(nextMcqByTest).flat()));
  const allCoding = Array.from(new Set(Object.values(nextCodingByTest).flat()));

  await setDoc(
    trackerRef(courseId, seriesId),
    {
      courseId,
      seriesId,
      mcqIds: allMcq,
      mcqByTest: nextMcqByTest,
      codingIds: allCoding,
      codingByTest: nextCodingByTest,
      updatedAt: serverTimestamp(),
    },
    { merge: false },
  );
}

/**
 * Helper: given an assessment (MCQ type), extract the bank question IDs.
 * Used when linking an existing assessment to a course test.
 */
export function extractMcqIds(questions: { id: string }[]): string[] {
  return questions.map((q) => q.id).filter(Boolean);
}

/**
 * Helper: given an assessment (coding type), extract challenge IDs.
 */
export function extractCodingIds(
  challenges: { id?: string; slug?: string }[],
): string[] {
  return challenges.map((c) => c.id ?? c.slug ?? "").filter(Boolean);
}
