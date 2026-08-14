import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { NormalizedResult } from "./reportTypes";

const pf = (n: number, d = 1) => `${Math.round(n * 10 ** d) / 10 ** d}%`;
const nf = (n: number) => n.toLocaleString("en-IN");

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
}

const BRAND_DARK  = hexToRgb("0F172A");
const BRAND_BLUE  = hexToRgb("38BDF8");
const BRAND_GREEN = hexToRgb("34D399");
const BRAND_RED   = hexToRgb("F87171");
const BRAND_AMB   = hexToRgb("F59E0B");
const BRAND_INDG  = hexToRgb("818CF8");

interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY?: number };
}

function drawPageHeader(doc: jsPDF, title: string, assessmentName: string, y: number): number {
  doc.setFillColor(...BRAND_DARK);
  doc.rect(0, 0, 210, 18, "F");
  doc.setTextColor(...BRAND_BLUE);
  doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("SEED-IT Platform - Analysis Report", 10, 7);
  doc.setTextColor(255, 255, 255); doc.setFontSize(8);
  doc.text(assessmentName, 10, 13);
  doc.setTextColor(180, 180, 180);
  doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, 150, 13, { align: "right" });
  doc.setTextColor(...BRAND_DARK); doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text(title, 10, y + 6);
  doc.setDrawColor(...BRAND_BLUE); doc.setLineWidth(0.5);
  doc.line(10, y + 8, 200, y + 8);
  return y + 14;
}

function kpiBox(doc: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string, color: [number,number,number]) {
  doc.setFillColor(240, 249, 255);
  doc.roundedRect(x, y, w, h, 2, 2, "F");
  doc.setDrawColor(...color); doc.setLineWidth(0.8);
  doc.line(x, y, x, y + h);
  doc.setTextColor(...color); doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text(value, x + w / 2, y + h / 2 - 1, { align: "center" });
  doc.setTextColor(80, 80, 80); doc.setFontSize(7); doc.setFont("helvetica", "normal");
  doc.text(label, x + w / 2, y + h / 2 + 5, { align: "center" });
}

