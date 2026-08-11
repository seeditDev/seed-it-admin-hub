/**
 * seed-contents GitHub API service
 * ─────────────────────────────────
 * Writes assessment JSON files to seeditDev/seed-contents repo via GitHub Contents API.
 * The PAT is read from VITE_GITHUB_PAT environment variable.
 *
 * Folder conventions (same as old admin):
 *   MCQ assessments   →  mcq/testbank/{slug}.json
 *   Coding assessments→  coding/testbank/{slug}.json
 *   SEA assessments   →  spoken_english/{slug}.json
 *   MCQ questions     →  mcq/questionBank/{id}.json
 *   Coding questions  →  coding/questions/{id}.json
 *
 * CDN base URL (public, no auth needed for reads):
 *   https://raw.githubusercontent.com/seeditDev/seed-contents/main/{path}
 */

const REPO = "seeditDev/seed-contents";
const BRANCH = "main";
const CDN_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const API_BASE = `https://api.github.com/repos/${REPO}/contents`;

function getToken(): string {
  const t = import.meta.env["VITE_GITHUB_PAT"] as string | undefined;
  if (!t) throw new Error("VITE_GITHUB_PAT is not set in .env");
  return t;
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `token ${getToken()}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
}

/** Unicode-safe btoa */
function safeBtoa(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

/** Get the SHA of an existing file (returns null if not found) */
async function getFileSha(path: string): Promise<string | null> {
  const url = `${API_BASE}/${path}?ref=${BRANCH}&_t=${Date.now()}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { sha: string };
  return data.sha;
}

/**
 * Upload (create or update) a file in seed-contents.
 * Returns the CDN URL to the published file.
 */
export async function uploadSeedContent(
  path: string,
  content: string,
  commitMessage: string,
): Promise<string> {
  const sha = await getFileSha(path);
  const body: Record<string, unknown> = {
    message: commitMessage,
    content: safeBtoa(content),
    branch: BRANCH,
  };
  if (sha) body["sha"] = sha;

  const res = await fetch(`${API_BASE}/${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`GitHub upload failed for ${path}: ${err.message ?? res.statusText}`);
  }

  return `${CDN_BASE}/${path}`;
}

/**
 * Delete a file from seed-contents (e.g. when an assessment is deleted).
 * Silently succeeds if file not found.
 */
export async function deleteSeedContent(path: string, commitMessage: string): Promise<void> {
  const sha = await getFileSha(path);
  if (!sha) return; // already gone

  const res = await fetch(`${API_BASE}/${path}`, {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ message: commitMessage, sha, branch: BRANCH }),
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`GitHub delete failed for ${path}: ${res.statusText}`);
  }
}

/**
 * Fetch a file from seed-contents.
 * Strategy:
 *   1. Try raw CDN URL (no auth, fast, cached by GitHub CDN)
 *   2. If CDN fails (network error, 404, blocked), fall back to
 *      GitHub Contents API using VITE_GITHUB_PAT (authenticated read)
 *
 * The fallback is important if:
 *   - The repo is private
 *   - CDN cache hasn't propagated yet after a fresh commit
 *   - Admin is behind a network that blocks raw.githubusercontent.com
 */
export async function fetchSeedContent<T = unknown>(path: string): Promise<T> {
  // 1. Try CDN (public, fast)
  try {
    const res = await fetch(`${CDN_BASE}/${path}?_t=${Date.now()}`);
    if (res.ok) return res.json() as Promise<T>;
  } catch {
    // Network error — fall through to authenticated fetch
  }

  // 2. Fallback: GitHub Contents API (authenticated, decodes base64)
  const apiUrl = `${API_BASE}/${path}`;
  let headers: HeadersInit = { Accept: "application/vnd.github.v3+json" };
  try {
    // Try with auth if PAT is available
    headers = authHeaders();
  } catch {
    // PAT not set — attempt unauthenticated API call (rate-limited)
  }

  const res = await fetch(apiUrl, { headers });
  if (!res.ok) {
    throw new Error(
      `Content not available: CDN and GitHub API both failed for ${path} (${res.status})`,
    );
  }
  const data = (await res.json()) as { content: string; encoding: string };
  if (data.encoding !== "base64") {
    throw new Error(`Unexpected encoding from GitHub API: ${data.encoding}`);
  }
  // Decode the base64 content
  const decoded = decodeURIComponent(
    escape(atob(data.content.replace(/\n/g, ""))),
  );
  return JSON.parse(decoded) as T;
}


/* ─────────────────────── Path helpers ─────────────────────── */

/** Slugify a string for use as a filename */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Returns the seed-contents path and CDN URL for an MCQ assessment */
export function mcqAssessmentPath(id: string, title: string) {
  const slug = slugify(title) || id.toLowerCase();
  const path = `mcq/testbank/${slug}.json`;
  return { path, cdnUrl: `${CDN_BASE}/${path}` };
}

/** Returns the seed-contents path and CDN URL for a Coding assessment */
export function codingAssessmentPath(id: string, title: string) {
  const slug = slugify(title) || id.toLowerCase();
  const path = `coding/testbank/${slug}.json`;
  return { path, cdnUrl: `${CDN_BASE}/${path}` };
}

/** Returns the seed-contents path and CDN URL for a SEA assessment */
export function seaAssessmentPath(id: string, title: string) {
  const slug = slugify(title) || id.toLowerCase();
  const path = `spoken_english/${slug}.json`;
  return { path, cdnUrl: `${CDN_BASE}/${path}` };
}

/** Returns the seed-contents path for an individual MCQ question */
export function mcqQuestionPath(id: string) {
  return `mcq/questionBank/${id}.json`;
}

/** Returns the seed-contents path for an individual coding question */
export function codingQuestionPath(id: string) {
  return `coding/questions/${id}.json`;
}

/** CDN base — export for use in components */
export { CDN_BASE };
