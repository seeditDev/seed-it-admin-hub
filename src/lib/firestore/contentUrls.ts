/**
 * Firestore service: contentUrls/{id}
 * ─────────────────────────────────────
 * A registry of all published assessment CDN URLs.
 * Every time an MCQ, Coding, or SEA assessment is published,
 * a document is written here so the Courses & Assessments page
 * can show a dropdown of available content.
 *
 * Shape:
 *   id           — same as assessments/{id}
 *   title        — human-readable name
 *   type         — "mcq" | "coding" | "sea"
 *   cdnUrl       — raw.githubusercontent.com full URL
 *   slug         — filename portion (e.g. "unit-test-1.json")
 *   totalMarks   — from the assessment
 *   durationMinutes
 *   publishedAt  — server timestamp
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";

const COL = "contentUrls";

export type ContentType = "mcq" | "coding" | "sea";

export interface ContentUrlDoc {
  id: string;
  title: string;
  type: ContentType;
  cdnUrl: string;
  /** Filename portion, e.g. "unit-test-1.json" */
  slug: string;
  totalMarks: number;
  durationMinutes: number;
  publishedAt?: unknown;
}

function mapDoc(id: string, d: Record<string, unknown>): ContentUrlDoc {
  return {
    id,
    title: String(d["title"] ?? id),
    type: (d["type"] as ContentType) ?? "mcq",
    cdnUrl: String(d["cdnUrl"] ?? ""),
    slug: String(d["slug"] ?? ""),
    totalMarks: Number(d["totalMarks"] ?? 0),
    durationMinutes: Number(d["durationMinutes"] ?? 0),
    publishedAt: d["publishedAt"],
  };
}

/** List all published URLs, optionally filtered by type. */
export async function listContentUrls(type?: ContentType): Promise<ContentUrlDoc[]> {
  const q = type
    ? query(collection(getDb(), COL), where("type", "==", type), orderBy("title"))
    : query(collection(getDb(), COL), orderBy("type"), orderBy("title"));

  const snap = await getDocs(q).catch(async () =>
    // Fallback without ordering if index not yet built
    getDocs(
      type
        ? query(collection(getDb(), COL), where("type", "==", type))
        : collection(getDb(), COL),
    ),
  );
  return snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
}

/** Upsert a CDN URL entry (called when an assessment is published). */
export async function upsertContentUrl(input: Omit<ContentUrlDoc, "publishedAt">): Promise<void> {
  const slug = input.cdnUrl.split("/").pop() ?? input.id;
  await setDoc(
    doc(getDb(), COL, input.id),
    {
      ...input,
      slug,
      publishedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** Remove a CDN URL entry (called when an assessment is deleted). */
export async function removeContentUrl(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), COL, id));
}
