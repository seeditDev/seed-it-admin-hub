import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { Cohort, Tenant, TenantSettings } from "@/types/seedit";
import { DEFAULT_TENANT_SETTINGS } from "@/types/seedit";

const TENANTS = "tenants";
/** Minimal public projection — fields safe for unauthenticated reads. */
const PUBLIC_TENANTS = "publicTenants";


function normaliseSettings(raw: unknown): TenantSettings {
  const s = (raw ?? {}) as Partial<TenantSettings>;
  return {
    gracePeriodSeconds: Number(s.gracePeriodSeconds ?? DEFAULT_TENANT_SETTINGS.gracePeriodSeconds),
    maxViolations: Number(s.maxViolations ?? DEFAULT_TENANT_SETTINGS.maxViolations),
    proctorMode: s.proctorMode ?? DEFAULT_TENANT_SETTINGS.proctorMode,
  };
}

export async function listTenants(): Promise<Tenant[]> {
  const snap = await getDocs(collection(getDb(), TENANTS));
  return snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        name: String(data['name'] ?? d.id),
        slug: String(data['slug'] ?? d.id.toLowerCase()),
        logoUrl: data['logoUrl'] ? String(data['logoUrl']) : undefined,
        active: data['active'] !== false,
        gateKey: data['gateKey'] ? String(data['gateKey']) : undefined,
        createdAt: (data['createdAt'] ?? null) as Tenant["createdAt"],
        settings: normaliseSettings(data['settings']),
      } satisfies Tenant;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertTenant(input: {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  gateKey?: string;
  settings: TenantSettings;
  isNew: boolean;
}): Promise<void> {
  const ref = doc(getDb(), TENANTS, input.id);
  const pubRef = doc(getDb(), PUBLIC_TENANTS, input.id);

  if (input.isNew) {
    const existing = await getDoc(ref);
    if (existing.exists()) throw new Error(`Tenant "${input.id}" already exists.`);
    await setDoc(ref, {
      id: input.id,
      name: input.name,
      slug: input.slug,
      active: input.active,
      gateKey: input.gateKey ?? "",
      settings: input.settings,
      createdAt: serverTimestamp(),
    });
    // Write safe public projection (no gateKey/settings)
    await setDoc(pubRef, {
      name: input.name,
      slug: input.slug,
      active: input.active,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return;
  }
  await updateDoc(ref, {
    name: input.name,
    slug: input.slug,
    active: input.active,
    gateKey: input.gateKey ?? "",
    settings: input.settings,
  });
  // Keep public projection in sync
  await setDoc(pubRef, {
    name: input.name,
    slug: input.slug,
    active: input.active,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}


export async function deleteTenant(tenantId: string): Promise<void> {
  const cohorts = await getDocs(collection(getDb(), TENANTS, tenantId, "cohorts"));
  await Promise.all(cohorts.docs.map((c) => deleteDoc(c.ref)));
  await deleteDoc(doc(getDb(), TENANTS, tenantId));
  // Remove public projection too
  await deleteDoc(doc(getDb(), PUBLIC_TENANTS, tenantId)).catch(() => {});
}


export async function listCohorts(tenantId: string): Promise<Cohort[]> {
  if (!tenantId) return [];
  const snap = await getDocs(
    query(collection(getDb(), TENANTS, tenantId, "cohorts"), orderBy("year", "desc")),
  ).catch(async () => getDocs(collection(getDb(), TENANTS, tenantId, "cohorts")));

  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const departments = Array.isArray(data['departments'])
      ? (data['departments'] as string[])
      : data['department']
        ? [String(data['department'])]
        : [];
    return {
      id: d.id,
      label: String(data['label'] ?? d.id),
      year: String(data['year'] ?? d.id),
      departments,
      allowedModules: Array.isArray(data['allowedModules']) ? (data['allowedModules'] as string[]) : [],
      gateKey: data['gateKey'] ? String(data['gateKey']) : undefined,
      batchStart: data['batchStart'] ? String(data['batchStart']) : undefined,
      batchEnd: data['batchEnd'] ? String(data['batchEnd']) : undefined,
      active: data['active'] !== false,
      studentCount: typeof data['studentCount'] === "number" ? data['studentCount'] : undefined,
    } satisfies Cohort;
  });
}

export async function upsertCohort(tenantId: string, cohort: Cohort): Promise<void> {
  await setDoc(
    doc(getDb(), TENANTS, tenantId, "cohorts", cohort.id),
    {
      id: cohort.id,
      label: cohort.label,
      year: cohort.year,
      departments: cohort.departments,
      allowedModules: cohort.allowedModules,
      gateKey: cohort.gateKey ?? "",
      batchStart: cohort.batchStart ?? "",
      batchEnd: cohort.batchEnd ?? "",
      active: cohort.active !== false,
    },
    { merge: true },
  );
}

export async function deleteCohort(tenantId: string, cohortId: string): Promise<void> {
  await deleteDoc(doc(getDb(), TENANTS, tenantId, "cohorts", cohortId));
}

/**
 * Persist the full allowedModules list for a cohort.
 *
 * Behaviour:
 *  - Deduplicates the list before writing (prevents double-entries)
 *  - When `validateNewKeys` is provided, runs validateCohortAssignment() for
 *    each key in the set that was not in `previousModules` and accumulates
 *    any errors. If hard errors exist, the write is blocked and an Error thrown.
 *
 * The moduleKey format used by SEB: courseId::seriesId::testId
 */
export async function setAllowedModules(
  tenantId: string,
  cohortId: string,
  allowedModules: string[],
  opts?: {
    /** Keys that were already assigned before this save (used to detect new additions) */
    previousModules?: string[];
    /** Run delivery validation on newly added keys */
    validateNewKeys?: boolean;
  },
): Promise<void> {
  // 1. Deduplicate — preserve order, remove exact duplicates
  const seen = new Set<string>();
  const deduped = allowedModules.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 2. Optional pre-save validation of newly added keys
  if (opts?.validateNewKeys) {
    const prev = new Set(opts.previousModules ?? []);
    const newKeys = deduped.filter((k) => !prev.has(k));

    if (newKeys.length > 0) {
      const { validateCohortAssignment } = await import("@/lib/firestore/delivery");
      const allErrors: string[] = [];
      const allWarnings: string[] = [];

      await Promise.all(
        newKeys.map(async (key) => {
          const parts = key.split("::");
          if (parts.length !== 3) {
            allErrors.push(`"${key}" is not a valid module key (expected courseId::seriesId::testId).`);
            return;
          }
          const [courseId, seriesId, testId] = parts as [string, string, string];
          const result = await validateCohortAssignment(
            courseId,
            seriesId,
            testId,
            tenantId,
            cohortId,
            opts.previousModules ?? [],
          );
          allErrors.push(...result.errors.map((e) => `[${key}] ${e}`));
          allWarnings.push(...result.warnings.map((w) => `[${key}] ${w}`));
        }),
      );

      if (allWarnings.length > 0) {
        console.warn("[setAllowedModules] Validation warnings:", allWarnings.join(" | "));
      }
      if (allErrors.length > 0) {
        throw new Error(
          `Assignment blocked — ${allErrors.length} validation error(s):\n` +
            allErrors.join("\n"),
        );
      }
    }
  }

  // 3. Write the deduplicated list
  await updateDoc(doc(getDb(), TENANTS, tenantId, "cohorts", cohortId), {
    allowedModules: deduped,
  });
}
