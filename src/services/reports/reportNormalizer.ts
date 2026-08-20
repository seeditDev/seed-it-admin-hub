/**
 * ─── SEED-IT Report Normalizer ────────────────────────────────────────────────
 *
 * Converts a raw Admin Hub ResultRow (plus optional full Firestore document data)
 * into the stable NormalizedResult model used by all exporters.
 *
 * ALL helpers are exported so Excel, CSV, and PDF share identical logic.
 */

import type { ResultRow } from "@/lib/firestore/results";
import type {
  NormalizedResult,
  NormalizedSection,
  NormalizedQuestion,
  NormalizedCodingSubmission,
  TagStat,
} from "./reportTypes";

// ── PDF Sanitization ──────────────────────────────────────────────────────────

export function sanitizePDFText(str: unknown): string {
  if (!str) return "";
  return String(str)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'").replace(/&rdquo;/g, '"').replace(/&ldquo;/g, '"')
    .replace(/&ndash;/g, "-").replace(/&mdash;/g, "-")
    .replace(/â€™/g, "'").replace(/â€˜/g, "'").replace(/â€œ/g, '"').replace(/â€/g, '"')
    .replace(/â€"/g, "-").replace(/â€"/g, "-")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "$1/$2")
    .replace(/\\sqrt\{([^}]+)\}/g, "sqrt($1)")
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, "$1").replace(/\\[a-zA-Z]+/g, "")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u20B9/g, "Rs.")
    .replace(/[\u2713\u2714]/g, "[OK]")
    .replace(/[\u2717\u2718]/g, "[X]")
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x20-\x7E\t\n]/g, "")
    .trim();
}

// ── Timestamp Normalizer ──────────────────────────────────────────────────────

export function parseTimestamp(val: unknown, fallback = ""): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "string") return val;
  if (typeof val === "number") return new Date(val).toISOString();
  const ts = val as Record<string, unknown>;
  if (typeof ts["toDate"] === "function") {
    try { return (ts["toDate"] as () => Date)().toISOString(); } catch (_) { /* noop */ }
  }
  if (typeof ts["seconds"] === "number") {
    try { return new Date((ts["seconds"] as number) * 1000).toISOString(); } catch (_) { /* noop */ }
  }
  if (typeof ts["_seconds"] === "number") {
    try { return new Date((ts["_seconds"] as number) * 1000).toISOString(); } catch (_) { /* noop */ }
  }
  return fallback;
}

