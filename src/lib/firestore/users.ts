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
import { normaliseYear, sanitizeEmailKey, YEAR_RANGE_HINT, yearToCohortCode } from "@/types/seedit";

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

/**
 * Role-scoped listing.
 * NOTE: when both tenantId and role filters are used this is a two-field
 * equality query requiring a composite index on (tenantId ASC, role ASC).
 * Deploy firestore.indexes.json to create it.
 */
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

function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string }).code ?? "";
  switch (code) {
    case "auth/operation-not-allowed":
      return "Email/password sign-in is disabled for this Firebase project. Enable it under Authentication → Sign-in method.";
    case "auth/invalid-email":
      return "That email address is not valid.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/network-request-failed":
      return "Network error while creating the credential. Check the connection and retry.";
    case "permission-denied":
      return "Firestore rejected the write. Publish firestore.rules from the repo root so admins can manage users.";
    default:
      return (err as { message?: string }).message || "Could not provision this account.";
  }
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
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid email address is required.");
  if (!input.displayName.trim()) throw new Error("Full name is required.");
  if (!input.tenantId.trim()) throw new Error("Select a college tenant first.");

  const role: Role = input.role ?? "student";
  if (role === "student") {
    const year = normaliseYear(input.year || input.cohortId);
    if (!year) throw new Error(`${YEAR_RANGE_HINT} (received "${input.year || input.cohortId || "empty"}").`);
    input = { ...input, year, cohortId: input.cohortId || yearToCohortCode(year) };
  }

  const password = input.password?.trim() || "Seedit@123";
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");

  let uid = sanitizeEmailKey(email);
  let authCreated = false;

  try {
    const cred = await createUserWithEmailAndPassword(getSecondaryAuth(), email, password);
    uid = cred.user.uid;
    authCreated = true;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code !== "auth/email-already-in-use") throw new Error(friendlyAuthError(err));
    // Auth account already exists — recover the real UID by querying Firestore
    // so the profile lands at users/{authUID} not users/{emailKey}.
    // Strategy: look for an existing users doc with matching email field first;
    // fall back to the sanitized email key doc if none found (legacy profiles).
    try {
      const existing = await getDocs(
        query(collection(getDb(), USERS), where("email", "==", email))
      );
      if (!existing.empty && existing.docs.length > 0) {
        const existingDoc = existing.docs[0]!;
        const storedUid = String((existingDoc.data() as Record<string, unknown>)['uid'] ?? existingDoc.id);
        // Use the stored uid only if it looks like a real Firebase UID (not a sanitized email)
        if (storedUid && !storedUid.includes('_at_') && !storedUid.includes('.')) {
          uid = storedUid;
        } else {
          uid = existingDoc.id;
        }
      }
      // uid stays as sanitizeEmailKey(email) only as last resort for legacy profiles
    } catch {
      console.warn('[provisionAccount] Could not resolve existing UID; using email key fallback');
    }
  } finally {
    if (!opts.keepSecondaryAlive) await releaseSecondaryApp();
  }

  try {
    // Derive final cohortId and numeric year unambiguously before writing
    const finalYear     = normaliseYear(input.year || input.cohortId) || input.year || '';
    const finalCohortId = input.cohortId || (finalYear ? yearToCohortCode(finalYear) : '');
    // College name (human-readable) and code (Firestore key = tenantId)
    const collegeName   = input.college || '';
    const collegeCode   = input.tenantId;

    await setDoc(
      doc(getDb(), USERS, uid),
      {
        // ── Identity ─────────────────────────────────────────────────
        uid,
        email,
        displayName: input.displayName.trim(),
        rollNumber:  input.rollNumber,
        role,
        active:      true,

        // ── Tenant / Cohort (primary fields, used by SEB buildAuthData) ──
        tenantId:    collegeCode,     // college code e.g. "TN000026"
        cohortId:    finalCohortId,   // e.g. "2K27"
        year:        finalYear,       // numeric graduation year e.g. "2027"
        department:  input.department,

        // ── College name fields (redundant aliases — ensures SEB never needs derivation) ──
        college:     collegeName,     // human-readable name
        collegeName: collegeName,     // alias for legacy readers
        collegeCode: collegeCode,     // alias = tenantId, for clarity

        // ── Premium / timestamps ──────────────────────────────────────
        premium:     input.premium,
        createdAt:   serverTimestamp(),
        lastLoginAt: null,
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(friendlyAuthError(err));
  }

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
