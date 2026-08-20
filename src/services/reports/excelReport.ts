/**
 * ─── SEED-IT Excel Report Engine ─────────────────────────────────────────────
 *
 * Uses xlsx-js-style for styled cell output.
 * Three exported functions:
 *   generateMarksExcel()        — global marks report across filtered results
 *   generateAssessmentWorkbook()— per-assessment Summary + Test Results sheets
 *   generateSectionExcel()      — section analysis flat table
 */

import XLSX from "xlsx-js-style";
import type { NormalizedResult, AssessmentGroup } from "./reportTypes";
import {
  formatHrMinSec,
  formatYear,
  formatTime,
  formatDateDisplay,
  getInsightCategory,
  safeFilename,
  getQuestionTimeTaken,
  extractCodingSubmissions,
  normalizeCodingSubmissions,
} from "./reportNormalizer";

// ── Cell Factory ──────────────────────────────────────────────────────────────

interface CellOptions {
  bg?: string;
  fg?: string;
  bold?: boolean;
  fontSize?: number;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  border?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cell(value: unknown, opts: CellOptions = {}): any {
  const { bg = "FFFFFF", fg = "000000", bold = false, fontSize = 10, align = "center", wrap = false, border = true } = opts;
  let v = value;
  if (v === null || v === undefined) v = "—";
  const t = typeof v === "number" ? "n" : "s";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cellObj: any = {
    v,
    t,
    s: {
      font: { name: "Calibri", sz: fontSize, bold, color: { rgb: fg } },
      fill: { fgColor: { rgb: bg } },
      alignment: { horizontal: align, vertical: "center", wrapText: wrap },
    },
  };
  if (border) {
    cellObj.s.border = {
      top: { style: "thin", color: { rgb: "D1D5DB" } },
      bottom: { style: "thin", color: { rgb: "D1D5DB" } },
      left: { style: "thin", color: { rgb: "D1D5DB" } },
      right: { style: "thin", color: { rgb: "D1D5DB" } },
    };
  }
  return cellObj;
}

// Shorthand styled cell factories for Summary sheet
const HMain = (v: string) => cell(v, { bg: "10B981", fg: "FFFFFF", bold: true, fontSize: 13 });
const HSec  = (v: string, bg = "059669") => cell(v, { bg, fg: "FFFFFF", bold: true, fontSize: 11 });
const HDark = (v: string) => cell(v, { bg: "047857", fg: "FFFFFF", bold: true, fontSize: 11 });
const HCol  = (v: string, bg = "10B981") => cell(v, { bg, fg: "FFFFFF", bold: true, fontSize: 10 });
const HKey  = (v: string) => cell(v, { bg: "E6F4EA", fg: "065F46", bold: true, fontSize: 10 });
const CD    = (v: unknown, bg = "FFFFFF", fg = "1F2937", bold = false, fontSize = 10) =>
  cell(v, { bg, fg, bold, fontSize });

// ── Global Marks Excel ────────────────────────────────────────────────────────

export function generateMarksExcel(
  results: NormalizedResult[],
  filters: { testName?: string; college?: string; year?: string } = {}
): void {
  if (!results.length) return;

  const rawRows = results.map((r) => {
    const baseObj: Record<string, unknown> = {
      "Candidate ID / Roll No": r.rollNumber,
      "Student Name": r.name,
      "Email": r.email,
      "College": r.college,
      "Department": r.department,
      "Year": formatYear(r.year),
      "Test Name": r.testName,
      "Test ID": r.testId,
      "Test Type": (r.assessmentType || "mcq").toUpperCase(),
      "Start Time": r.startedAt ? formatTime(r.startedAt) : "—",
      "End Time": r.submittedAt ? formatTime(r.submittedAt) : "—",
      "Time Taken": formatHrMinSec(r.timeTakenSeconds),
      "Switch Count / Violations": r.violationCount,
      "Switch Time / Last Violation": r.violationTime || "—",
      "Auto Submitted": r.autoSubmitted ? "Yes" : "No",
      "Initial Score": r.initialScore || "—",
      "Overall Score": r.score,
      "Total Marks": r.totalMarks,
      "Overall Percentage (%)": Math.round(r.percentage * 10) / 10,
      "Partial Score": r.partialScore,
      "Full Score": r.fullScore || "—",
      "Status": r.status,
      "Insight": r.insight,
      "Category": r.category,
    };

    // Dynamic section columns
    if (r.sections.length > 0) {
      for (const sec of r.sections) {
        const n = sec.name;
        baseObj[`${n} - Marks Obtained`] = sec.score;
        baseObj[`${n} - Total Marks`] = sec.totalMarks;
        baseObj[`${n} - Section %`] = `${sec.percentage}%`;
        baseObj[`${n} - Time Taken`] = sec.timeTaken;
        if (sec.cefrLevel || /spoken|speech|communication|sea/i.test(n)) {
          baseObj[`${n} - CEFR Level`] = sec.cefrLevel ?? r.cefrLevel ?? "—";
          baseObj[`${n} - WPM`] = sec.wpm ?? r.wpm ?? "—";
          baseObj[`${n} - Fillers`] = sec.fillerCount ?? r.fillerCount ?? "—";
        }
      }
    }

    // SEA / spoken
    const isSpoken = /spoken_english|speech|sea/i.test(r.assessmentType);
    if (isSpoken) {
      baseObj["CEFR Level"] = r.cefrLevel || "—";
      baseObj["CEFR Name"] = r.cefrName || "—";
      baseObj["Speaking Pace (WPM)"] = r.wpm || "—";
      baseObj["Fillers Count"] = r.fillerCount ?? "—";
    }

    // Dynamic coding question columns
    if (r.codingSubmissions.length > 0) {
      for (const c of r.codingSubmissions) {
        const qLabel = `Q${c.questionNumber} (${c.problemTitle})`;
        if (!c.attempted) {
          baseObj[`${qLabel} - Marks Obtained`] = "Did Not Attempt";
          baseObj[`${qLabel} - Total Marks`] = "Did Not Attempt";
          baseObj[`${qLabel} - Accuracy (%)`] = "Did Not Attempt";
          baseObj[`${qLabel} - Time Taken`] = "Did Not Attempt";
        } else {
          baseObj[`${qLabel} - Marks Obtained`] = c.score;
          baseObj[`${qLabel} - Total Marks`] = c.maxMarks;
          baseObj[`${qLabel} - Accuracy (%)`] = `${c.accuracy}%`;
          baseObj[`${qLabel} - Time Taken`] = c.timeTaken;
        }
      }
    }

    baseObj["Submitted Date"] = formatDateDisplay(r.submittedAtDate);
    return baseObj;
  });

  const headers = Object.keys(rawRows[0]!);
  const headerRowCells = headers.map((h) => cell(h, { bg: "10B981", fg: "FFFFFF", bold: true, fontSize: 10 }));
  const dataRowCells = rawRows.map((rowObj, rIdx) => {
    const rowBg = rIdx % 2 === 0 ? "FFFFFF" : "F8FAFC";
    return headers.map((h) => {
      const val = rowObj[h];
      if (h === "Status") {
        return cell(val, { bg: val === "PASS" ? "D1FAE5" : "FEE2E2", fg: val === "PASS" ? "065F46" : "991B1B", bold: true });
      }
      if (String(val) === "Did Not Attempt") return cell(val, { bg: "FEF3C7", fg: "92400E" });
      return cell(val, { bg: rowBg });
    });
  });

  const styledAoa = [headerRowCells, ...dataRowCells];
  const ws = XLSX.utils.aoa_to_sheet(styledAoa);
  ws["!cols"] = headers.map((h, ci) => ({
    wch: Math.max(14, h.length + 2, ...dataRowCells.map((r) => String(r[ci]?.v || "").length + 2)),
  }));

  const testName = safeFilename(filters.testName || (results[0]?.testName ?? "All_Assessments"));
  const college  = safeFilename(filters.college  || (results[0]?.college ?? "ALL"));
  const year     = safeFilename(filters.year     || (results[0]?.year ?? "All"));
  const dateStr  = new Date().toISOString().slice(0, 10);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Marks Report");
  XLSX.writeFile(wb, `SEED-${testName}-${college}-${year}-${dateStr}.xlsx`);
}

// ── Assessment Workbook (Summary + Test Results) ──────────────────────────────

export function generateAssessmentWorkbook(group: AssessmentGroup): void {
  if (!group.results.length) return;
  const results = group.results;
  const secs = group.sections;
  const isSpoken = /spoken_english|speech|sea/i.test(group.type);

  // ── Computed stats
  const totalStudents = results.length;
  const avgPct = totalStudents > 0 ? results.reduce((s, r) => s + r.percentage, 0) / totalStudents : 0;
  const highestPct = totalStudents > 0 ? Math.max(...results.map((r) => r.percentage)) : 0;
  const lowestPct  = totalStudents > 0 ? Math.min(...results.map((r) => r.percentage)) : 0;
  const sample = results[0]!;
  const totalMarks = sample.totalMarks || 100;
  const batch = formatYear(sample.year);
  const testDate = sample.submittedAtDate ? sample.submittedAtDate.toDateString() : "—";
  const attendance = `${totalStudents}`;

  const gtkCount = results.filter((r) => r.percentage >= 70).length;
  const niCount  = results.filter((r) => r.percentage >= 50 && r.percentage < 70).length;
  const ntCount  = results.filter((r) => r.percentage < 50).length;

  const sortedDesc = [...results].sort((a, b) => b.percentage - a.percentage);
  const sortedAsc  = [...results].sort((a, b) => a.percentage - b.percentage);
  const topN    = sortedDesc.slice(0, 10);
  const atRiskN = sortedAsc.slice(0, 10);

  const branchMap = new Map<string, { total: number; poor: number; avg: number; good: number; best: number }>();
  for (const r of results) {
    const br = r.department || "Unknown";
    const cur = branchMap.get(br) ?? { total: 0, poor: 0, avg: 0, good: 0, best: 0 };
    cur.total++;
    const p = r.percentage;
    if (p >= 81) cur.best++;
    else if (p >= 61) cur.good++;
    else if (p >= 31) cur.avg++;
    else cur.poor++;
    branchMap.set(br, cur);
  }
  const branches = [...branchMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // ── Summary Sheet AOA ──────────────────────────────────────────────────────
  const summaryAOA: unknown[][] = [];
  const blank12 = () => Array(12).fill(0).map(() => CD("", "FFFFFF", "FFFFFF"));

  summaryAOA.push([HMain("SEED SEB ASSESSMENT ANALYSIS REPORT"), ...Array(11).fill("")]);
  summaryAOA.push([HSec(`${group.testName} — Performance Summary`), ...Array(11).fill("")]);
  summaryAOA.push([HSec("Assessment Details"), "", "", "", "", CD(""), HSec("Attachments"), "", "", "", "", ""]);
  summaryAOA.push([HKey("Test Name:"), CD(group.testName, "FFFFFF", "1F2937", true), HKey("Attendance:"), CD(attendance, "FFFFFF", "1F2937", true), CD(""), CD("Assessment Report", "F0FDF4", "2563EB", true), "", "", "", "", "", ""]);
  summaryAOA.push([HKey("Test Date:"), CD(testDate), HKey("Total Marks:"), CD(totalMarks), CD(""), CD("Answer Key", "F0FDF4", "2563EB", true), "", "", "", "", "", ""]);
  summaryAOA.push([HKey("Batch:"), CD(batch), HKey("Type:"), CD(group.type.toUpperCase()), CD(""), CD(""), "", "", "", "", "", ""]);
  summaryAOA.push(blank12());

  summaryAOA.push([HCol("Total Students"), HCol("Average %"), HCol("Highest %"), HCol("Lowest %"), HCol("Pass (>=70%)"), ...Array(7).fill("")]);
  summaryAOA.push([
    CD(totalStudents, "F0FDF4", "065F46", true),
    CD(`${Math.round(avgPct * 100) / 100}%`, "F0FDF4", "065F46", true),
    CD(`${Math.round(highestPct * 10) / 10}%`, "F0FDF4", "065F46", true),
    CD(`${Math.round(lowestPct * 10) / 10}%`, "F0FDF4", "065F46", true),
    CD(`${gtkCount}`, "F0FDF4", "065F46", true),
    ...Array(7).fill(""),
  ]);
  summaryAOA.push(blank12());

  summaryAOA.push([HCol("Status"), HCol("Count"), HCol("Percentage"), HCol("Criteria"), ...Array(8).fill("")]);
  const gtkPct = totalStudents > 0 ? ((gtkCount / totalStudents) * 100).toFixed(1) + "%" : "0%";
  const niPct  = totalStudents > 0 ? ((niCount  / totalStudents) * 100).toFixed(1) + "%" : "0%";
  const ntPct  = totalStudents > 0 ? ((ntCount  / totalStudents) * 100).toFixed(1) + "%" : "0%";
  summaryAOA.push([CD("Good to Go", "D1FAE5", "065F46", true), CD(gtkCount, "D1FAE5", "065F46", true), CD(gtkPct, "D1FAE5", "065F46", true), CD(">=70%", "D1FAE5", "065F46", true), ...Array(8).fill("")]);
  summaryAOA.push([CD("Needs Improvement", "FEF3C7", "92400E", true), CD(niCount, "FEF3C7", "92400E", true), CD(niPct, "FEF3C7", "92400E", true), CD("50–69%", "FEF3C7", "92400E", true), ...Array(8).fill("")]);
  summaryAOA.push([CD("Needs Training", "FEE2E2", "991B1B", true), CD(ntCount, "FEE2E2", "991B1B", true), CD(ntPct, "FEE2E2", "991B1B", true), CD("<50%", "FEE2E2", "991B1B", true), ...Array(8).fill("")]);
  summaryAOA.push(blank12());

  summaryAOA.push([HDark("Top Performers"), "", "", "", cell("At-Risk Students", { bg: "B91C1C", fg: "FFFFFF", bold: true, fontSize: 11 }), "", "", "", ...Array(4).fill("")]);
  summaryAOA.push([HCol("Rank"), HCol("Name"), HCol("Branch"), HCol("Percentage %"), HCol("Rank", "EF4444"), HCol("Name", "EF4444"), HCol("Branch", "EF4444"), HCol("Percentage %", "EF4444"), ...Array(4).fill("")]);

  for (let i = 0; i < 10; i++) {
    const tp = topN[i];
    const ar = atRiskN[i];
    const tpBg = i % 2 === 0 ? "F9FAFB" : "FFFFFF";
    const arBg = i % 2 === 0 ? "FEF2F2" : "FFFFFF";
    summaryAOA.push([
      tp ? CD(i + 1, tpBg, "1F2937", true) : CD("", tpBg),
      tp ? CD(tp.name, tpBg, "1F2937", true) : CD("", tpBg),
      tp ? CD(tp.department, tpBg) : CD("", tpBg),
      tp ? CD(`${Math.round(tp.percentage * 10) / 10}%`, tpBg, "059669", true) : CD("", tpBg),
      ar ? CD(i + 1, arBg, "991B1B", true) : CD("", arBg),
      ar ? CD(ar.name, arBg, "991B1B", true) : CD("", arBg),
      ar ? CD(ar.department, arBg) : CD("", arBg),
      ar ? CD(`${Math.round(ar.percentage * 10) / 10}%`, arBg, "DC2626", true) : CD("", arBg),
      ...Array(4).fill(""),
    ]);
  }

  summaryAOA.push(blank12());
  const branchHeaderRowIdx = summaryAOA.length;
  summaryAOA.push([HDark("Branch-wise Performance Summary"), ...Array(11).fill("")]);
  summaryAOA.push([HCol("Branch"), HCol("Total"), HCol("POOR (<=30%)", "EF4444"), HCol("AVERAGE (31–60%)", "F59E0B"), HCol("GOOD (61–80%)", "3B82F6"), HCol("BEST (>=81%)", "10B981"), ...Array(6).fill("")]);
  branches.forEach(([br, d], idx) => {
    const bBg = idx % 2 === 0 ? "F9FAFB" : "FFFFFF";
    summaryAOA.push([
      CD(br, bBg, "1F2937", true),
      CD(d.total, bBg, "1F2937", true),
      CD(d.poor, bBg, d.poor > 0 ? "DC2626" : "9CA3AF", d.poor > 0),
      CD(d.avg,  bBg, d.avg  > 0 ? "D97706" : "9CA3AF", d.avg  > 0),
      CD(d.good, bBg, d.good > 0 ? "2563EB" : "9CA3AF", d.good > 0),
      CD(d.best, bBg, d.best > 0 ? "059669" : "9CA3AF", d.best > 0),
      ...Array(6).fill(""),
    ]);
  });

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAOA);
  const lastRow = summaryAOA.length;
  summaryWs["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
    { s: { r: 2, c: 6 }, e: { r: 2, c: 11 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 4 } },
    { s: { r: 10, c: 0 }, e: { r: 10, c: 3 } },
    { s: { r: 15, c: 0 }, e: { r: 15, c: 3 } },
    { s: { r: 15, c: 4 }, e: { r: 15, c: 7 } },
    { s: { r: branchHeaderRowIdx, c: 0 }, e: { r: branchHeaderRowIdx, c: 11 } },
  ];
  summaryWs["!cols"] = [28, 28, 18, 16, 28, 28, 18, 16, 8, 8, 8, 8].map((wch) => ({ wch }));
  void lastRow; // suppress unused

  // ── Test Results Sheet ────────────────────────────────────────────────────────
  // Derive coding section total marks from the section definition (same as legacy)
  const codingSecDef = secs.find((s) => /coding/i.test(s.name || ""));
  const codingSecTotalMarks = codingSecDef?.totalMarks || group.results[0]?.totalMarks || 40;

  // Detect all coding questions across all results in this group
  const allCodingQs = new Map<string, { qNum: number; title: string; maxMarks: number }>();
  for (const r of results) {
    const raw = extractCodingSubmissions(r as unknown as Record<string, unknown>);
    const normalized = normalizeCodingSubmissions(raw, codingSecTotalMarks);
    for (const c of normalized) {
      const qKey = `Q${c.questionNumber}`;
      if (!allCodingQs.has(qKey)) {
        allCodingQs.set(qKey, { qNum: c.questionNumber, title: c.problemTitle, maxMarks: c.maxMarks });
      }
    }
  }
  const codingQList = [...allCodingQs.values()].sort((a, b) => a.qNum - b.qNum);

  const baseH1 = ["#", "Roll Number", "Candidate Name", "Email", "College", "Department", "Year", "Start Time", "End Time", "Total Time Taken", "Violations", "Auto Submitted"];
  const secH1: string[] = [];
  const secH2: string[] = [];
  if (isSpoken) {
    secH1.push("Spoken English", "", "", "");
    secH2.push("CEFR Level", "Accuracy (%)", "Speaking Pace (WPM)", "Fillers Count");
  } else {
    for (const sec of secs) {
      const n = sec.name || "Section";
      const isSpokenSec = /spoken|speech|communication|sea/i.test(n);
      if (isSpokenSec) {
        secH1.push(n, "", "", "", "", "");
        secH2.push("Marks Obtained", "Total Marks", "Section %", "Time Taken", "CEFR Level", "WPM");
      } else {
        secH1.push(n, "", "", "");
        secH2.push("Marks Obtained", "Total Marks", "Section %", "Time Taken");
      }
    }
  }

  // ── Coding column headers: "Q1 - Problem Title" format (matches legacy exactly)
  const codH1: string[] = [];
  const codH2: string[] = [];
  for (const cq of codingQList) {
    codH1.push(`Q${cq.qNum} - ${cq.title}`, "", "", "");
    codH2.push("Marks Obtained", "Total Marks", "Accuracy (%)", "Time Taken");
  }

  const overH1 = ["Overall", "", "", "", ""];
  const overH2 = ["Score", "Total Marks", "Percentage", "Status", "Submitted Date"];
  const perfH1 = ["Performance", ""];
  const perfH2 = ["Insight", "Category"];

  const row1Names = [...baseH1, ...secH1, ...codH1, ...overH1, ...perfH1];
  const row2Names = [...baseH1, ...secH2, ...codH2, ...overH2, ...perfH2];

  const row1Cells = row1Names.map((name, ci) => {
    let bg = "0F172A", fg = "FFFFFF";
    if (ci < baseH1.length) { bg = "0F172A"; fg = "38BDF8"; }
    else if (ci < baseH1.length + secH1.length) { bg = "0F172A"; fg = "F59E0B"; }
    else if (ci < baseH1.length + secH1.length + codH1.length) { bg = "0F172A"; fg = "818CF8"; }
    else if (ci < baseH1.length + secH1.length + codH1.length + overH1.length) { bg = "0F172A"; fg = "34D399"; }
    else { bg = "0F172A"; fg = "A78BFA"; }
    return cell(name, { bg, fg, bold: true, fontSize: 11 });
  });

  const row2Cells = row2Names.map((name) => cell(name, { bg: "1E293B", fg: "FFFFFF", bold: true, fontSize: 10 }));

  const dataRows = results.map((r, idx) => {
    const rowBg = idx % 2 === 0 ? "FFFFFF" : "F8FAFC";
    const base = [
      idx + 1, r.rollNumber, r.name, r.email, r.college, r.department, formatYear(r.year),
      r.startedAt ? formatTime(r.startedAt) : "—",
      r.submittedAt ? formatTime(r.submittedAt) : "—",
      formatHrMinSec(r.timeTakenSeconds), r.violationCount, r.autoSubmitted ? "Yes" : "No",
    ];
    let secVals: unknown[] = [];
    if (isSpoken) {
      secVals = [r.cefrLevel || "—", `${Math.round(r.percentage)}%`, r.wpm || "—", r.fillerCount ?? "—"];
    } else {
      for (const secDef of secs) {
        const n = secDef.name;
        const isSpokenSec = /spoken|speech|communication|sea/i.test(n);
        const secData = r.sections.find((s) => s.name === n) ?? r.sections[secs.indexOf(secDef)];
        const sc = secData?.score ?? "—";
        const mx = secData?.totalMarks ?? "—";
        const pct = (typeof sc === "number" && typeof mx === "number" && mx > 0) ? `${Math.round((sc / mx) * 100)}%` : "—";
        const tt = secData?.timeTaken ?? "—";
        if (isSpokenSec) secVals.push(sc, mx, pct, tt, secData?.cefrLevel ?? r.cefrLevel ?? "—", secData?.wpm ?? r.wpm ?? "—");
        else secVals.push(sc, mx, pct, tt);
      }
    }

    const codVals: unknown[] = [];
    for (const cq of codingQList) {
      const cSub = r.codingSubmissions.find((c) =>
        c.questionNumber === cq.qNum || (c.problemTitle && c.problemTitle === cq.title)
      );
      if (cSub?.attempted) {
        codVals.push(cSub.score, cSub.maxMarks, `${cSub.accuracy}%`, cSub.timeTaken);
      } else {
        codVals.push("Did Not Attempt", "Did Not Attempt", "Did Not Attempt", "Did Not Attempt");
      }
    }

    const ic = getInsightCategory(r.percentage);
    const overall = [r.score, r.totalMarks, `${Math.round(r.percentage * 10) / 10}%`, r.status, formatDateDisplay(r.submittedAtDate)];
    const perf = [ic.insight, ic.category];

    return [...base, ...secVals, ...codVals, ...overall, ...perf].map((val) => {
      if (val === "PASS") return cell(val, { bg: "D1FAE5", fg: "065F46", bold: true });
      if (val === "FAIL") return cell(val, { bg: "FEE2E2", fg: "991B1B", bold: true });
      if (val === "Did Not Attempt") return cell(val, { bg: "FEF3C7", fg: "92400E" });
      return cell(val, { bg: rowBg });
    });
  });

  const dataAoa = [row1Cells, row2Cells, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(dataAoa);

  // Merges for grouped headers
  const merges: XLSX.Range[] = [];
  for (let c = 0; c < baseH1.length; c++) merges.push({ s: { r: 0, c }, e: { r: 1, c } });

  let ci = baseH1.length;
  if (isSpoken) { merges.push({ s: { r: 0, c: ci }, e: { r: 0, c: ci + 3 } }); ci += 4; }
  else {
    for (const sec of secs) {
      const n = sec.name;
      const span = /spoken|speech|communication|sea/i.test(n) ? 6 : 4;
      merges.push({ s: { r: 0, c: ci }, e: { r: 0, c: ci + span - 1 } });
      ci += span;
    }
  }
  for (let i = 0; i < codingQList.length; i++) { merges.push({ s: { r: 0, c: ci }, e: { r: 0, c: ci + 3 } }); ci += 4; }
  merges.push({ s: { r: 0, c: ci }, e: { r: 0, c: ci + 4 } }); ci += 5;
  merges.push({ s: { r: 0, c: ci }, e: { r: 0, c: ci + 1 } });
  ws["!merges"] = merges;
  // Column widths: use .v (cell value) for styled cell objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws["!cols"] = row2Names.map((_, c) => ({ wch: Math.max(12, ...dataAoa.slice(1).map((row) => String(((row as any[])[c] as any)?.v ?? (row as any[])[c] ?? "").length + 2)) }));

  const cleanTest   = safeFilename(group.testName || "Assessment");
  const cleanCol    = safeFilename([...group.colleges].join("_") || sample.college || "College");
  const dateStr     = new Date().toISOString().slice(0, 10);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");
  XLSX.utils.book_append_sheet(wb, ws, "Test Results");
  XLSX.writeFile(wb, `${cleanCol}-${cleanTest}-Assessment_Report-${dateStr}.xlsx`);
}

export function buildAssessmentWorkbookObject(group: AssessmentGroup): XLSX.WorkBook | null {
  if (!group.results.length) return null;
  const results = group.results;
  const secs = group.sections;
  const isSpoken = /spoken_english|speech|sea/i.test(group.type);

  const totalStudents = results.length;
  const avgPct = totalStudents > 0 ? results.reduce((s, r) => s + r.percentage, 0) / totalStudents : 0;
  const highestPct = totalStudents > 0 ? Math.max(...results.map((r) => r.percentage)) : 0;
  const lowestPct  = totalStudents > 0 ? Math.min(...results.map((r) => r.percentage)) : 0;
  const sample = results[0]!;
  const totalMarks = sample.totalMarks || 100;
  const passThreshold = 40;

  // Build Summary sheet aoa
  const S_AOA: any[][] = [];
  S_AOA.push([HMain("ASSESSMENT REPORT SUMMARY")]);
  S_AOA.push([HKey("Assessment Title"), CD(group.testName), HKey("Report Date"), CD(formatDateDisplay(new Date()))]);
  S_AOA.push([HKey("Test Type"), CD(group.type.toUpperCase()), HKey("Total Candidates"), CD(totalStudents)]);
  S_AOA.push([HKey("Total Marks"), CD(totalMarks), HKey("Class Average %"), CD(`${Math.round(avgPct * 10) / 10}%`)]);
  S_AOA.push([HKey("Highest %"), CD(`${Math.round(highestPct * 10) / 10}%`), HKey("Lowest %"), CD(`${Math.round(lowestPct * 10) / 10}%`)]);
  S_AOA.push([]);

  // Category breakdown
  const cats = [
    { name: "Best (>85%)", count: results.filter((r) => r.percentage >= 85).length },
    { name: "Good (70-84%)", count: results.filter((r) => r.percentage >= 70 && r.percentage < 85).length },
    { name: "Average (40-69%)", count: results.filter((r) => r.percentage >= 40 && r.percentage < 70).length },
    { name: "Poor (<40%)", count: results.filter((r) => r.percentage < 40).length },
  ];
  S_AOA.push([HSec("PERFORMANCE BRACKETS")]);
  S_AOA.push([HCol("Category"), HCol("Students"), HCol("Percentage")]);
  cats.forEach((c) => {
    S_AOA.push([CD(c.name), CD(c.count), CD(`${totalStudents > 0 ? Math.round((c.count / totalStudents) * 100) : 0}%`)]);
  });
  S_AOA.push([]);

  const summaryWs = XLSX.utils.aoa_to_sheet(S_AOA);

  // Build Test Results sheet
  const codingQMap = new Map<number, string>();
  for (const r of results) {
    for (const c of r.codingSubmissions) {
      if (!codingQMap.has(c.questionNumber)) codingQMap.set(c.questionNumber, c.problemTitle);
    }
  }
  const codingQList = [...codingQMap.entries()].sort(([a], [b]) => a - b);

  const baseH1 = ["S.No", "Candidate ID / Roll No", "Student Name", "Email", "College", "Department", "Year", "Test Name", "Test ID", "Test Type", "Start Time", "End Time", "Time Taken", "Violations", "Auto Submitted"];
  const row1Cells: any[] = baseH1.map(HMain);
  const row2Cells: any[] = baseH1.map(() => cell(""));

  if (isSpoken) {
    row1Cells.push(HSec("SPOKEN ENGLISH")); row1Cells.push(cell("")); row1Cells.push(cell("")); row1Cells.push(cell(""));
    row2Cells.push(HCol("CEFR Level"), HCol("CEFR Name"), HCol("WPM"), HCol("Fillers"));
  } else {
    for (const sec of secs) {
      const isSpokenSec = /spoken|speech|communication|sea/i.test(sec.name);
      const span = isSpokenSec ? 6 : 4;
      row1Cells.push(HSec(sec.name.toUpperCase()));
      for (let s = 1; s < span; s++) row1Cells.push(cell(""));
      row2Cells.push(HCol("Obtained"), HCol("Total"), HCol("Percentage"), HCol("Time Taken"));
      if (isSpokenSec) row2Cells.push(HCol("CEFR"), HCol("WPM"));
    }
  }

  for (const [qNum, qTitle] of codingQList) {
    row1Cells.push(HDark(`Q${qNum}: ${qTitle}`.toUpperCase()));
    row1Cells.push(cell("")); row1Cells.push(cell("")); row1Cells.push(cell(""));
    row2Cells.push(HCol("Obtained"), HCol("Total"), HCol("Accuracy %"), HCol("Time"));
  }

  row1Cells.push(HMain("OVERALL PERFORMANCE"));
  for (let s = 1; s < 5; s++) row1Cells.push(cell(""));
  row2Cells.push(HCol("Overall Score"), HCol("Total Marks"), HCol("Percentage %"), HCol("Status"), HCol("Category"));

  const dataRows: any[][] = results.map((r, rIdx) => {
    const bg = rIdx % 2 === 0 ? "FFFFFF" : "F8FAFC";
    const row: any[] = [
      CD(rIdx + 1, bg),
      CD(r.rollNumber, bg),
      CD(r.name, bg, "000000", true, 10),
      CD(r.email, bg),
      CD(r.college, bg),
      CD(r.department, bg),
      CD(formatYear(r.year), bg),
      CD(r.testName, bg),
      CD(r.testId, bg),
      CD((r.assessmentType || "mcq").toUpperCase(), bg),
      CD(r.startedAt ? formatTime(r.startedAt) : "—", bg),
      CD(r.submittedAt ? formatTime(r.submittedAt) : "—", bg),
      CD(formatHrMinSec(r.timeTakenSeconds), bg),
      CD(r.violationCount, bg),
      CD(r.autoSubmitted ? "Yes" : "No", bg),
    ];

    if (isSpoken) {
      row.push(CD(r.cefrLevel || "—", bg), CD(r.cefrName || "—", bg), CD(r.wpm || "—", bg), CD(r.fillerCount ?? "—", bg));
    } else {
      for (const sec of secs) {
        const isSpokenSec = /spoken|speech|communication|sea/i.test(sec.name);
        const sData = r.sections.find((s) => s.name === sec.name);
        if (sData) {
          row.push(CD(sData.score, bg), CD(sData.totalMarks, bg), CD(`${sData.percentage}%`, bg), CD(sData.timeTaken, bg));
          if (isSpokenSec) row.push(CD(sData.cefrLevel ?? r.cefrLevel ?? "—", bg), CD(sData.wpm ?? r.wpm ?? "—", bg));
        } else {
          row.push(CD("—", bg), CD("—", bg), CD("—", bg), CD("—", bg));
          if (isSpokenSec) row.push(CD("—", bg), CD("—", bg));
        }
      }
    }

    for (const [qNum] of codingQList) {
      const c = r.codingSubmissions.find((sub) => sub.questionNumber === qNum);
      if (c?.attempted) {
        row.push(CD(c.score, bg), CD(c.maxMarks, bg), CD(`${c.accuracy}%`, bg), CD(c.timeTaken, bg));
      } else {
        row.push(cell("Did Not Attempt", { bg: "FEF3C7", fg: "92400E" }), cell("Did Not Attempt", { bg: "FEF3C7", fg: "92400E" }), cell("—", { bg: "FEF3C7" }), cell("—", { bg: "FEF3C7" }));
      }
    }

    const passBg = r.percentage >= passThreshold ? "D1FAE5" : "FEE2E2";
    const passFg = r.percentage >= passThreshold ? "065F46" : "991B1B";
    row.push(CD(r.score, bg), CD(r.totalMarks, bg), CD(`${Math.round(r.percentage * 10) / 10}%`, bg, "000000", true, 10), cell(r.status, { bg: passBg, fg: passFg, bold: true }), CD(r.category, bg));

    return row;
  });

  const dataAoa = [row1Cells, row2Cells, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(dataAoa);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");
  XLSX.utils.book_append_sheet(wb, ws, "Test Results");
  return wb;
}

// ── Section Analysis Excel ────────────────────────────────────────────────────

export function generateSectionExcel(results: NormalizedResult[]): void {
  const rawRows: Record<string, unknown>[] = [];
  for (const r of results) {
    for (const sec of r.sections) {
      rawRows.push({
        "Student Name": r.name,
        "Roll Number": r.rollNumber,
        "College": r.college,
        "Department": r.department,
        "Year": formatYear(r.year),
        "Test Name": r.testName,
        "Section": sec.name,
        "Score": sec.score,
        "Max Score": sec.totalMarks,
        "Percentage (%)": `${sec.percentage}%`,
        "Time Taken": sec.timeTaken,
        "Status": sec.status,
      });
    }
  }
  if (!rawRows.length) return;

  const headers = Object.keys(rawRows[0]!);
  const headerRowCells = headers.map((h) => cell(h, { bg: "10B981", fg: "FFFFFF", bold: true }));
  const dataRowCells = rawRows.map((rowObj, rIdx) => {
    const rowBg = rIdx % 2 === 0 ? "FFFFFF" : "F8FAFC";
    return headers.map((h) => {
      const val = rowObj[h];
      if (h === "Status") return cell(val, { bg: val === "Pass" ? "D1FAE5" : "FEE2E2", fg: val === "Pass" ? "065F46" : "991B1B", bold: true });
      return cell(val, { bg: rowBg });
    });
  });

  const styledAoa = [headerRowCells, ...dataRowCells];
  const ws = XLSX.utils.aoa_to_sheet(styledAoa);
  ws["!cols"] = headers.map((h, ci) => ({ wch: Math.max(14, h.length + 2, ...dataRowCells.map((r) => String(r[ci]?.v || "").length + 2)) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Section Analysis");
  XLSX.writeFile(wb, `SEEDIT_Section_Analysis_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
