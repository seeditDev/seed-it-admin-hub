/**
 * ─── SEED-IT PDF Report Engine ────────────────────────────────────────────────
 *
 * Three exports:
 *   generateStudentPdf()   — individual student jsPDF report
 *   generateBulkPdf()      — one consolidated PDF for all filtered students
 *   generateBulkZip()      — per-student PDFs packed into a JSZip archive
 *
 * Matches legacy ReportsPage.js layout exactly.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx-js-style";
import type { NormalizedResult, TagStat, AssessmentGroup } from "./reportTypes";
import {
  sanitizePDFText,
  buildTagStats,
  getRecommendations,
  getReadinessCategory,
  safeFilename,
  formatYear,
  formatDateDisplay,
} from "./reportNormalizer";
import { buildCsvContent } from "./csvReport";
import { buildAssessmentWorkbookObject } from "./excelReport";
import { buildAnalysisPdfDoc } from "./analysisReport";
import { computeAssessmentGroups } from "./reportAnalytics";

// ── Color Palette ─────────────────────────────────────────────────────────────

const C = {
  primary:   [99, 102, 241] as [number, number, number],
  secondary: [236, 72, 153] as [number, number, number],
  success:   [34, 197, 94] as [number, number, number],
  warning:   [251, 191, 36] as [number, number, number],
  error:     [239, 68, 68] as [number, number, number],
  dark:      [15, 23, 42] as [number, number, number],
  light:     [248, 250, 252] as [number, number, number],
  gray:      [71, 85, 105] as [number, number, number],
};

// ── Document Builder ──────────────────────────────────────────────────────────

function createDoc(): jsPDF {
  return new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
}

function drawHeaderBanner(doc: jsPDF): void {
  const pw = doc.internal.pageSize.getWidth();
  doc.setFillColor(...C.primary);
  doc.rect(0, 0, pw, 38, "F");
  doc.setFillColor(...C.secondary);
  doc.rect(0, 34, pw, 4, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("INDIVIDUAL PERFORMANCE REPORT", pw / 2, 14, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("SEED SEB Candidate Section Breakdown & Placement Evaluation", pw / 2, 22, { align: "center" });
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, 14, 30);
  doc.text(`Report ID: RPT-${Date.now().toString(36).toUpperCase()}`, pw - 60, 30);
}

function drawFooters(doc: jsPDF): void {
  const totalPages = doc.getNumberOfPages();
  const ph = doc.internal.pageSize.getHeight();
  const pw = doc.internal.pageSize.getWidth();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(...C.dark);
    doc.rect(0, ph - 10, pw, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text("SEED SEB COMPANY READINESS REPORT - Confidential", 14, ph - 4);
    doc.text(`Page ${p} of ${totalPages}`, pw - 30, ph - 4);
  }
}

// ── Per-Student Content Renderer ──────────────────────────────────────────────

function renderStudentContent(doc: jsPDF, r: NormalizedResult, startY: number): void {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  let y = startY;

  const addPage = () => { doc.addPage(); y = 15; };
  const checkPage = (needed = 20) => { if (y + needed > ph - 15) addPage(); };

  // ── Profile Card ──────────────────────────────────────────────────────────
  doc.setFillColor(...C.light);
  doc.roundedRect(14, y, pw - 28, 40, 3, 3, "F");
  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.5);
  doc.roundedRect(14, y, pw - 28, 40, 3, 3, "S");

  doc.setTextColor(...C.dark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(sanitizePDFText(r.name), 22, y + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.gray);
  const profileFields: [string, string][] = [
    [`Roll No: ${sanitizePDFText(r.rollNumber)}`, `College: ${sanitizePDFText(r.college)}`],
    [`Department: ${sanitizePDFText(r.department)}`, `Year: ${sanitizePDFText(formatYear(r.year))}`],
    [`Email: ${sanitizePDFText(r.email)}`, `Assessment: ${sanitizePDFText(r.testName)}`],
  ];
  profileFields.forEach((row, idx) => {
    doc.text(row[0], 22, y + 18 + idx * 7);
    doc.text(row[1], pw / 2, y + 18 + idx * 7);
  });
  y += 50;

  // ── Readiness Score ───────────────────────────────────────────────────────
  const pct = r.percentage;
  const rc = getReadinessCategory(pct);
  let categoryColor: [number, number, number];
  if (pct >= 85) categoryColor = C.primary;
  else if (pct >= 70) categoryColor = C.success;
  else if (pct >= 55) categoryColor = [234, 179, 8];
  else if (pct >= 40) categoryColor = C.warning;
  else categoryColor = C.error;

  doc.setFillColor(...categoryColor);
  doc.roundedRect(14, y, pw - 28, 28, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("PLACEMENT READINESS ASSESSMENT", 22, y + 8);
  doc.setFontSize(14);
  doc.text(rc.category, 22, y + 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(sanitizePDFText(rc.pkg), 22, y + 24);

  doc.setFillColor(255, 255, 255);
  doc.circle(pw - 30, y + 14, 12, "F");
  doc.setTextColor(...categoryColor);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`${Math.round(pct)}%`, pw - 37, y + 16);
  doc.setFontSize(7);
  doc.text("SCORE", pw - 35, y + 21);
  y += 36;

  // ── Score Summary Cards ───────────────────────────────────────────────────
  checkPage(30);
  const summaryItems = [
    { label: "Overall Score", value: `${r.score}/${r.totalMarks}`, color: C.primary },
    { label: "Percentage", value: `${Math.round(pct)}%`, color: pct >= 70 ? C.success : pct >= 40 ? C.warning : C.error },
    { label: "Partial Score", value: String(r.partialScore || r.score), color: C.primary },
    { label: "Full Score", value: r.fullScore > 0 ? String(r.fullScore) : "—", color: r.fullScore > 0 ? C.success : C.gray },
    { label: "Time Taken", value: r.timeTaken || "N/A", color: C.gray },
    { label: "Violations", value: String(r.violationCount), color: r.violationCount > 0 ? C.error : C.success },
  ];
  const cardW = (pw - 28 - (summaryItems.length - 1) * 3) / summaryItems.length;
  summaryItems.forEach((item, idx) => {
    const cx = 14 + idx * (cardW + 3);
    doc.setFillColor(...item.color);
    doc.roundedRect(cx, y, cardW, 20, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(sanitizePDFText(item.value), cx + cardW / 2, y + 10, { align: "center" });
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.text(item.label, cx + cardW / 2, y + 16, { align: "center" });
  });
  y += 28;

  // ── Section Performance ───────────────────────────────────────────────────
  if (r.sections.length > 0) {
    checkPage(40);
    doc.setTextColor(...C.dark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Section-wise Performance", 14, y);
    y += 6;

    const sectionRows = r.sections.map((sec) => [
      sanitizePDFText(sec.name),
      String(sec.score),
      String(sec.totalMarks),
      `${sec.percentage}%`,
      sec.timeTaken,
      sec.status,
    ]);

    autoTable(doc, {
      startY: y,
      head: [["Section", "Score", "Max", "Percentage", "Time", "Status"]],
      body: sectionRows,
      theme: "grid",
      headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 5) {
          if (data.cell.text[0] === "Pass") data.cell.styles.textColor = C.success as [number, number, number];
          else data.cell.styles.textColor = C.error as [number, number, number];
        }
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── Strength & Weakness ───────────────────────────────────────────────────
  const tagStats: TagStat[] = buildTagStats(r.questions);
  const strengths = tagStats.filter((t) => t.accuracy >= 70);
  const needsWork  = tagStats.filter((t) => t.accuracy < 50);

  if (strengths.length > 0 || needsWork.length > 0) {
    checkPage(50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...C.dark);
    doc.text("Strength & Improvement Areas", 14, y);
    y += 8;

    const halfW = (pw - 31) / 2;
    const boxH = Math.max(10, Math.max(strengths.length, needsWork.length) * 8 + 16);

    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(...C.success);
    doc.setLineWidth(0.5);
    doc.roundedRect(14, y, halfW, boxH, 2, 2, "FD");
    doc.setTextColor(...C.success);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("STRENGTHS", 18, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.dark);
    strengths.slice(0, 6).forEach((t, i) => doc.text(`* ${t.tag} (${t.accuracy}% accuracy)`, 18, y + 14 + i * 7));
    if (strengths.length === 0) doc.text("Keep practicing to identify strengths", 18, y + 14);

    const nx = 14 + halfW + 3;
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(...C.error);
    doc.roundedRect(nx, y, halfW, boxH, 2, 2, "FD");
    doc.setTextColor(...C.error);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("NEEDS ATTENTION", nx + 4, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.dark);
    needsWork.slice(0, 6).forEach((t, i) => doc.text(`* ${t.tag} (${t.accuracy}% accuracy)`, nx + 4, y + 14 + i * 7));
    if (needsWork.length === 0) doc.text("No critical weak areas found!", nx + 4, y + 14);

    y += boxH + 8;
  }

  // ── MCQ Question Analysis ─────────────────────────────────────────────────
  if (r.questions.length > 0) {
    checkPage(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...C.dark);
    doc.text("Question-by-Question Analysis (MCQ)", 14, y);
    y += 6;

    const qRows = r.questions.slice(0, 50).map((q) => {
      const qText = q.questionText.substring(0, 48) + (q.questionText.length > 48 ? "..." : "");
      const topic = q.topic.substring(0, 20);
      const ans = q.selectedAnswer.substring(0, 30);
      return [
        String(q.index),
        qText,
        topic,
        q.isCorrect ? "PASS" : "FAIL",
        ans,
        `${q.timeTakenSeconds}s`,
        q.difficulty,
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [["#", "Question", "Tags/Topic", "Result", "Your Answer", "Time", "Difficulty"]],
      body: qRows,
      theme: "striped",
      headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      columnStyles: { 0: { cellWidth: 8 }, 3: { fontStyle: "bold", halign: "center" } },
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          if (data.cell.text[0] === "PASS") data.cell.styles.textColor = C.success as [number, number, number];
          else if (data.cell.text[0] === "FAIL") data.cell.styles.textColor = C.error as [number, number, number];
        }
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── Coding Analysis ───────────────────────────────────────────────────────
  if (r.codingSubmissions.length > 0) {
    checkPage(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...C.dark);
    doc.text("Coding Section Analysis", 14, y);
    y += 6;

    const sortedByTime = [...r.codingSubmissions].sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
    const first = sortedByTime[0]!;
    const difficultyPref = first.difficulty === "Hard" ? "Prefers Challenges" : first.difficulty === "Easy" ? "Starts Safe" : "Balanced Approach";

    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(...C.primary);
    doc.roundedRect(14, y, pw - 28, 14, 2, 2, "FD");
    doc.setTextColor(...C.primary);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Coding Approach: ${difficultyPref}`, 18, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.gray);
    doc.text(`First submitted: Q${first.questionNumber} (${first.difficulty}) - Language: ${r.codingSubmissions[0]?.language ?? "N/A"}`, 18, y + 12);
    y += 20;

    const codingRows = r.codingSubmissions.map((c) => [
      `Q${c.questionNumber}`,
      c.problemTitle.substring(0, 35),
      c.language,
      c.timeComplexity,
      c.spaceComplexity,
      `${c.testsPassed}/${c.totalTests}`,
      `${c.timeTakenSeconds}s`,
      c.difficulty,
    ]);

    autoTable(doc, {
      startY: y,
      head: [["Q#", "Problem", "Language", "Time Complexity", "Space Complexity", "Tests", "Time", "Difficulty"]],
      body: codingRows,
      theme: "grid",
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 14, right: 14 },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    // Submitted code blocks
    for (let ci = 0; ci < r.codingSubmissions.length; ci++) {
      const c = r.codingSubmissions[ci]!;
      if (!c.code) continue;
      checkPage(30);
      const title = `Q${c.questionNumber} - ${c.problemTitle.substring(0, 40)} (${c.language})`;
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(14, y, pw - 28, 8, 1, 1, "F");
      doc.setTextColor(129, 140, 248);
      doc.setFont("courier", "bold");
      doc.setFontSize(8);
      doc.text(title, 18, y + 5.5);
      y += 10;

      const codeLines = c.code.replace(/\r/g, "").split("\n").slice(0, 60);
      doc.setFont("courier", "normal");
      doc.setFontSize(7);
      codeLines.forEach((line, li) => {
        checkPage(6);
        if (li % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, y - 1, pw - 28, 5.5, "F");
        }
        doc.setTextColor(100, 116, 139);
        doc.text(String(li + 1).padStart(3, " "), 16, y + 3.5);
        doc.setTextColor(30, 41, 59);
        const safeLine = line.replace(/[^\x20-\x7E\t]/g, "").substring(0, 95);
        doc.text(safeLine, 26, y + 3.5);
        y += 5.5;
      });
      if (c.code.split("\n").length > 60) {
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(7);
        doc.text("... (code truncated at 60 lines)", 18, y + 3);
        y += 6;
      }
      y += 4;
    }
  }

  // ── Recommendations ───────────────────────────────────────────────────────
  checkPage(44);
  const recs = getRecommendations(pct, tagStats, r.codingSubmissions);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.8);
  const recBoxH = 16 + recs.length * 7;
  doc.roundedRect(14, y, pw - 28, recBoxH, 3, 3, "FD");
  doc.setTextColor(...C.primary);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Recommendations & Action Plan", 18, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.dark);
  recs.forEach((rec, idx) => doc.text(`${idx + 1}. ${sanitizePDFText(rec)}`, 18, y + 16 + idx * 7));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Generate and download a single-student Individual Performance Report PDF. */