export function generateAnalysisPdf(
  results: NormalizedResult[],
  opts: { testName?: string; college?: string; year?: string } = {},
): void {
  if (results.length === 0) return;
  const assessmentName = opts.testName ?? results[0]?.assessmentId ?? "Assessment";
  const passThreshold = 40;
  const total = results.length;
  const passed = results.filter((r) => r.percentage >= passThreshold).length;
  const failed = total - passed;
  const passRate = total > 0 ? (passed / total) * 100 : 0;
  const avg = total > 0 ? results.reduce((s, r) => s + r.percentage, 0) / total : 0;
  const highest = total > 0 ? Math.max(...results.map((r) => r.percentage)) : 0;
  const lowest = total > 0 ? Math.min(...results.map((r) => r.percentage)) : 0;
  const sorted = [...results].sort((a, b) => a.percentage - b.percentage);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? (sorted[mid]?.percentage ?? 0)
    : ((sorted[mid - 1]?.percentage ?? 0) + (sorted[mid + 1]?.percentage ?? 0)) / 2;

  const bucketLabels = ["0-20%", "21-40%", "41-60%", "61-80%", "81-100%"];
  const buckets = [0,0,0,0,0];
  for (const r of results) { const i = Math.min(4, Math.floor(Math.min(99.99, Math.max(0, r.percentage)) / 20)); buckets[i] = (buckets[i] ?? 0) + 1; }

  const collegeMap = new Map<string, { sum: number; count: number; passed: number }>();
  for (const r of results) {
    const key = r.college || "Unknown";
    const cur = collegeMap.get(key) ?? { sum: 0, count: 0, passed: 0 };
    cur.sum += r.percentage; cur.count++; if (r.percentage >= passThreshold) cur.passed++;
    collegeMap.set(key, cur);
  }
  const collegeRows = [...collegeMap.entries()]
    .map(([college, v]) => ({ college, avg: v.count ? v.sum/v.count : 0, passRate: v.count ? (v.passed/v.count)*100 : 0, count: v.count }))
    .sort((a, b) => b.avg - a.avg);

  const deptMap = new Map<string, { sum: number; count: number; passed: number }>();
  for (const r of results) {
    const key = r.department || "Unassigned";
    const cur = deptMap.get(key) ?? { sum: 0, count: 0, passed: 0 };
    cur.sum += r.percentage; cur.count++; if (r.percentage >= passThreshold) cur.passed++;
    deptMap.set(key, cur);
  }
  const deptRows = [...deptMap.entries()]
    .map(([dept, v]) => ({ dept, avg: v.count ? v.sum/v.count : 0, passRate: v.count ? (v.passed/v.count)*100 : 0, count: v.count }))
    .sort((a, b) => b.avg - a.avg);

  const sampleWithSections = results.find((r) => r.sections.length > 0);
  const sectionNames: string[] = sampleWithSections?.sections.map((s) => s.name) ?? [];
  const sectionStats = sectionNames.map((sName: string) => {
    const secScores = results.map((r) => {
      const sec = r.sections.find((s: { name: string; score: number; totalMarks: number }) => s.name === sName);
      return sec && sec.totalMarks > 0 ? (sec.score / sec.totalMarks) * 100 : null;
    }).filter((v): v is number => v !== null);
    const secAvg = secScores.length > 0 ? secScores.reduce((a, b) => a + b, 0) / secScores.length : 0;
    const secPass = secScores.filter((v) => v >= passThreshold).length;
    return { name: sName, avg: secAvg, passRate: secScores.length > 0 ? (secPass/secScores.length)*100 : 0, attempted: secScores.length };
  });

  const codingMap = new Map<string, { scores: number[]; acc: number[]; attempted: number }>();
  for (const r of results) {
    for (const c of r.codingSubmissions) {
      const key = `Q${c.questionNumber} - ${c.problemTitle}`;
      const cur = codingMap.get(key) ?? { scores: [], acc: [], attempted: 0 };
      if (c.attempted) { cur.scores.push(c.score); cur.acc.push(c.accuracy); cur.attempted++; }
      codingMap.set(key, cur);
    }
  }
  const codingRows = [...codingMap.entries()].map(([q, v]) => ({
    q,
    attemptRate: total > 0 ? (v.attempted/total)*100 : 0,
    avgScore: v.scores.length ? v.scores.reduce((a,b)=>a+b,0)/v.scores.length : 0,
    avgAcc: v.acc.length ? v.acc.reduce((a,b)=>a+b,0)/v.acc.length : 0,
    attempted: v.attempted,
  }));

  const ranked = [...results].sort((a, b) => b.percentage - a.percentage).map((r, i) => ({ ...r, rank: i+1 }));

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as JsPDFWithAutoTable;

  // PAGE 1
  let y = drawPageHeader(doc, "Assessment Overview", assessmentName, 22);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(60,60,60);
  const metaLines: [string, string][] = [
    ["Assessment", assessmentName],
    ["College", opts.college ?? "All Colleges"],
    ["Year", opts.year ?? "All Years"],
    ["Total Attempts", nf(total)],
    ["Report Generated", new Date().toLocaleString("en-IN")],
  ];
  for (const [k, v] of metaLines) {
    doc.setFont("helvetica", "bold"); doc.text(k + ":", 10, y);
    doc.setFont("helvetica", "normal"); doc.text(v, 50, y); y += 5;
  }
  y += 4;
  const kpiW = 37; const kpiH = 18; const kpiGap = 3; let kpiX = 10;
  kpiBox(doc, kpiX, y, kpiW, kpiH, "Total Students", nf(total), BRAND_BLUE);       kpiX += kpiW + kpiGap;
  kpiBox(doc, kpiX, y, kpiW, kpiH, "Pass Rate", pf(passRate), BRAND_GREEN);        kpiX += kpiW + kpiGap;
  kpiBox(doc, kpiX, y, kpiW, kpiH, "Average Score", pf(avg), BRAND_INDG);          kpiX += kpiW + kpiGap;
  kpiBox(doc, kpiX, y, kpiW, kpiH, "Median Score", pf(median), BRAND_AMB);         kpiX += kpiW + kpiGap;
  kpiBox(doc, kpiX, y, kpiW, kpiH, "Passed", nf(passed), BRAND_GREEN);
  y += kpiH + kpiGap; kpiX = 10;
  kpiBox(doc, kpiX, y, kpiW, kpiH, "Failed", nf(failed), BRAND_RED);               kpiX += kpiW + kpiGap;
  kpiBox(doc, kpiX, y, kpiW, kpiH, "Highest Score", pf(highest), BRAND_BLUE);      kpiX += kpiW + kpiGap;
  kpiBox(doc, kpiX, y, kpiW, kpiH, "Lowest Score", pf(lowest), BRAND_RED);
  y += kpiH + 8;
  if (total > 0) {
    const barW = 190; const passW = (passed/total)*barW;
    doc.setFillColor(...BRAND_GREEN); doc.rect(10, y, passW, 6, "F");
    doc.setFillColor(...BRAND_RED);   doc.rect(10+passW, y, barW-passW, 6, "F");
    doc.setFontSize(7); doc.setTextColor(255,255,255);
    if (passW > 15) doc.text(`PASS ${pf(passRate)}`, 10+passW/2, y+4, { align: "center" });
    if (barW-passW > 15) doc.text(`FAIL ${pf(100-passRate)}`, 10+passW+(barW-passW)/2, y+4, { align: "center" });
    y += 12;
  }
  doc.setTextColor(...BRAND_DARK); doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("Score Distribution", 10, y); y += 3;
  autoTable(doc, {
    startY: y,
    head: [["Score Range","Students","% of Total"]],
    body: buckets.map((count, i) => [bucketLabels[i] ?? "", nf(count), total>0?pf((count/total)*100):"0%"]),
    headStyles: { fillColor: BRAND_DARK, textColor: BRAND_BLUE, fontSize: 8, fontStyle: "bold" },
    bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [248,250,252] },
    columnStyles: { 0:{cellWidth:40}, 1:{cellWidth:30,halign:"right"}, 2:{cellWidth:35,halign:"right"} },
    margin: { left: 10, right: 10 }, tableWidth: 110,
  });

  // PAGE 2
  doc.addPage();
  y = drawPageHeader(doc, "Section-wise Performance", assessmentName, 22);
  if (sectionStats.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Section","Avg Score %","Pass Rate %","Attempted"]],
      body: sectionStats.map((s) => [s.name, pf(s.avg), pf(s.passRate), nf(s.attempted)]) as string[][],
      headStyles: { fillColor: BRAND_DARK, textColor: BRAND_AMB, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [248,250,252] },
      margin: { left: 10, right: 10 },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 10;
  } else {
    doc.setFontSize(9); doc.setTextColor(150,150,150);
    doc.text("No section-level data available for this assessment.", 10, y+6);
    y += 16;
  }
  doc.setTextColor(...BRAND_DARK); doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("Department Breakdown", 10, y); y += 3;
  autoTable(doc, {
    startY: y,
    head: [["Department","Students","Avg Score %","Pass Rate %"]],
    body: deptRows.map((d) => [d.dept, nf(d.count), pf(d.avg), pf(d.passRate)]),
    headStyles: { fillColor: BRAND_DARK, textColor: BRAND_INDG, fontSize: 8, fontStyle: "bold" },
    bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [248,250,252] },
    margin: { left: 10, right: 10 },
  });

  // PAGE 3
  doc.addPage();
  y = drawPageHeader(doc, "Coding Section Analysis", assessmentName, 22);
  if (codingRows.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Problem","Attempted","Attempt Rate %","Avg Score","Avg Accuracy %"]],
      body: codingRows.map((c) => [c.q, nf(c.attempted), pf(c.attemptRate), pf(c.avgScore), pf(c.avgAcc)]),
      headStyles: { fillColor: BRAND_DARK, textColor: BRAND_INDG, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [248,250,252] },
      columnStyles: { 0:{cellWidth:70} }, margin: { left: 10, right: 10 },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 10;
  } else {
    doc.setFontSize(9); doc.setTextColor(150,150,150);
    doc.text("No coding submissions found for this assessment.", 10, y+6); y += 16;
  }
  const topPerformers = ranked.slice(0, 3);
  const atRisk = [...ranked].sort((a, b) => a.percentage - b.percentage).slice(0, 5);
  doc.setTextColor(...BRAND_DARK); doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("Top Performers", 10, y); y += 3;
  autoTable(doc, {
    startY: y,
    head: [["Rank","Name","Roll No","Score %"]],
    body: topPerformers.map((r) => [r.rank, r.name, r.rollNumber, pf(r.percentage)]),
    headStyles: { fillColor: [245,158,11], textColor: [255,255,255], fontSize: 8 },
    bodyStyles: { fontSize: 8 }, margin: { left: 10, right: 10 }, tableWidth: 120,
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 6;
  doc.setTextColor(...BRAND_DARK); doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("At-Risk Students (Lowest Scores)", 10, y); y += 3;
  autoTable(doc, {
    startY: y,
    head: [["Name","Roll No","Department","Score %"]],
    body: atRisk.map((r) => [String(r.name), String(r.rollNumber), String(r.department), pf(r.percentage)]),
    headStyles: { fillColor: BRAND_RED, textColor: [255,255,255], fontSize: 8 },
    bodyStyles: { fontSize: 8 }, margin: { left: 10, right: 10 },
  });

  // PAGE 4
  doc.addPage();
  y = drawPageHeader(doc, "College Comparison", assessmentName, 22);
  autoTable(doc, {
    startY: y,
    head: [["College / Institution","Students","Avg Score %","Pass Rate %","Pass Count"]],
    body: collegeRows.map((c) => [c.college, nf(c.count), pf(c.avg), pf(c.passRate), nf(Math.round((c.passRate/100)*c.count))]),
    headStyles: { fillColor: BRAND_DARK, textColor: BRAND_GREEN, fontSize: 8, fontStyle: "bold" },
    bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [248,250,252] },
    margin: { left: 10, right: 10 },
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 12;
  if (collegeRows.length > 0) {
    const best = collegeRows[0]!; const worst = collegeRows[collegeRows.length-1]!;
    doc.setTextColor(...BRAND_DARK); doc.setFontSize(10); doc.setFont("helvetica", "bold");
    doc.text("Key Observations", 10, y); y += 5;
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(60,60,60);
    doc.text(`Best performing: ${best.college} (Avg: ${pf(best.avg)}, Pass: ${pf(best.passRate)})`, 10, y); y += 5;
    if (worst !== best) { doc.text(`Needs improvement: ${worst.college} (Avg: ${pf(worst.avg)}, Pass: ${pf(worst.passRate)})`, 10, y); y += 5; }
    doc.text(`Overall pass rate: ${pf(passRate)} (${nf(passed)} of ${nf(total)} students)`, 10, y);
  }

  // PAGE 5
  doc.addPage();
  y = drawPageHeader(doc, `Full Rank List (${nf(total)} Students)`, assessmentName, 22);
  autoTable(doc, {
    startY: y,
    head: [["#","Name","Roll No","Email","College","Dept","Score","Total","%","Status"]],
    body: ranked.map((r) => [r.rank, r.name, r.rollNumber, r.email, r.college, r.department, r.score, r.totalMarks, pf(r.percentage), r.percentage >= passThreshold ? "PASS" : "FAIL"]),
    headStyles: { fillColor: BRAND_DARK, textColor: BRAND_BLUE, fontSize: 7, fontStyle: "bold" },
    bodyStyles: { fontSize: 7 }, alternateRowStyles: { fillColor: [248,250,252] },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 9) {
        const val = String(data.cell.raw ?? "");
        if (val === "PASS") { data.cell.styles.textColor = hexToRgb("065F46"); data.cell.styles.fillColor = hexToRgb("D1FAE5"); }
        if (val === "FAIL") { data.cell.styles.textColor = hexToRgb("991B1B"); data.cell.styles.fillColor = hexToRgb("FEE2E2"); }
      }
    },
    columnStyles: { 0:{cellWidth:8}, 1:{cellWidth:35}, 2:{cellWidth:18}, 3:{cellWidth:40}, 4:{cellWidth:30}, 5:{cellWidth:18}, 6:{cellWidth:12,halign:"right"}, 7:{cellWidth:12,halign:"right"}, 8:{cellWidth:12,halign:"right"}, 9:{cellWidth:12,halign:"center"} },
    margin: { left: 5, right: 5 },
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(200,200,200); doc.setLineWidth(0.2); doc.line(5, 290, 205, 290);
    doc.setFontSize(7); doc.setTextColor(150,150,150); doc.setFont("helvetica", "normal");
    doc.text("SEED-IT Platform - Confidential - For Internal Use Only", 105, 294, { align: "center" });
    doc.text(`Page ${i} of ${pageCount}`, 200, 294, { align: "right" });
  }

  const filename = `SEED-IT-Analysis-${(opts.testName ?? "report").replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(filename);
}
