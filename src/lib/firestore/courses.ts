/**
 * Firestore CRUD for the courses hierarchy:
 *   courses/{courseId}
 *     └── series/{seriesId}
 *           └── tests/{testId}
 *
 * A "test" maps to one or more published assessments/{id} docs.
 * For MSA, it has a sections[] array where each section references an assessmentId.
 * College targeting is stored per-test (targeting field) so the SEB can
 * query tests assigned to a given tenant/cohort.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { AssessmentTargeting } from "@/types/seedit";
import { DEFAULT_TARGETING } from "@/types/seedit";
import { syncTenantCourseTests, deleteTenantCourseTest } from "@/lib/firestore/tenantCourses";

/* ─────────────────────────── Types ─────────────────────────── */

export type SeriesType = "WEEKLY" | "MOCK" | "PLACEMENT" | "SEMESTER" | "CUSTOM";
export type TestType = "mcq" | "coding" | "msa" | "sea";
export type ScheduleType = "none" | "one_time" | "daily" | "weekly";

export interface ScheduleConfig {
  type: ScheduleType;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  daysOfWeek: string[];
  timezone: string;
}

export interface MSASection {
  /** Stable section ID, e.g. "CA001_S1" */
  sectionId: string;
  name: string;
  /** Type of this section's content */
  type: "mcq" | "coding" | "sea";
  /**
   * CDN URL to this section's assessment JSON in seed-contents.
   * e.g. https://raw.githubusercontent.com/seeditDev/seed-contents/main/mcq/testbank/mcq-section1.json
   */
  cdnUrl: string;
  /**
   * Firestore document ID of the linked assessment (from assessments/{id}).
   * Populated when admin selects a saved assessment from the dropdown.
   * Optional — legacy sections written before this field was added may omit it.
   */
  assessmentId?: string;
  duration_minutes: number;
  /** Optional per-question timer in seconds (0 = none) */
  questionTimer: number;
  /**
   * Comma-separated per-question timers for coding sections, e.g. "600,900,1200"
   * Each value maps to the challenge at the same index. Overrides questionTimer.
   */
  questionTimerList: string;
  /**
   * If true, the timer cannot be paused and auto-submits when it expires.
   * Student cannot manually submit before time.
   */
  timerRestrictedSubmit: boolean;
  /**
   * If true, students can only move forward through questions — no going back.
   */
  forwardOnly: boolean;
  order: number;
}

export interface TestSettings {
  /** Randomise question order for each attempt */
  shuffleQuestions: boolean;
  /** Randomise option order for MCQ questions */
  shuffleOptions: boolean;
  /** Allow student to change coding language mid-test */
  allowLanguageSwitch: boolean;
  /** Show score / correct answers immediately after submission */
  showResultAfterSubmit: boolean;
  /** Languages available in the coding sandbox */
  allowedLanguages: string[];
}

