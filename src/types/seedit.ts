import type { Timestamp } from "firebase/firestore";

export type Role = "student" | "staff" | "admin" | "superadmin";
export type AssessmentType = "mcq" | "coding" | "multisection" | "spoken-english";
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
  createdAt?: Timestamp | null | undefined;
  settings: TenantSettings;
}

export interface Cohort {
  id: string;
  label: string;
  year: string;
  departments: string[];
  allowedModules: string[];
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
