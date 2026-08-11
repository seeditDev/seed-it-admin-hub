/**
 * Firestore service for the coding challenge bank.
 * Collection: codingChallenges/{challengeId}
 *
 * Per v2 schema: meta stored in Firestore, full problem content
 * (description, test cases, boilerplates) optionally on CDN.
 * For admin-side bank browsing we read from Firestore directly.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where,
  orderBy,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { CodingChallenge, Difficulty } from "@/types/seedit";

const COL = "codingChallenges";

export interface CodingBankDoc {
  id: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  category: string;
  tags: string[];
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  examples: { input: string; output: string; explanation?: string }[];
  starterCode: Record<string, string>;
  testCases: {
    id: string;
    input: string;
    expectedOutput: string;
    hidden: boolean;
    points: number;
  }[];
  maxScore: number;
  active: boolean;
  /** CDN URL for the full question JSON: seed-contents/coding/questions/{id}.json */
  cdnUrl?: string;
  createdBy?: string;
  createdAt?: unknown;
}

function mapBankDoc(id: string, data: Record<string, unknown>): CodingBankDoc {
  const cdnRaw = data["cdnUrl"] ? String(data["cdnUrl"]) : undefined;
  const createdByRaw = data["createdBy"] ? String(data["createdBy"]) : undefined;
  const createdAtRaw = data["createdAt"] ?? undefined;
  return {
    id,
    title: String(data["title"] ?? ""),
    slug: String(data["slug"] ?? id),
    difficulty: (data["difficulty"] as Difficulty) ?? "medium",
    category: String(data["category"] ?? "General"),
    tags: Array.isArray(data["tags"]) ? (data["tags"] as string[]) : [],
    description: String(data["description"] ?? ""),
    inputFormat: String(data["inputFormat"] ?? ""),
    outputFormat: String(data["outputFormat"] ?? ""),
    constraints: String(data["constraints"] ?? ""),
    examples: Array.isArray(data["examples"]) ? (data["examples"] as CodingBankDoc["examples"]) : [],
    starterCode: (data["starterCode"] as Record<string, string>) ?? {},
    testCases: Array.isArray(data["testCases"]) ? (data["testCases"] as CodingBankDoc["testCases"]) : [],
    maxScore: Number(data["maxScore"] ?? 20),
    active: data["active"] !== false,
    ...(cdnRaw !== undefined ? { cdnUrl: cdnRaw } : {}),
    ...(createdByRaw !== undefined ? { createdBy: createdByRaw } : {}),
    ...(createdAtRaw !== undefined ? { createdAt: createdAtRaw } : {}),
  };
}