export interface TestDoc {
  id: string;
  name: string;
  description: string;
  type: TestType;
  /**
   * For non-MSA tests: CDN URL to the assessment JSON in seed-contents.
   * e.g. https://raw.githubusercontent.com/seeditDev/seed-contents/main/mcq/testbank/unit-test-1.json
   * This is the same link SEB uses to load the test content.
   */
  cdnUrl: string;
  /** Legacy field kept for backward compat — prefer cdnUrl */
  assessmentId: string;
  /** For MSA: list of sections, each referencing a cdnUrl */
  sections: MSASection[];
  duration_minutes: number;
  totalMarks: number;
  difficulty: "Easy" | "Medium" | "Hard";
  proctored: boolean;
  audioProctored: boolean;
  maxViolations: number;
  maxAudioViolations: number;
  /** Maximum number of re-attempts per question (1 = strict, no retry) */
  maxAttempts: number;
  passkey: string;
  isPremium: boolean;
  /**
   * Allow non-authenticated (guest) users to take this test.
   * When true, students enter name/college/roll-no instead of logging in.
   */
  guestEnabled: boolean;
  /**
   * Short code used to find this test via the guest portal (e.g. "PLACE2025").
   * Required when guestEnabled = true.
   */
  assessmentCode: string;
  display_order: number;
  schedule: ScheduleConfig;
  /** Behaviour/display settings */
  settings: TestSettings;
  /** Which colleges/cohorts can access this test */
  targeting: AssessmentTargeting;
  /** Tenant (college code) this test belongs to — used for guestTests sync */
  tenantId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SeriesDoc {
  id: string;
  title: string;
  description: string;
  type: SeriesType;
  display_order: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CourseDoc {
  id: string;
  title: string;
  description: string;
  display_order: number;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/* ─────────────────────── Default values ─────────────────────── */

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  type: "none",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  daysOfWeek: [],
  timezone: "Asia/Kolkata",
};

export const SERIES_TYPES: SeriesType[] = ["WEEKLY", "MOCK", "PLACEMENT", "SEMESTER", "CUSTOM"];

/* ─────────────────────── Mappers ──────────────────────────────── */

function mapCourse(id: string, d: Record<string, unknown>): CourseDoc {
  return {
    id,
    title: String(d["title"] ?? id),
    description: String(d["description"] ?? ""),
    display_order: Number(d["display_order"] ?? 999),
    active: d["active"] !== false,
    createdAt: d["createdAt"],
    updatedAt: d["updatedAt"],
  };
}

function mapSeries(id: string, d: Record<string, unknown>): SeriesDoc {
  return {
    id,
    title: String(d["title"] ?? id),
    description: String(d["description"] ?? ""),
    type: (d["type"] as SeriesType) ?? "WEEKLY",
    display_order: Number(d["display_order"] ?? 999),
    createdAt: d["createdAt"],
    updatedAt: d["updatedAt"],
  };
}

function mapTest(id: string, d: Record<string, unknown>): TestDoc {
  const sections = Array.isArray(d["sections"])
    ? (d["sections"] as MSASection[]).map((s) => ({
        ...s,
        questionTimerList: String(s.questionTimerList ?? ""),
        timerRestrictedSubmit: Boolean(s.timerRestrictedSubmit),
        forwardOnly: Boolean(s.forwardOnly),
      }))
    : [];
  const savedSettings = (d["settings"] ?? {}) as Record<string, unknown>;
  return {
    id,
    name: String(d["name"] ?? id),
    description: String(d["description"] ?? ""),
    type: (d["type"] as TestType) ?? "mcq",
    cdnUrl: String(d["cdnUrl"] ?? ""),
    assessmentId: String(d["assessmentId"] ?? ""),
    sections,
    duration_minutes: Number(d["duration_minutes"] ?? 60),
    totalMarks: Number(d["totalMarks"] ?? 100),
    difficulty: (d["difficulty"] as TestDoc["difficulty"]) ?? "Medium",
    proctored: d["proctored"] !== false && Boolean(d["proctored"]),
    audioProctored: Boolean(d["audioProctored"]),
    maxViolations: Number(d["maxViolations"] ?? 5),
    maxAudioViolations: Number(d["maxAudioViolations"] ?? 3),
    maxAttempts: Number(d["maxAttempts"] ?? 1),
    passkey: String(d["passkey"] ?? ""),
    isPremium: Boolean(d["isPremium"]),
    guestEnabled: Boolean(d["guestEnabled"]),
    assessmentCode: String(d["assessmentCode"] ?? ""),
    display_order: Number(d["display_order"] ?? 999),
    schedule: (d["schedule"] as ScheduleConfig) ?? { ...DEFAULT_SCHEDULE },
    settings: {
      shuffleQuestions: Boolean(savedSettings["shuffleQuestions"] ?? false),
      shuffleOptions: Boolean(savedSettings["shuffleOptions"] ?? false),
      allowLanguageSwitch: savedSettings["allowLanguageSwitch"] !== false,
      showResultAfterSubmit: savedSettings["showResultAfterSubmit"] !== false,
      allowedLanguages: Array.isArray(savedSettings["allowedLanguages"])
        ? (savedSettings["allowedLanguages"] as string[])
        : ["C", "C++", "Java", "Python3"],
    },
    targeting: (d["targeting"] as AssessmentTargeting) ?? { ...DEFAULT_TARGETING },
    createdAt: d["createdAt"],
    updatedAt: d["updatedAt"],
  };
}

/* ─────────────────────── Firestore path helpers ──────────────── */

const COURSES = "courses";
const coursesCol = () => collection(getDb(), COURSES);
const seriesCol = (courseId: string) => collection(getDb(), COURSES, courseId, "series");
const testsCol = (courseId: string, seriesId: string) =>
  collection(getDb(), COURSES, courseId, "series", seriesId, "tests");

/* ─────────────────────── Course CRUD ──────────────────────────── */

export async function listCourses(): Promise<CourseDoc[]> {
  const snap = await getDocs(query(coursesCol(), orderBy("display_order")));
  return snap.docs.map((d) => mapCourse(d.id, d.data() as Record<string, unknown>));
}

export async function saveCourse(input: Omit<CourseDoc, "createdAt" | "updatedAt">, isNew: boolean): Promise<string> {
  const id = input.id.trim() || input.title.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  const ref = doc(getDb(), COURSES, id);
  const payload: Record<string, unknown> = {
    id,
    title: input.title.trim(),
    description: input.description,
    display_order: input.display_order,
    active: input.active,
    updatedAt: serverTimestamp(),
  };
  if (isNew) payload["createdAt"] = serverTimestamp();
  await setDoc(ref, payload, { merge: true });
  return id;
}

export async function deleteCourse(courseId: string): Promise<void> {
  // Delete all series and tests under it first
  const seriesSnap = await getDocs(seriesCol(courseId));
  const batch = writeBatch(getDb());
  for (const sDoc of seriesSnap.docs) {
    const testsSnap = await getDocs(testsCol(courseId, sDoc.id));
    testsSnap.docs.forEach((t) => batch.delete(t.ref));
    batch.delete(sDoc.ref);
  }
  batch.delete(doc(getDb(), COURSES, courseId));
  await batch.commit();
}

/* ─────────────────────── Series CRUD ──────────────────────────── */

export async function listSeries(courseId: string): Promise<SeriesDoc[]> {
  const snap = await getDocs(query(seriesCol(courseId), orderBy("display_order"))).catch(
    async () => getDocs(seriesCol(courseId)),
  );
  return snap.docs.map((d) => mapSeries(d.id, d.data() as Record<string, unknown>));
}

export async function saveSeries(
  courseId: string,
  input: Omit<SeriesDoc, "createdAt" | "updatedAt">,
  isNew: boolean,
): Promise<string> {
  const existingSeries = await getDocs(seriesCol(courseId));
  const count = existingSeries.size;
  const id = input.id.trim() || `AS${String(count + 1).padStart(3, "0")}`;
  const ref = doc(getDb(), COURSES, courseId, "series", id);
  const payload: Record<string, unknown> = {
    id,
    title: input.title.trim(),
    description: input.description,
    type: input.type,
    display_order: input.display_order,
    updatedAt: serverTimestamp(),
  };
  if (isNew) payload["createdAt"] = serverTimestamp();
  await setDoc(ref, payload, { merge: true });
  return id;
}

export async function deleteSeries(courseId: string, seriesId: string): Promise<void> {
  const testsSnap = await getDocs(testsCol(courseId, seriesId));
  const batch = writeBatch(getDb());
  testsSnap.docs.forEach((t) => batch.delete(t.ref));
  batch.delete(doc(getDb(), COURSES, courseId, "series", seriesId));
  await batch.commit();
}

/* ─────────────────────── Test CRUD ────────────────────────────── */

export async function listTests(courseId: string, seriesId: string): Promise<TestDoc[]> {
  const snap = await getDocs(query(testsCol(courseId, seriesId), orderBy("display_order"))).catch(
    async () => getDocs(testsCol(courseId, seriesId)),
  );
  return snap.docs.map((d) => mapTest(d.id, d.data() as Record<string, unknown>));
}

export async function saveTest(
  courseId: string,
  seriesId: string,
  input: Omit<TestDoc, "createdAt" | "updatedAt">,
  isNew: boolean,
): Promise<string> {
  const existingTests = await getDocs(testsCol(courseId, seriesId));
  const count = existingTests.size;
  const seriesPrefix = seriesId.replace(/\D/g, "") || String(count);
  const id = input.id.trim() || `${seriesId}_T${String(count + 1).padStart(3, "0")}`;
  void seriesPrefix; // used indirectly via seriesId

  // For MSA, compute total duration from sections
  const duration =
    input.type === "msa" && input.sections.length > 0
      ? input.sections.reduce((sum, s) => sum + (Number(s.duration_minutes) || 0), 0)
      : input.duration_minutes;

  const ref = doc(getDb(), COURSES, courseId, "series", seriesId, "tests", id);
  const payload: Record<string, unknown> = {
    id,
    name: input.name.trim(),
    description: input.description,
    type: input.type,
    cdnUrl: input.type !== "msa" ? (input.cdnUrl ?? "") : "",
    assessmentId: input.assessmentId ?? "",
    sections: input.type === "msa" ? input.sections : [],
    duration_minutes: duration,
    totalMarks: input.totalMarks,
    difficulty: input.difficulty,
    proctored: input.proctored,
    audioProctored: input.audioProctored,
    maxViolations: input.maxViolations,
    maxAudioViolations: input.maxAudioViolations,
    passkey: input.passkey,
    isPremium: input.isPremium,
    guestEnabled: Boolean(input.guestEnabled),
    assessmentCode: input.assessmentCode ?? "",
    display_order: input.display_order,
    schedule: input.schedule,
    targeting: input.targeting,
    updatedAt: serverTimestamp(),
  };
  if (isNew) payload["createdAt"] = serverTimestamp();
  await setDoc(ref, payload, { merge: true });

  // ── Sync tenantCourses (non-blocking, best-effort) ──
  // For all tenants in targeting.tenantIds, upsert the test summary.
  // On guest-toggle changes this keeps the guest portal list current.
  void syncTenantCourseTests(
    [], // no previous tracking on plain save — we only add, never remove
    (input.targeting?.tenantIds ?? []),
    id,
    {
      courseId,
      seriesId,
      name: input.name.trim(),
      type: input.type,
      cdnUrl: input.type !== "msa" ? (input.cdnUrl ?? "") : "",
      sections: input.type === "msa" ? input.sections : [],
      duration: duration,
      totalMarks: input.totalMarks,
      passkey: input.passkey,
      proctored: input.proctored,
      audioProctored: input.audioProctored,
      guestEnabled: Boolean(input.guestEnabled),
      schedule: input.schedule ?? {},
    },
  ).catch((e: unknown) => console.warn("[courses] tenantCourses sync failed (non-fatal):", e));

  return id;
}

export async function deleteTest(courseId: string, seriesId: string, testId: string): Promise<void> {
  // Fetch targeting before delete so we can clean up tenantCourses
  const snap = await getDoc(doc(getDb(), COURSES, courseId, "series", seriesId, "tests", testId)).catch(() => null);
  const targeting = (snap?.data()?.["targeting"] as AssessmentTargeting) ?? DEFAULT_TARGETING;

  await deleteDoc(doc(getDb(), COURSES, courseId, "series", seriesId, "tests", testId));

  // Clean up tenantCourses mirrors (non-blocking)
  void Promise.all(
    (targeting.tenantIds ?? []).map((tid) => deleteTenantCourseTest(tid, testId).catch(() => {})),
  );
}

/**
 * Update only the targeting field of a test — used by the "Assign to College" panel.
 * Also syncs tenantCourses: adds entries for new tenants, removes for dropped ones.
 */
export async function updateTestTargeting(
  courseId: string,
  seriesId: string,
  testId: string,
  targeting: AssessmentTargeting,
): Promise<void> {
  const ref = doc(getDb(), COURSES, courseId, "series", seriesId, "tests", testId);

  // Fetch previous targeting for diff
  const prev = await getDoc(ref).catch(() => null);
  const prevTargeting = (prev?.data()?.["targeting"] as AssessmentTargeting) ?? DEFAULT_TARGETING;
  const prevIds = prevTargeting.tenantIds ?? [];

  await updateDoc(ref, { targeting, updatedAt: serverTimestamp() });

  // Fetch full test snapshot so tenantCourses has all display fields
  const snap = await getDoc(ref).catch(() => null);
  if (snap?.exists()) {
    const d = snap.data() as Record<string, unknown>;
    void syncTenantCourseTests(
      prevIds,
      targeting.tenantIds ?? [],
      testId,
      {
        courseId,
        seriesId,
        name: String(d["name"] ?? testId),
        type: String(d["type"] ?? "mcq"),
        cdnUrl: String(d["cdnUrl"] ?? ""),
        sections: Array.isArray(d["sections"]) ? d["sections"] as import("@/lib/firestore/courses").MSASection[] : [],
        duration: Number(d["duration_minutes"] ?? 30),
        totalMarks: Number(d["totalMarks"] ?? 0),
        passkey: String(d["passkey"] ?? ""),
        proctored: Boolean(d["proctored"]),
        audioProctored: Boolean(d["audioProctored"]),
        guestEnabled: Boolean(d["guestEnabled"]),
        schedule: (d["schedule"] ?? {}) as import("@/lib/firestore/courses").ScheduleConfig,
      },
    ).catch((e: unknown) => console.warn("[courses] tenantCourses targeting sync failed:", e));
  }
}

/**
 * Get a JSON snapshot of a test document matching the old access_control.json module shape.
 * Used by the "View JSON" preview button.
 */
export function testToAccessControlJson(test: TestDoc): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: test.id,
    name: test.name,
    description: test.description,
    type: test.type === "msa" ? "MSA" : test.type,
    // url field mirrors old access_control.json — SEB reads from this CDN URL
    url: test.cdnUrl || test.assessmentId,
    cdnUrl: test.cdnUrl,
    duration_minutes: test.duration_minutes,
    totalMarks: test.totalMarks,
    difficulty: test.difficulty,
    proctored: test.proctored,
    audioProctored: test.audioProctored,
    maxViolations: test.maxViolations,
    maxAudioViolations: test.maxAudioViolations,
    passkey: test.passkey,
    isPremium: test.isPremium,
    guestEnabled: Boolean(test.guestEnabled),
    assessmentCode: test.assessmentCode ?? "",
    display_order: test.display_order,
    schedule: test.schedule,
    targeting: test.targeting,
  };
  if (test.type === "msa") {
    base["isMultiSection"] = true;
    base["sections"] = test.sections;
  }
  return base;
}