export async function generateStudentPdf(r: NormalizedResult): Promise<void> {
  const doc = createDoc();
  drawHeaderBanner(doc);
  renderStudentContent(doc, r, 48);
  drawFooters(doc);

  const firstName = (r.name || "Student").trim().split(/\s+/)[0] || "Student";
  const rollNo = r.rollNumber || "Candidate";
  const testName = r.testName || "Assessment";

  const cleanFirstName = safeFilename(firstName);
  const cleanRoll = safeFilename(rollNo);
  const cleanTest = safeFilename(testName);
  doc.save(`${cleanFirstName}-${cleanRoll}-${cleanTest}.pdf`);
}

/** Generate a consolidated bulk PDF (all students in one file, each starts on a new page). */
export async function generateBulkPdf(
  results: NormalizedResult[],
  filters: { testName?: string; college?: string; year?: string } = {},
): Promise<void> {
  if (!results.length) return;
  const doc = createDoc();
  let isFirst = true;

  for (const r of results) {
    if (!isFirst) doc.addPage();
    isFirst = false;
    drawHeaderBanner(doc);
    renderStudentContent(doc, r, 48);
  }

  drawFooters(doc);

  const sample = results[0]!;
  const cleanTest    = safeFilename(filters.testName || sample.testName);
  const cleanCollege = safeFilename(filters.college  || sample.college);
  const cleanYear    = safeFilename(formatYear(filters.year || sample.year));
  const dateStr      = new Date().toISOString().slice(0, 10);
  doc.save(`${cleanCollege}-${cleanTest}-${cleanYear}-${dateStr}.pdf`);
}