/** List all active challenges (for bank browser dialog). */
export async function listCodingChallenges(): Promise<CodingBankDoc[]> {
  const q = query(collection(getDb(), COL), where("active", "==", true), orderBy("title"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => mapBankDoc(d.id, d.data() as Record<string, unknown>));
}

/** Fetch a single challenge by ID. */
export async function getCodingChallenge(id: string): Promise<CodingBankDoc | null> {
  const snap = await getDoc(doc(getDb(), COL, id));
  return snap.exists() ? mapBankDoc(snap.id, snap.data() as Record<string, unknown>) : null;
}

/** Convert a CodingBankDoc to a CodingChallenge (as used in assessment draft). */
export function bankDocToChallenge(d: CodingBankDoc): CodingChallenge {
  return {
    id: d.id,
    title: d.title,
    difficulty: d.difficulty,
    category: d.category,
    statement: d.description,
    inputFormat: d.inputFormat,
    outputFormat: d.outputFormat,
    constraints: d.constraints,
    memoryLimitMb: 256,
    timeLimitSeconds: 2,
    languages: Object.keys(d.starterCode).length > 0 ? (Object.keys(d.starterCode) as CodingChallenge["languages"]) : ["python", "cpp", "java"],
    blockCopyPaste: false,
    fullScreenLock: false,
    testCases: d.testCases,
    isMapped: true,
    ...(d.cdnUrl !== undefined ? { cdnUrl: d.cdnUrl } : {}),
  };
}

/** Write a new challenge to the bank (from Coding Creator manual creation). */
export async function saveCodingChallenge(
  challenge: Omit<CodingBankDoc, "createdAt"> & { createdBy?: string },
): Promise<string> {
  const id = challenge.id || challenge.slug || challenge.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  await setDoc(
    doc(getDb(), COL, id),
    { ...challenge, id, active: true, updatedAt: serverTimestamp() },
    { merge: true },
  );
  return id;
}

/**
 * Bulk-import coding challenges from the seed-contents questions_index.json.
 * This is a one-time migration that loads all existing coding questions into
 * the codingChallenges/ Firestore collection so they appear in the bank browser.
 *
 * CDN URL: https://raw.githubusercontent.com/seeditDev/seed-contents/main/coding/questions_index.json
 *
 * @param onProgress - called after each batch with (saved, total)
 */
export async function bulkImportFromQuestionsIndex(
  onProgress?: (saved: number, total: number) => void,
): Promise<number> {
  const CDN_URL =
    "https://raw.githubusercontent.com/seeditDev/seed-contents/main/coding/questions_index.json";

  const res = await fetch(`${CDN_URL}?_t=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to fetch questions_index.json: ${res.status}`);
  const raw = (await res.json()) as unknown;

  // questions_index.json can be an array or an object with a questions key
  let questions: Record<string, unknown>[];
  if (Array.isArray(raw)) {
    questions = raw as Record<string, unknown>[];
  } else if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>)["questions"])) {
    questions = (raw as Record<string, unknown>)["questions"] as Record<string, unknown>[];
  } else {
    // Try as an object map { id: questionDoc }
    questions = Object.entries(raw as Record<string, unknown>).map(([key, val]) => ({
      id: key,
      ...((val as Record<string, unknown>) ?? {}),
    }));
  }

  const total = questions.length;
  let saved = 0;

  // Process in batches of 20 (Firestore writeBatch limit is 500 but we batch conservatively)
  const BATCH_SIZE = 20;
  const { writeBatch } = await import("firebase/firestore");
  const { getDb: db } = await import("@/lib/firebase");

  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const batch = writeBatch(db());
    const chunk = questions.slice(i, i + BATCH_SIZE);

    chunk.forEach((q) => {
      const id = String(q["id"] ?? q["questionId"] ?? q["_id"] ?? `q_${i}`);
      const ref = doc(db(), COL, id);
      // Canonical CDN path for this question's full JSON
      const cdnUrl = String(q["cdnUrl"] ?? `https://raw.githubusercontent.com/seeditDev/seed-contents/main/coding/questions/${id}.json`);
      batch.set(
        ref,
        {
          id,
          title: String(q["title"] ?? q["name"] ?? id),
          slug: id,
          difficulty: (q["difficulty"] as string) ?? "medium",
          category: String(q["category"] ?? q["topic"] ?? "General"),
          tags: Array.isArray(q["tags"]) ? q["tags"] : [],
          description: String(q["description"] ?? q["statement"] ?? q["problem"] ?? ""),
          inputFormat: String(q["inputFormat"] ?? q["input_format"] ?? ""),
          outputFormat: String(q["outputFormat"] ?? q["output_format"] ?? ""),
          constraints: String(q["constraints"] ?? ""),
          examples: Array.isArray(q["examples"]) ? q["examples"] : [],
          starterCode: (q["starterCode"] as Record<string, string>) ?? {},
          testCases: Array.isArray(q["testCases"])
            ? q["testCases"]
            : Array.isArray(q["test_cases"])
              ? q["test_cases"]
              : [],
          maxScore: Number(q["maxScore"] ?? q["max_score"] ?? 20),
          active: true,
          cdnUrl,
          importedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    });

    await batch.commit();
    saved += chunk.length;
    onProgress?.(saved, total);
  }

  return saved;
}

