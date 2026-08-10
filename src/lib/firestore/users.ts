import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { getDb, getSecondaryAuth, releaseSecondaryApp } from "@/lib/firebase";
import type { AppUser, Role } from "@/types/seedit";
import { sanitizeEmailKey } from "@/types/seedit";

const USERS = "users";
const BATCH_LIMIT = 400;

function mapUser(id: string, data: Record<string, unknown>): AppUser {
  return {
    uid: String(data['uid'] ?? id),
    email: String(data['email'] ?? ""),
    displayName: String(data['displayName'] ?? data['name'] ?? ""),
    role: (String(data['role'] ?? "student") as Role) ?? "student",
    tenantId: String(data['tenantId'] ?? data['college'] ?? ""),
    cohortId: String(data['cohortId'] ?? data['year'] ?? ""),
    college: data['college'] ? String(data['college']) : undefined,
    year: data['year'] ? String(data['year']) : undefined,
    department: data['department'] ? String(data['department']) : undefined,
    rollNumber: data['rollNumber'] ? String(data['rollNumber']) : undefined,
    premium: data['premium'] === true,
    createdAt: (data['createdAt'] ?? null) as AppUser["createdAt"],
    lastLoginAt: (data['lastLoginAt'] ?? null) as AppUser["lastLoginAt"],
  };
}

export async function getUserDoc(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(getDb(), USERS, uid));
  return snap.exists() ? mapUser(snap.id, snap.data() as Record<string, unknown>) : null;
}

/** Resolves the portal account for a signed-in admin: uid doc first, then sanitized-email doc. */
export async function resolveAccount(uid: string, email: string): Promise<AppUser | null> {
  const byUid = await getUserDoc(uid);
  if (byUid) return byUid;
  if (!email) return null;
  const byEmail = await getUserDoc(sanitizeEmailKey(email));
  if (byEmail) return byEmail;
  const matches = await getDocs(
    query(collection(getDb(), USERS), where("email", "==", email.toLowerCase())),
  );
  const first = matches.docs[0];
  return first ? mapUser(first.id, first.data() as Record<string, unknown>) : null;
}

export async function touchLastLogin(uid: string): Promise<void> {
  await updateDoc(doc(getDb(), USERS, uid), { lastLoginAt: serverTimestamp() }).catch(() => {});
}

/** Role-scoped listing: single-field queries only, so no composite index is required. */
export async function listUsersByRole(role: Role, tenantId?: string): Promise<AppUser[]> {
  const base = collection(getDb(), USERS);
  const snap = await getDocs(
    tenantId ? query(base, where("tenantId", "==", tenantId), where("role", "==", role)) : query(base, where("role", "==", role)),
  );
  return snap.docs.map((d) => mapUser(d.id, d.data() as Record<string, unknown>));
}

export async function listAllUsers(): Promise<AppUser[]> {
  const snap = await getDocs(collection(getDb(), USERS));
  return snap.docs.map((d) => mapUser(d.id, d.data() as Record<string, unknown>));
}

export interface StudentInput {
  email: string;
  password?: string;
  displayName: string;
  rollNumber: string;
  tenantId: string;
  college: string;
  cohortId: string;
  year: string;
  department: string;
  premium: boolean;
  role?: Role;
}

/**
 * Provision one account through the isolated secondary auth app so the
 * signed-in admin session is never replaced.
 */
export async function provisionAccount(
  input: StudentInput,
  opts: { keepSecondaryAlive?: boolean } = {},
): Promise<{ uid: string; authCreated: boolean }> {
  const email = input.email.trim().toLowerCase();
  const password = input.password?.trim() || "Seedit@123";
  let uid = sanitizeEmailKey(email);
  let authCreated = false;

  try {
    const cred = await createUserWithEmailAndPassword(getSecondaryAuth(), email, password);
    uid = cred.user.uid;
    authCreated = true;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code !== "auth/email-already-in-use") throw err;
    // Credential already exists — keep the Firestore profile in sync under the email key.
  } finally {
    if (!opts.keepSecondaryAlive) await releaseSecondaryApp();
  }

  await setDoc(
    doc(getDb(), USERS, uid),
    {
      uid,
      email,
      displayName: input.displayName,
      role: input.role ?? "student",
      tenantId: input.tenantId,
      cohortId: input.cohortId,
      college: input.college,
      year: input.year,
      department: input.department,
      rollNumber: input.rollNumber,
      premium: input.premium,
      createdAt: serverTimestamp(),
      lastLoginAt: null,
    },
    { merge: true },
  );

  return { uid, authCreated };
}

export async function updateStudent(uid: string, patch: Partial<AppUser>): Promise<void> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  await updateDoc(doc(getDb(), USERS, uid), clean);
}

export async function deleteStudent(uid: string): Promise<void> {
  await deleteDoc(doc(getDb(), USERS, uid));
}

/** Chunked batch premium toggle. Returns how many docs were written. */
export async function bulkSetPremium(uids: string[], premium: boolean): Promise<number> {
  const db = getDb();
  let written = 0;
  for (let i = 0; i < uids.length; i += BATCH_LIMIT) {
    const chunk = uids.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const uid of chunk) batch.update(doc(db, USERS, uid), { premium });
    await batch.commit();
    written += chunk.length;
  }
  return written;
}
