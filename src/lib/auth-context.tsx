import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { resolveAccount, touchLastLogin } from "@/lib/firestore/users";
import type { AppUser, Role } from "@/types/seedit";

const PORTAL_ROLES: Role[] = ["admin", "superadmin", "staff"];

interface AuthState {
  firebaseUser: FirebaseUser | null;
  account: AppUser | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  /** The raw role string from the user's Firestore profile ("admin", "staff", "student", etc.) */
  role: string | null;
  /** Tenant a staff member is scoped to; null means unrestricted. */
  scopedTenantId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [account, setAccount] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(getFirebaseAuth(), async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setAccount(null);
        setLoading(false);
        return;
      }
      try {
        const resolved = await resolveAccount(user.uid, user.email ?? "");
        if (!resolved) {
          setAccount(null);
          setError("No portal profile found for this account.");
        } else if (!PORTAL_ROLES.includes(resolved.role)) {
          setAccount(null);
          setError("This account does not have admin or staff access.");
        } else {
          setAccount(resolved);
          setError(null);
          void touchLastLogin(resolved.uid);
        }
      } catch {
        setError("Could not load your profile. Check your connection and try again.");
        setAccount(null);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const value = useMemo<AuthState>(() => {
    const role = account?.role ?? null;
    const isAdmin = role === "admin" || role === "superadmin";
    return {
      firebaseUser,
      account,
      loading,
      error,
      isAuthenticated: Boolean(firebaseUser && account),
      isAdmin,
      isStaff: role === "staff",
      role,
      scopedTenantId: role === "staff" ? (account?.tenantId ?? null) : null,
      signIn: async (email, password) => {
        setError(null);
        setLoading(true);
        try {
          await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
        } catch (err) {
          setLoading(false);
          const code = (err as { code?: string }).code ?? "";
          throw new Error(
            code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found"
              ? "Incorrect email or password."
              : code === "auth/too-many-requests"
                ? "Too many attempts. Please wait a moment and try again."
                : "Sign in failed. Please try again.",
          );
        }
      },
      signOutUser: async () => {
        await signOut(getFirebaseAuth());
        setAccount(null);
      },
    };
  }, [firebaseUser, account, loading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
