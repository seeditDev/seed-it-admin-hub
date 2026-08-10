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
  settings: TenantSettings;
  isNew: boolean;
}): Promise<void> {
  const ref = doc(getDb(), TENANTS, input.id);
  if (input.isNew) {
    const existing = await getDoc(ref);
    if (existing.exists()) throw new Error(`Tenant "${input.id}" already exists.`);
    await setDoc(ref, {
      id: input.id,
      name: input.name,
      slug: input.slug,
      active: input.active,
      settings: input.settings,
      createdAt: serverTimestamp(),
    });
    return;
  }
  await updateDoc(ref, {
    name: input.name,
    slug: input.slug,
    active: input.active,
    settings: input.settings,
  });
}

export async function deleteTenant(tenantId: string): Promise<void> {
  const cohorts = await getDocs(collection(getDb(), TENANTS, tenantId, "cohorts"));
  await Promise.all(cohorts.docs.map((c) => deleteDoc(c.ref)));
  await deleteDoc(doc(getDb(), TENANTS, tenantId));
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

export async function setAllowedModules(
  tenantId: string,
  cohortId: string,
  allowedModules: string[],
): Promise<void> {
  await updateDoc(doc(getDb(), TENANTS, tenantId, "cohorts", cohortId), { allowedModules });
}
