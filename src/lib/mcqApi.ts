/**
 * Direct Supabase MCQ Question Bank client.
 * ──────────────────────────────────────────
 * Bypasses the FastAPI backend entirely — queries the Supabase `prepinsta_questions`
 * table using the publishable anon key directly from the browser.
 *
 * This works because:
 *  - The anon key is safe to expose in the browser (it's the "publishable" key)
 *  - Row Level Security in Supabase controls what data is accessible
 *  - For the admin (read-only browse + write custom question), the anon key is sufficient
 *
 * Supabase config is read from:
 *   VITE_SUPABASE_URL  or  REACT_APP_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY  or  REACT_APP_SUPABASE_ANON_KEY
 */

const env = ((import.meta as unknown) as { env?: Record<string, string> }).env ?? {};

const SUPABASE_URL =
  env["VITE_SUPABASE_URL"] ??
  env["REACT_APP_SUPABASE_URL"] ??
  "https://iygqntndsgiysvibqjyw.supabase.co";

const SUPABASE_ANON_KEY =
  env["VITE_SUPABASE_ANON_KEY"] ??
  env["REACT_APP_SUPABASE_ANON_KEY"] ??
  "";

const REST = `${SUPABASE_URL}/rest/v1`;

function supabaseHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function supabaseFetch<T>(
  path: string,
  init?: RequestInit & { count?: boolean },
): Promise<{ data: T; count?: number }> {
  const headers: Record<string, string> = {
    ...(supabaseHeaders() as Record<string, string>),
    ...(init?.count ? { Prefer: "count=exact" } : {}),
  };
  const res = await fetch(`${REST}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const data = (await res.json()) as T;
  const countRaw = res.headers.get("Content-Range")?.split("/")?.[1];
  const countVal = countRaw ? Number(countRaw) : undefined;
  return { data, ...(countVal !== undefined ? { count: countVal } : {}) };
}

/* ─────────────────────────── Types ─────────────────────────── */

export interface PrepinstaQuestion {
  question_number: number;
  question_text: string;
  correct_option: "A" | "B" | "C" | "D";
  options: { option: string; text: string }[];
  images: string[];
  difficulty: string;
  company: string;
  category: string;
  topic: string;
  explanation?: string;
}

export interface PrepinstaMetadata {
  topics: string[];
  companies: string[];
}

export interface McqBankParams {
  page?: number;
  page_size?: number;
  search?: string;
  category?: string;
  difficulty?: string;
  topic?: string;
  company?: string;
}

/* Table name used in Supabase — adjust if different */
const TABLE = "prepinsta_questions";

export const mcqApi = {
  /**
   * Paginated + filterable question bank.
   * Queries Supabase REST API directly — no backend auth required.
   */
  getPrepinstaQuestions: async (
    params: McqBankParams = {},
  ): Promise<{ success: boolean; data: PrepinstaQuestion[]; total: number }> => {
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Build filter query string
    let path = `/${TABLE}?select=*&order=question_number.asc`;
    path += `&offset=${from}&limit=${pageSize}`;

    if (params.search) {
      // Full-text search on question text
      path += `&question_text=ilike.*${encodeURIComponent(params.search)}*`;
    }
    if (params.category) path += `&category=eq.${encodeURIComponent(params.category)}`;
    if (params.difficulty) path += `&difficulty=eq.${encodeURIComponent(params.difficulty)}`;
    if (params.topic) path += `&topic=eq.${encodeURIComponent(params.topic)}`;
    if (params.company) path += `&company=eq.${encodeURIComponent(params.company)}`;

    const { data, count } = await supabaseFetch<PrepinstaQuestion[]>(path, { count: true });
    return { success: true, data, total: count ?? data.length };
  },

  /** Distinct topics and companies for filter dropdowns. */
  getPrepinstaMetadata: async (): Promise<PrepinstaMetadata> => {
    const [topicRes, companyRes] = await Promise.all([
      supabaseFetch<{ topic: string }[]>(`/${TABLE}?select=topic&order=topic.asc`),
      supabaseFetch<{ company: string }[]>(`/${TABLE}?select=company&order=company.asc`),
    ]);
    const topics = [...new Set(topicRes.data.map((r) => r.topic).filter(Boolean))];
    const companies = [...new Set(companyRes.data.map((r) => r.company).filter(Boolean))];
    return { topics, companies };
  },

  /**
   * Save a custom question to Supabase.
   * Uses anon key — make sure your Supabase RLS allows anon inserts on prepinsta_questions,
   * or swap to a service-role key stored in a backend function.
   */
  createCustomQuestion: async (data: {
    question_text: string;
    correct_option: string;
    options: { option: string; text: string }[];
    difficulty: string;
    category: string;
    topic: string;
    company: string;
  }): Promise<{ success: boolean; question_number: number }> => {
    const payload = {
      question_text: data.question_text,
      correct_option: data.correct_option,
      // Store options as JSONB (adjust column name if needed)
      options: data.options,
      difficulty: data.difficulty,
      category: data.category,
      topic: data.topic,
      company: data.company,
      images: [],
    };
    const { data: created } = await supabaseFetch<PrepinstaQuestion[]>(`/${TABLE}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const q = created[0];
    if (!q) throw new Error("Question was not created — check Supabase RLS policies.");
    return { success: true, question_number: q.question_number };
  },
};
