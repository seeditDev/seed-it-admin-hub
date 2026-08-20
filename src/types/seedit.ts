import type { Timestamp } from "firebase/firestore";

export type Role = "student" | "staff" | "admin" | "superadmin";
/**
 * There is only ONE assessment type: "assessment".
 * MCQ / Coding / Spoken English are SECTION types within an assessment — not top-level types.
 * Legacy values ("mcq", "coding", "multisection", "spoken-english") are kept as aliases for
 * backward read compatibility only. New documents are always written as "assessment".
 */
export type AssessmentType = "assessment";
/** Section-level type — what kind of questions this section contains. */
export type SectionType = "mcq" | "coding" | "spoken_english";
export type AssessmentStatus = "draft" | "active" | "archived";
export type ProctorMode = "face" | "audio" | "face+audio" | "off";

export interface TenantSettings {
  gracePeriodSeconds: number;
  maxViolations: number;
  proctorMode: ProctorMode;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | undefined;
  active: boolean;
  /**
   * Optional college-level gate key for the Guest Portal.
   * If set, guests must enter this key after selecting their college
   * before they can see personal details form and assessment list.
   * Leave empty for open guest access.
   */
  gateKey?: string | undefined;
  createdAt?: Timestamp | null | undefined;
  settings: TenantSettings;
}

export interface Cohort {
  id: string;
  label: string;
  year: string;
  departments: string[];
  allowedModules: string[];
  /** Per-cohort gate key for the Guest Portal. Guests entering this key get exactly this cohort's assessments. */
  gateKey?: string | undefined;
  batchStart?: string | undefined;
  batchEnd?: string | undefined;
  active?: boolean | undefined;
  studentCount?: number | undefined;
}

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  tenantId: string;
  cohortId: string;
  college?: string | undefined;
  year?: string | undefined;
  department?: string | undefined;
  rollNumber?: string | undefined;
  premium: boolean;
  active?: boolean | undefined;
  createdAt?: Timestamp | null | undefined;
  lastLoginAt?: Timestamp | null | undefined;
}


export interface ProctorConfig {
  enabled: boolean;
  cameraRequired: boolean;
  audioRequired: boolean;
  tabSwitchLimit: number;
  maxViolations: number;
  autoSubmitOnViolation: boolean;
}

export interface Assessment {
  id: string;
  title: string;
  type: AssessmentType;
  tenantId: string;
  cohortIds?: string[] | undefined;
  durationMinutes: number;
  totalMarks: number;
  status: AssessmentStatus;
  scheduledStart?: string | null | undefined;
  scheduledEnd?: string | null | undefined;
  createdBy?: string | undefined;
  createdAt?: Timestamp | null | undefined;
  proctorConfig: ProctorConfig;
}

/** Full department catalogue used across cohorts, rosters and Excel imports. */
export const DEPARTMENTS = [
  "CSE",
  "IT",
  "ECE",
  "EEE",
  "MECH",
  "CIVIL",
  "AIDS",
  "AIML",
  "CSBS",
  "CSD",
  "MECHATRONICS",
  "CYBER",
  "IOT",
  "CLOUD",
  "ETC",
] as const;

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  gracePeriodSeconds: 900,
  maxViolations: 5,
  proctorMode: "face+audio",
};

export const DEFAULT_PROCTOR_CONFIG: ProctorConfig = {
  enabled: true,
  cameraRequired: true,
  audioRequired: false,
  tabSwitchLimit: 3,
  maxViolations: 5,
  autoSubmitOnViolation: true,
};

/** users/{uid} fallback key when there is no Firebase Auth uid: user_email_com */
export function sanitizeEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/[.@+]/g, "_");
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------------ *
 * Academic year constraint — the platform only operates on 2027-2032 *
 * ------------------------------------------------------------------ */

export const ALLOWED_YEARS = ["2027", "2028", "2029", "2030", "2031", "2032"] as const;
export type AllowedYear = (typeof ALLOWED_YEARS)[number];

/** Cohort codes mirroring ALLOWED_YEARS: 2027 -> 2K27 */
export const ALLOWED_COHORT_CODES = ALLOWED_YEARS.map((y) => `2K${y.slice(2)}`) as unknown as readonly string[];

export const YEAR_RANGE_HINT = "Academic year must be between 2027 and 2032";

/** Accepts 2027, "2027", "2K27", "2k27", "AY2027" and returns the canonical "2027" or null. */
export function normaliseYear(raw: unknown): AllowedYear | null {
  const text = String(raw ?? "").trim().toUpperCase();
  if (!text) return null;
  const compact = text.replace(/[^0-9K]/g, "");
  const short = compact.match(/^2K(\d{2})$/);
  const full = compact.match(/(20\d{2})/);
  const candidate = short ? `20${short[1]}` : (full?.[1] ?? "");
  return (ALLOWED_YEARS as readonly string[]).includes(candidate) ? (candidate as AllowedYear) : null;
}

export function isAllowedYear(raw: unknown): boolean {
  return normaliseYear(raw) !== null;
}

/** "2027" -> "2K27" */
export function yearToCohortCode(year: string): string {
  const norm = normaliseYear(year);
  return norm ? `2K${norm.slice(2)}` : year;
}

/* ------------------------------- Authoring ------------------------------- */

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const CODING_LANGUAGES = ["c", "cpp", "java", "python"] as const;
export type CodingLanguage = (typeof CODING_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<CodingLanguage, string> = {
  c: "C",
  cpp: "C++",
  java: "Java",
  python: "Python",
};

export interface McqQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation?: string | undefined;
  difficulty: Difficulty;
  marks: number;
}

export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
  hidden: boolean;
  points: number;
}

export interface CodingProblem {
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  memoryLimitMb: number;
  timeLimitSeconds: number;
  languages: CodingLanguage[];
  blockCopyPaste: boolean;
  fullScreenLock: boolean;
  testCases: TestCase[];
}

/** A single coding challenge entry in a Coding assessment.
 *  Extends CodingProblem with top-level id / title so the creator UI
 *  can list multiple challenges in one assessment. */
export interface CodingChallenge extends CodingProblem {
  /** Stable ID — used as bank key and dedup guard. */
  id: string;
  title: string;
  difficulty: Difficulty;
  /** Category tag (e.g. "Arrays", "Graphs"). */
  category: string;
  /** True when loaded from the Firestore bank so we skip re-writing bank data. */
  isMapped?: boolean;
  /** CDN URL for the full question JSON (seed-contents). Populated when loaded from bank. */
  cdnUrl?: string;
}

export interface SeaPrompt {
  id: string;
  prompt: string;
  referenceTranscript?: string | undefined;
  keywords: string[];
  minSeconds: number;
  maxSeconds: number;
  retakesAllowed: number;
}

export interface SeaRubric {
  fluencyWeight: number;
  pronunciationWeight: number;
  grammarWeight: number;
  keywordWeight: number;
  passThreshold: number;
}

/** Targeting shared by every authoring module. */
export interface AssessmentTargeting {
  tenantIds: string[];
  years: string[];
  departments: string[];
}

export const DEFAULT_TARGETING: AssessmentTargeting = {
  tenantIds: [],
  years: [],
  departments: [],
};

export interface ProctorEventRow {
  id: string;
  attemptId: string;
  assessmentId: string;
  assessmentTitle: string;
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  year: string;
  department: string;
  type: string;
  severity: "low" | "medium" | "high";
  detail: string;
  at: Date | null;
}