/** Generate a complete bundle ZIP containing Marks Report CSV, Assessment Report Excel, Institutional Analysis PDF, and all student Individual Performance Report PDFs. */
export async function generateBulkZip(
  results: NormalizedResult[],
  filters: { testName?: string; college?: string; year?: string } = {},
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (!results.length) return;
  const zip = new JSZip();
  const total = results.length;

  const sample = results[0]!;
  const collegeName = filters.college || sample.college || "College";
  const testTitle = filters.testName || sample.testName || "Assessment";
  const dateStr = new Date().toISOString().slice(0, 10);
  const cleanCollege = safeFilename(collegeName);
  const cleanTest = safeFilename(testTitle);

  // 1. Add Marks Report CSV
  try {
    const csvContent = buildCsvContent(results);
    zip.file(`${cleanCollege}-${cleanTest}-Marks_Report-${dateStr}.csv`, csvContent);
  } catch (err) {
    console.error("Error generating Marks CSV for ZIP:", err);
  }

  // 2. Add Assessment Report Excel
  try {
    const groups = computeAssessmentGroups(results);
    const group: AssessmentGroup = groups[0] || {
      testId: sample.testId || "assessment",
      testName: testTitle,
      type: sample.assessmentType || "mcq",
      results,
      sections: sample.sections,
      totalSubmissions: results.length,
      avgPercentage: results.reduce((acc, r) => acc + r.percentage, 0) / (results.length || 1),
      passRate: 0,
      colleges: new Set([collegeName]),
      depts: new Set(),
      years: new Set(),
    };
    const wb = buildAssessmentWorkbookObject(group);
    if (wb) {
      const wbBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      zip.file(`${cleanCollege}-${cleanTest}-Assessment_Report-${dateStr}.xlsx`, wbBuffer);
    }
  } catch (err) {
    console.error("Error generating assessment workbook for ZIP:", err);
  }

  // 3. Add Institutional Analysis PDF
  try {
    const analysisOpts: { testName?: string; college?: string; year?: string } = {
      testName: testTitle,
      college: collegeName,
    };
    if (filters.year) analysisOpts.year = filters.year;
    const analysisDoc = buildAnalysisPdfDoc(results, analysisOpts);
    if (analysisDoc) {
      const analysisBlob = analysisDoc.output("blob");
      zip.file(`${cleanCollege}-${cleanTest}-Institutional_Analysis-${dateStr}.pdf`, analysisBlob);
    }
  } catch (err) {
    console.error("Error generating institutional analysis PDF for ZIP:", err);
  }

  // 4. Add Individual Performance Reports folder
  const individualFolder = zip.folder("Individual_Performance_Reports");
  for (let i = 0; i < total; i++) {
    const r = results[i]!;
    const doc = createDoc();
    drawHeaderBanner(doc);
    renderStudentContent(doc, r, 48);
    drawFooters(doc);

    const pdfBlob = doc.output("blob");
    const firstName = (r.name || `Student_${i + 1}`).trim().split(/\s+/)[0] || "Student";
    const rollNo = r.rollNumber || `Roll_${i + 1}`;
    const testName = r.testName || "Assessment";
    const cleanFirstName = safeFilename(firstName);
    const cleanRoll = safeFilename(rollNo);
    const cleanStudentTest = safeFilename(testName);

    const pdfName = `${cleanFirstName}-${cleanRoll}-${cleanStudentTest}.pdf`;
    if (individualFolder) {
      individualFolder.file(pdfName, pdfBlob);
    } else {
      zip.file(pdfName, pdfBlob);
    }

    onProgress?.(Math.round(((i + 1) / total) * 100));
    await new Promise((res) => setTimeout(res, 0));
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  saveAs(zipBlob, `${cleanCollege}-${cleanTest}-Complete_Reports_Bundle-${dateStr}.zip`);
}