export function toDateSafe(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  const str = parseTimestamp(val, "");
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateDisplay(val: unknown, fallback = "—"): string {
  if (!val) return fallback;
  const d = toDateSafe(val);
  if (!d) return fallback;
  return d.toLocaleDateString("en-IN");
}

export function formatTime(val: unknown): string {
  if (!val) return "—";
  const d = toDateSafe(val);
  if (!d) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// ── Duration Formatter ────────────────────────────────────────────────────────

export function formatHrMinSec(secInput: unknown): string {
  if (secInput === undefined || secInput === null || secInput === "") return "0s";
  if (typeof secInput === "string") {
    const trimmed = secInput.trim();
    if (trimmed === "" || trimmed === "—" || trimmed === "N/A") return "0s";
    if (trimmed.includes("s") || trimmed.includes("m") || trimmed.includes(":") || trimmed.includes("hr"))
      return trimmed;
  }
  const secNum = Number(secInput) || 0;
  if (secNum === 0) return "0s";
  const hrs = Math.floor(secNum / 3600);
  const mins = Math.floor((secNum % 3600) / 60);
  const secs = Math.floor(secNum % 60);
  const parts: string[] = [];
  if (hrs > 0) parts.push(`${hrs} hr${hrs > 1 ? "s" : ""}`);
  if (mins > 0) parts.push(`${mins} min${mins > 1 ? "s" : ""}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} sec${secs !== 1 ? "s" : ""}`);
  return parts.join(" ");
}

export function getQuestionTimeTaken(q: Record<string, unknown>): string {
  if (!q) return "Did Not Attempt";
  const t =
    q["timeTaken"] !== undefined ? q["timeTaken"] :
    q["timeSpent"] !== undefined ? q["timeSpent"] :
    q["duration"] !== undefined ? q["duration"] :
    q["timeTakenSeconds"] !== undefined ? q["timeTakenSeconds"] :
    q["time_taken"] !== undefined ? q["time_taken"] :
    q["time"] !== undefined ? q["time"] :
    q["elapsedTime"] !== undefined ? q["elapsedTime"] : 0;
  return formatHrMinSec(t);
}

// ── Year Formatter ────────────────────────────────────────────────────────────

export function formatYear(yearVal: unknown): string {
  if (!yearVal || yearVal === "All") return String(yearVal || "N/A");
  const str = String(yearVal).trim().toUpperCase();
  if (/^2K\d{2}$/.test(str)) return str;
  if (/^20\d{2}$/.test(str)) return `2K${str.slice(2)}`;
  const m20 = str.match(/20(\d{2})/);
  if (m20) return `2K${m20[1]}`;
  const m2k = str.match(/2K(\d{2})/);
  if (m2k) return `2K${m2k[1]}`;
  if (str === "IV" || str === "4" || str === "4TH" || str === "FINAL" || str === "FOURTH") return "2K27";
  if (str === "III" || str === "3" || str === "3RD" || str === "THIRD") return "2K28";
  if (str === "II" || str === "2" || str === "2ND" || str === "SECOND") return "2K29";
  if (str === "I" || str === "1" || str === "1ST" || str === "FIRST") return "2K30";
  return str;
}

// ── Percentage Normalizer ─────────────────────────────────────────────────────

export function normalizePercentage(pct: unknown, score: unknown, total: unknown): number {
  const p = Number(pct);
  if (!isNaN(p) && p > 1) return Math.min(100, Math.max(0, Math.round(p * 100) / 100));
  if (!isNaN(p) && p >= 0 && p <= 1) return Math.round(p * 10000) / 100; // 0.75 → 75
  const s = Number(score);
  const t = Number(total);
  if (!isNaN(s) && !isNaN(t) && t > 0) return Math.min(100, Math.max(0, Math.round((s / t) * 10000) / 100));
  return 0;
}

// ── Category Helpers ──────────────────────────────────────────────────────────

export function getInsightCategory(pct: number): { insight: string; category: string } {
  const p = Number(pct) || 0;
  if (p >= 85) return { insight: "Strong Performance", category: "Best" };
  if (p >= 70) return { insight: "Good to go", category: "Good" };
  if (p >= 55) return { insight: "Average Performance", category: "Average" };
  if (p >= 40) return { insight: "Needs Practice", category: "Average" };
  return { insight: "Need Attention", category: "Poor" };
}

export function getReadinessCategory(pct: number): { category: string; pkg: string } {
  const p = Number(pct) || 0;
  if (p >= 85) return { category: "Placement Ready - Elite", pkg: "High chance of cracking Rs.10L+ packages (TCS Digital, Infosys SP, Wipro Elite)" };
  if (p >= 70) return { category: "Placement Ready", pkg: "Well-positioned for Rs.4-8L packages (TCS, Infosys, Wipro, CTS)" };
  if (p >= 55) return { category: "Near Placement Ready", pkg: "Needs focused prep in weak areas; can crack 3-5L packages" };
  if (p >= 40) return { category: "Developing", pkg: "Requires significant improvement; focus on fundamentals" };
  return { category: "Needs Intervention", pkg: "Immediate academic support recommended" };
}

// ── Sections Normalizer ───────────────────────────────────────────────────────

export function normalizeSections(raw: unknown): NormalizedSection[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw && typeof raw === "object") {
    arr = Object.values(raw as Record<string, unknown>);
  }
  return arr
    .filter(Boolean)
    .map((sec) => {
      const s = sec as Record<string, unknown>;
      const name = String(s["name"] ?? s["sectionName"] ?? "Section");
      const score = Number(s["score"] ?? (s["data"] as Record<string, unknown>)?.["score"] ?? 0);
      const totalMarks = Number(
        s["totalMarks"] ?? s["maxScore"] ??
        (s["data"] as Record<string, unknown>)?.["totalMarks"] ??
        (s["data"] as Record<string, unknown>)?.["totalQuestions"] ?? 0
      );
      const pct = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;
      const timeSec = Number(s["timeTaken"] ?? s["timeSpent"] ?? 0);
      return {
        name,
        score,
        totalMarks,
        percentage: pct,
        timeTaken: formatHrMinSec(timeSec),
        timeTakenSeconds: timeSec,
        status: (score >= totalMarks * 0.5 ? "Pass" : "Fail") as "Pass" | "Fail",
        cefrLevel: s["cefrLevel"] ? String(s["cefrLevel"]) : undefined,
        wpm: s["wpm"] ? Number(s["wpm"]) : undefined,
        fillerCount: s["fillerCount"] !== undefined ? Number(s["fillerCount"]) : undefined,
      };
    });
}

// ── Questions Normalizer ──────────────────────────────────────────────────────

export function normalizeQuestions(raw: unknown): NormalizedQuestion[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((q, idx) => {
    const isCorrect = !!(q["isCorrect"] || q["correct"] ||
      (q["selectedAnswer"] && q["selectedAnswer"] === q["correctAnswer"]));
    const tags = Array.isArray(q["tags"]) ? (q["tags"] as string[]) : (q["topic"] ? [String(q["topic"])] : ["General"]);
    const timeSec = Number(
      q["timeTaken"] ?? q["timeSpent"] ?? q["duration"] ??
      q["timeTakenSeconds"] ?? q["time"] ?? q["elapsedTime"] ?? 0
    );
    return {
      index: idx + 1,
      questionText: sanitizePDFText(q["questionText"] ?? q["question"] ?? "Question"),
      topic: sanitizePDFText(tags[0] ?? "General"),
      tags,
      isCorrect,
      selectedAnswer: sanitizePDFText(q["selectedAnswer"] ?? q["answer"] ?? "N/A"),
      correctAnswer: sanitizePDFText(q["correctAnswer"] ?? ""),
      timeTakenSeconds: timeSec,
      timeTaken: formatHrMinSec(timeSec),
      difficulty: String(q["difficulty"] ?? "Medium"),
      marks: Number(q["marks"] ?? q["score"] ?? 1),
    };
  });
}

// ── Coding Submissions Normalizer ─────────────────────────────────────────────

export function extractCodingSubmissions(rawResult: Record<string, unknown>): unknown[] {
  const sources = [
    rawResult["codingSubmissions"],
    rawResult["coding"],
    rawResult["codingResults"],
  ];
  for (const src of sources) {
    if (Array.isArray(src) && (src as unknown[]).length > 0) return src as unknown[];
  }
  const allQs = rawResult["questions"] ?? rawResult["answers"];
  if (Array.isArray(allQs)) {
    const codingQs = (allQs as Record<string, unknown>[]).filter(
      (q) => q["type"] === "coding" || q["code"] || q["submittedCode"] || q["solutionCode"] || q["solution"]
    );
    if (codingQs.length > 0) return codingQs;
  }
  return [];
}

export function normalizeCodingSubmissions(
  raw: unknown[],
  codingSecTotalMarks = 40
): NormalizedCodingSubmission[] {
  const defaultQMax = Math.max(1, Math.round(codingSecTotalMarks / Math.max(1, raw.length || 1)));
  return (raw as Record<string, unknown>[]).map((c, idx) => {
    const qNum = Number(c["questionNumber"] ?? idx + 1);
    const isAttempted = !!(
      c["submitted"] || c["code"] || c["testsPassed"] !== undefined ||
      c["score"] !== undefined || c["timeTaken"] || c["timeSpent"]
    );

    let maxMarks = Number(c["totalMarks"] ?? c["maxMarks"] ?? 0);
    if (maxMarks <= 0 || maxMarks >= codingSecTotalMarks) maxMarks = defaultQMax;

    let score = 0;
    const testsPassed = Number(c["testsPassed"] ?? 0);
    const totalTests = Number(c["totalTests"] ?? 0);
    if (isAttempted) {
      if (totalTests > 0) {
        score = Math.round((testsPassed / totalTests) * maxMarks);
      } else if (typeof c["score"] === "number") {
        score = Math.min(c["score"] as number, maxMarks);
      } else if (typeof c["marks"] === "number") {
        score = Math.min(c["marks"] as number, maxMarks);
      }
    }

    const accuracy = totalTests > 0
      ? Math.round((testsPassed / totalTests) * 100)
      : (maxMarks > 0 ? Math.round((score / maxMarks) * 100) : 0);

    const timeSec = Number(
      c["timeTaken"] ?? c["timeSpent"] ?? c["duration"] ??
      c["timeTakenSeconds"] ?? c["time"] ?? c["elapsedTime"] ?? 0
    );

    return {
      questionNumber: qNum,
      problemTitle: sanitizePDFText(c["problemTitle"] ?? c["title"] ?? `Problem ${qNum}`),
      language: String(c["language"] ?? "N/A"),
      timeComplexity: String(c["timeComplexity"] ?? "N/A"),
      spaceComplexity: String(c["spaceComplexity"] ?? "N/A"),
      testsPassed,
      totalTests,
      score,
      maxMarks,
      accuracy,
      timeTakenSeconds: timeSec,
      timeTaken: formatHrMinSec(timeSec),
      difficulty: String(c["difficulty"] ?? "Medium"),
      attempted: isAttempted,
      code: String(c["code"] ?? c["solutionCode"] ?? c["submittedCode"] ?? c["solution"] ?? ""),
      submittedAt: c["submittedAt"] ? Number(c["submittedAt"]) : undefined,
    };
  });
}

// ── Strength / Weakness Analysis ──────────────────────────────────────────────

export function buildTagStats(questions: NormalizedQuestion[]): TagStat[] {
  const map = new Map<string, { correct: number; total: number; timeSpent: number }>();
  for (const q of questions) {
    const tags = q.tags.length > 0 ? q.tags : ["General"];
    for (const tag of tags) {
      if (!tag) continue;
      const clean = sanitizePDFText(tag);
      if (!clean) continue;
      const cur = map.get(clean) ?? { correct: 0, total: 0, timeSpent: 0 };
      cur.total++;
      if (q.isCorrect) cur.correct++;
      cur.timeSpent += q.timeTakenSeconds;
      map.set(clean, cur);
    }
  }
  return [...map.entries()]
    .map(([tag, s]) => ({
      tag,
      correct: s.correct,
      total: s.total,
      accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
      avgTimeSeconds: s.total > 0 ? Math.round(s.timeSpent / s.total) : 0,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
}

// ── Recommendation Engine ─────────────────────────────────────────────────────

export function getRecommendations(
  pct: number,
  tagStats: TagStat[],
  codingSubmissions: NormalizedCodingSubmission[]
): string[] {
  const recs: string[] = [];
  const strengths = tagStats.filter((t) => t.accuracy >= 70);
  const needsWork = tagStats.filter((t) => t.accuracy < 50);

  if (pct < 50) recs.push("Focus on fundamentals – revisit core concepts in weak topics");
  if (pct >= 50 && pct < 70) recs.push("Target 70%+ by practicing topic-specific mock tests");
  if (needsWork.length > 0) recs.push(`Priority topics: ${needsWork.slice(0, 3).map((t) => t.tag).join(", ")}`);
  if (strengths.length > 0) recs.push(`Build on strengths: ${strengths.slice(0, 2).map((t) => t.tag).join(", ")}`);
  if (pct >= 70) recs.push("Start applying to companies – profile is competitive");
  if (codingSubmissions.length > 0)
    recs.push(`Practice more ${codingSubmissions[0]?.language || "coding"} problems with optimized solutions`);
  if (recs.length === 0) recs.push("Continue current preparation strategy – performance is on track");
  return recs.slice(0, 4);
}

// ── Safe filename sanitizer ───────────────────────────────────────────────────

export function safeFilename(s: string): string {
  return (s || "").replace(/[/\\?%*:|"<>]/g, "_");
}

// ── Main Normalizer ───────────────────────────────────────────────────────────

/**
 * Converts a ResultRow (from Firestore results service) into a NormalizedResult.
 * Optionally accepts a full raw Firestore document (rawDoc) for PDFs that need
 * sections / questions / codingSubmissions.
 *
 * @param row       - ResultRow from listResults / listResultsByTenant
 * @param tenantMap - Map<tenantId, tenantName> for college name resolution
 * @param rawDoc    - Optional full Firestore document data for detail exports
 * @param passThreshold - Pass/fail threshold % (default 40, matching Admin Hub)
 */
export function normalizeReportResult(
  row: ResultRow,
  tenantMap: Map<string, string>,
  rawDoc?: Record<string, unknown>,
  passThreshold = 40,
): NormalizedResult {
  const college = tenantMap.get(row.tenantId) ?? row.tenantId ?? "N/A";
  const year = formatYear(row.year || row.cohortId);

  // Percentage — ResultRow already normalizes, but defend against legacy 0–1
  const pct = normalizePercentage(row.percentage, row.totalScore, row.maxScore);
  const passed = pct >= passThreshold;

  // Time
  const timeSec = row.timeTakenSeconds ?? 0;
  const timeTaken = formatHrMinSec(timeSec);

  // Timestamps
  const submittedAtDate = row.submittedAt ?? (rawDoc ? toDateSafe(rawDoc["submittedAt"] ?? rawDoc["submittedAtISO"] ?? rawDoc["completedAt"] ?? rawDoc["completedAtISO"] ?? rawDoc["timeCompleted"]) : null);
  const submittedAt = submittedAtDate ? submittedAtDate.toISOString() : "";
  const startedAt = rawDoc
    ? parseTimestamp(rawDoc["startedAt"] ?? rawDoc["startedAtISO"] ?? rawDoc["timeStartedISO"] ?? rawDoc["timeStarted"] ?? rawDoc["startTimeISO"] ?? rawDoc["startTime"] ?? rawDoc["started_at"])
    : (row.startedAt ? row.startedAt.toISOString() : "");

  // Categories
  const ic = getInsightCategory(pct);
  const rc = getReadinessCategory(pct);

  // Detail data — from rawDoc if available, else empty arrays
  const rawSections = rawDoc
    ? (rawDoc["sectionsArray"] ?? rawDoc["sections"] ?? [])
    : [];
  const rawQuestions = rawDoc ? (rawDoc["questions"] ?? rawDoc["answers"] ?? []) : [];
  const rawCoding = rawDoc ? extractCodingSubmissions(rawDoc) : [];
  const codingSecTotalMarks = rawDoc ? Number(rawDoc["totalMarks"] ?? 40) : 40;

  const sections = normalizeSections(rawSections);
  const questions = normalizeQuestions(rawQuestions);
  const codingSubmissions = normalizeCodingSubmissions(rawCoding, codingSecTotalMarks);

  return {
    studentId: row.userId,
    rollNumber: row.rollNumber || "N/A",
    name: row.displayName || row.email || "Student",
    email: row.email,
    college,
    department: row.department || "N/A",
    year,
    tenantId: row.tenantId,

    assessmentId: row.assessmentId,
    testId: row.assessmentId,
    testName: row.assessmentTitle || row.assessmentId || "Assessment",
    assessmentType: row.assessmentType || row.type || "mcq",
    assessmentVersion: row.assessmentVersion ?? 1,

    startedAt,
    submittedAt,
    submittedAtDate,
    timeTaken,
    timeTakenSeconds: timeSec,

    score: row.totalScore ?? 0,
    totalMarks: row.maxScore ?? 0,
    percentage: pct,
    partialScore: rawDoc ? Number(rawDoc["partialScore"] ?? rawDoc["partial_score"] ?? row.totalScore ?? 0) : (row.totalScore ?? 0),
    fullScore: rawDoc ? Number(rawDoc["fullScore"] ?? rawDoc["full_score"] ?? 0) : 0,
    correctAnswers: rawDoc ? Number(rawDoc["correctAnswers"] ?? rawDoc["correct_answers"] ?? 0) : 0,
    totalQuestions: rawDoc ? Number(rawDoc["totalQuestions"] ?? rawDoc["total_questions"] ?? 0) : 0,
    initialScore: rawDoc ? String(rawDoc["initialScore"] ?? rawDoc["initial_score"] ?? "") : "",

    status: passed ? "PASS" : "FAIL",
    passed,

    violationCount: row.violations ?? 0,
    violationTime: rawDoc ? String(rawDoc["violationTime"] ?? rawDoc["violation_time"] ?? "") : "",
    autoSubmitted: rawDoc ? Boolean(rawDoc["autoSubmitted"] ?? rawDoc["auto_submitted"] ?? false) : false,

    insight: ic.insight,
    category: ic.category,
    readinessCategory: rc.category,
    readinessPkg: rc.pkg,

    sections,
    questions,
    codingSubmissions,

    cefrLevel: rawDoc ? String(rawDoc["cefrLevel"] ?? "B2") : "B2",
    cefrName: rawDoc ? String(rawDoc["cefrName"] ?? "Vantage / Upper Intermediate") : "Vantage / Upper Intermediate",
    wpm: rawDoc ? Number(rawDoc["wpm"] ?? 0) : 0,
    fillerCount: rawDoc ? Number(rawDoc["fillerCount"] ?? 0) : 0,
  };
}

/** Batch-normalize an array of ResultRows without raw docs (for overview/analytics).*/
export function normalizeResults(
  rows: ResultRow[],
  tenantMap: Map<string, string>,
  passThreshold = 40,
): NormalizedResult[] {
  return rows.map((r) => normalizeReportResult(r, tenantMap, undefined, passThreshold));
}
