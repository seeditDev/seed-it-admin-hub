import { doc, serverTimestamp, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { listUsersByRole, provisionAccount } from "@/lib/firestore/users";
import type { AppUser } from "@/types/seedit";

const USERS = "users";

export interface StaffInput {
  email: string;
  password?: string | undefined;
  displayName: string;
  tenantId: string;
  college: string;
  department: string;
  role: "staff" | "admin";
}

export async function listStaff(tenantId?: string): Promise<AppUser[]> {
  const [staff, admins] = await Promise.all([
    listUsersByRole("staff", tenantId),
    listUsersByRole("admin", tenantId),
  ]);
  return [...staff, ...admins].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Provisions faculty credentials through the isolated secondary auth app so the
 * signed-in admin session is never replaced.
 */
export async function provisionStaff(input: StaffInput): Promise<{ uid: string; authCreated: boolean }> {
  const result = await provisionAccount({
    email: input.email,
    ...(input.password ? { password: input.password } : {}),
    displayName: input.displayName,
    rollNumber: "",
    tenantId: input.tenantId,
    college: input.college,
    cohortId: "",
    year: "",
    department: input.department,
    premium: true,
    role: input.role,
  });
  await setDoc(
    doc(getDb(), USERS, result.uid),
    { active: true, updatedAt: serverTimestamp() },
    { merge: true },
  );
  return result;
}

export async function updateStaff(uid: string, patch: Partial<AppUser>): Promise<void> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  clean['updatedAt'] = serverTimestamp();
  await updateDoc(doc(getDb(), USERS, uid), clean);
}

export async function setStaffActive(uid: string, active: boolean): Promise<void> {
  await updateDoc(doc(getDb(), USERS, uid), { active, updatedAt: serverTimestamp() });
}

export async function deleteStaff(uid: string): Promise<void> {
  await deleteDoc(doc(getDb(), USERS, uid));
}
