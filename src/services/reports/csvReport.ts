/**
 * ─── SEED-IT CSV Report Engine (Marks Report) ────────────────────────────────
 *
 * Generates a UTF-8 BOM prefixed CSV from normalized results.
 * S.No is included as the first column.
 * Filename format: CollegeName-AssessmentName-Date.csv
 */

import type { NormalizedResult } from "./reportTypes";
import {
  formatHrMinSec,
  formatYear,
  formatTime,
  formatDateDisplay,
  safeFilename,
} from "./reportNormalizer";

function escCsv(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsvRows(results: NormalizedResult[]): { headers: string[]; rows: string[][] } {
  if (!results.length) return { headers: [], rows: [] };

  // Discover all section names and coding Q labels across all results
  const allSectionNames = new Set<string>();
  const allCodingLabels = new Set<string>();
  for (const r of results) {
    for (const sec of r.sections) allSectionNames.add(sec.name);
    for (const c of r.codingSubmissions) allCodingLabels.add(`Q${c.questionNumber} (${c.problemTitle})`);
  }
  const sectionNames = [...allSectionNames];
  const codingLabels = [...allCodingLabels];

  const isSpoken = results.some((r) => /spoken_english|speech|sea/i.test(r.assessmentType));

  const headers: string[] = [
    "S.No",
    "Candidate ID / Roll No",
    "Student Name",
    "Email",
    "College",
    "Department",
    "Year",
    "Test Name",
    "Test ID",
    "Test Type",
    "Start Time",
    "End Time",
    "Time Taken",
    "Violations",
    "Auto Submitted",
    "Overall Score",
    "Total Marks",
    "Overall Percentage (%)",
    "Partial Score",
    "Full Score",
    "Status",
    "Insight",
    "Category",
  ];

  // Section column headers
  for (const n of sectionNames) {
    const isSpokenSec = /spoken|speech|communication|sea/i.test(n);
    headers.push(`${n} - Marks Obtained`, `${n} - Total Marks`, `${n} - Section %`, `${n} - Time Taken`);
    if (isSpokenSec) headers.push(`${n} - CEFR Level`, `${n} - WPM`, `${n} - Fillers`);
  }

  // SEA top-level
  if (isSpoken) {
    headers.push("CEFR Level", "CEFR Name", "Speaking Pace (WPM)", "Fillers Count");
  }

  // Coding column headers
  for (const lbl of codingLabels) {
    headers.push(`${lbl} - Marks Obtained`, `${lbl} - Total Marks`, `${lbl} - Accuracy (%)`, `${lbl} - Time Taken`);
  }

  headers.push("Submitted Date");

  const rows: string[][] = results.map((r, index) => {
    const row: string[] = [
      String(index + 1),
      r.rollNumber,
      r.name,
      r.email,
      r.college,
      r.department,
      formatYear(r.year),
      r.testName,
      r.testId,
      (r.assessmentType || "mcq").toUpperCase(),
      r.startedAt ? formatTime(r.startedAt) : "—",
      r.submittedAt ? formatTime(r.submittedAt) : "—",
      formatHrMinSec(r.timeTakenSeconds),
      String(r.violationCount),
      r.autoSubmitted ? "Yes" : "No",
      String(r.score),
      String(r.totalMarks),
      String(Math.round(r.percentage * 10) / 10),
      String(r.partialScore),
      r.fullScore > 0 ? String(r.fullScore) : "—",
      r.status,
      r.insight,
      r.category,
    ];

    // Section values
    for (const n of sectionNames) {
      const isSpokenSec = /spoken|speech|communication|sea/i.test(n);
      const sec = r.sections.find((s) => s.name === n);
      row.push(
        sec ? String(sec.score) : "—",
        sec ? String(sec.totalMarks) : "—",
        sec ? `${sec.percentage}%` : "—",
        sec ? sec.timeTaken : "—",
      );
      if (isSpokenSec) {
        row.push(sec?.cefrLevel ?? r.cefrLevel ?? "—", String(sec?.wpm ?? r.wpm ?? "—"), String(sec?.fillerCount ?? r.fillerCount ?? "—"));
      }
    }

    // SEA top-level
    if (isSpoken) {
      row.push(r.cefrLevel || "—", r.cefrName || "—", String(r.wpm || "—"), String(r.fillerCount ?? "—"));
    }

    // Coding values
    for (const lbl of codingLabels) {
      const qNum = parseInt(lbl.replace(/^Q(\d+).*/, "$1"), 10);
      const c = r.codingSubmissions.find((sub) => sub.questionNumber === qNum);
      if (c?.attempted) {
        row.push(String(c.score), String(c.maxMarks), `${c.accuracy}%`, c.timeTaken);
      } else {
        row.push("Did Not Attempt", "Did Not Attempt", "Did Not Attempt", "Did Not Attempt");
      }
    }

    row.push(formatDateDisplay(r.submittedAtDate));
    return row;
  });

  return { headers, rows };
}

export function buildCsvContent(results: NormalizedResult[]): string {
  const { headers, rows } = buildCsvRows(results);
  const lines = [headers, ...rows].map((r) => r.map(escCsv).join(","));
  return "\uFEFF" + lines.join("\r\n"); // UTF-8 BOM
}

export function buildMarksReportFilename(
  filters: { testName?: string; college?: string; year?: string },
  results: NormalizedResult[],
): string {
  const college  = safeFilename(filters.college  || results[0]?.college  || "College");
  const testName = safeFilename(filters.testName || results[0]?.testName || "Assessment");
  const dateStr  = new Date().toISOString().slice(0, 10);
  return `${college}-${testName}-Marks_Report-${dateStr}.csv`;
}

export function generateCsv(
  results: NormalizedResult[],
  filters: { testName?: string; college?: string; year?: string } = {},
): void {
  if (!results.length) return;

  const csv = buildCsvContent(results);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: buildMarksReportFilename(filters, results) });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
