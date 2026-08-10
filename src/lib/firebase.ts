import { initializeApp, getApp, getApps, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyANO2d-RUXV0x5fvTjRT1UkpssP-T_Qz1Q",
  authDomain: "daily-tracker-a4092.firebaseapp.com",
  projectId: "daily-tracker-a4092",
  storageBucket: "daily-tracker-a4092.firebasestorage.app",
  messagingSenderId: "1023352927583",
  appId: "1:1023352927583:web:2f0234b40a448390b6b2ea",
  measurementId: "G-G9GDW34WTS",
};

const PRIMARY = "[DEFAULT]";
const SECONDARY = "SecondaryAuthApp";

/** Lazily initialise the primary app so module import never runs during SSR side effects. */
export function getFirebaseApp(): FirebaseApp {
  return getApps().some((a) => a.name === PRIMARY) ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}

/**
 * Isolated secondary app used ONLY for provisioning student/staff credentials.
 * Creating users on the primary auth instance would swap the admin's session.
 */
export function getSecondaryApp(): FirebaseApp {
  const existing = getApps().find((a) => a.name === SECONDARY);
  return existing ?? initializeApp(firebaseConfig, SECONDARY);
}

export function getSecondaryAuth(): Auth {
  return getAuth(getSecondaryApp());
}

/** Sign out + tear down the secondary app once a provisioning batch is done. */
export async function releaseSecondaryApp(): Promise<void> {
  const existing = getApps().find((a) => a.name === SECONDARY);
  if (!existing) return;
  try {
    await getAuth(existing).signOut();
  } catch {
    /* already signed out */
  }
  try {
    await deleteApp(existing);
  } catch {
    /* already deleted */
  }
}
