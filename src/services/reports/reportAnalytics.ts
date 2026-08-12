/**
 * ─── SEED-IT Report Analytics Engine ─────────────────────────────────────────
 *
 * Computes all dashboard statistics from NormalizedResult[].
 * Used by the UI, Excel Summary sheet, and PDF summary pages.
 */

import type { NormalizedResult, AssessmentGroup, TagStat } from "./reportTypes";
import { buildTagStats, getInsightCategory } from "./reportNormalizer";

// ── KPI Summary ───────────────────────────────────────────────────────────────

export interface KpiSummary {
  total: number;
  avgPct: number;
  highest: number;
  lowest: number;
  passed: number;
  failed: number;
  passRate: number;
  highAchievers: number; // >= 80%
  topPerformers: NormalizedResult[];
  needsAttention: NormalizedResult[];
}

export function computeKpis(results: NormalizedResult[], passThreshold = 40): KpiSummary {
  const total = results.length;
  if (total === 0) {
    return { total: 0, avgPct: 0, highest: 0, lowest: 0, passed: 0, failed: 0, passRate: 0, highAchievers: 0, topPerformers: [], needsAttention: [] };
  }
  const sum = results.reduce((s, r) => s + r.percentage, 0);
  const avgPct = Math.round((sum / total) * 10) / 10;
  const highest = Math.round(Math.max(...results.map((r) => r.percentage)) * 10) / 10;
  const lowest = Math.round(Math.min(...results.map((r) => r.percentage)) * 10) / 10;
  const passed = results.filter((r) => r.percentage >= passThreshold).length;
  const failed = total - passed;
  const passRate = Math.round((passed / total) * 1000) / 10;
  const highAchievers = results.filter((r) => r.percentage >= 80).length;
  const sorted = [...results].sort((a, b) => b.percentage - a.percentage);
  return {
    total,
    avgPct,
    highest,
    lowest,
    passed,
    failed,
    passRate,
    highAchievers,
    topPerformers: sorted.slice(0, 10),
    needsAttention: results.filter((r) => r.percentage < 40).slice(0, 10),
  };
}

// ── Department Breakdown ──────────────────────────────────────────────────────

export interface DeptStat {
  department: string;
  total: number;
  avgPct: number;
  poor: number;   // < 40%
  avg: number;    // 40–69%
  good: number;   // 70–80%
  best: number;   // > 80%
}

export function computeByDepartment(results: NormalizedResult[]): DeptStat[] {
  const map = new Map<string, { sum: number; total: number; poor: number; avg: number; good: number; best: number }>();
  for (const r of results) {
    const key = r.department || "Unassigned";
    const cur = map.get(key) ?? { sum: 0, total: 0, poor: 0, avg: 0, good: 0, best: 0 };
    cur.sum += r.percentage;
    cur.total++;
    const p = r.percentage;
    if (p >= 81) cur.best++;
    else if (p >= 61) cur.good++;
    else if (p >= 31) cur.avg++;
    else cur.poor++;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([department, d]) => ({
      department,
      total: d.total,
      avgPct: d.total > 0 ? Math.round((d.sum / d.total) * 10) / 10 : 0,
      poor: d.poor,
      avg: d.avg,
      good: d.good,
      best: d.best,
    }))
    .sort((a, b) => b.avgPct - a.avgPct);
}

// ── College Breakdown ─────────────────────────────────────────────────────────

export interface CollegeStat {
  college: string;
  total: number;
  avgPct: number;
  passRate: number;
}

export function computeByCollege(results: NormalizedResult[], passThreshold = 40): CollegeStat[] {
  const map = new Map<string, { sum: number; count: number; passed: number }>();
  for (const r of results) {
    const key = r.college || "Unknown";
    const cur = map.get(key) ?? { sum: 0, count: 0, passed: 0 };
    cur.sum += r.percentage;
    cur.count++;
    if (r.percentage >= passThreshold) cur.passed++;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([college, v]) => ({
      college,
      total: v.count,
      avgPct: v.count ? Math.round((v.sum / v.count) * 10) / 10 : 0,
      passRate: v.count ? Math.round((v.passed / v.count) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.avgPct - a.avgPct)
    .slice(0, 10);
}

// ── Score Distribution ────────────────────────────────────────────────────────

export function computeDistribution(results: NormalizedResult[]) {
  const BUCKETS = ["0–20", "20–40", "40–60", "60–80", "80–100"];
  const counts = [0, 0, 0, 0, 0];
  for (const r of results) {
    const idx = Math.min(4, Math.floor(Math.min(99.99, Math.max(0, r.percentage)) / 20));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return BUCKETS.map((bucket, i) => ({ bucket, count: counts[i] ?? 0 }));
}

// ── Assessment Groups ─────────────────────────────────────────────────────────

export function computeAssessmentGroups(results: NormalizedResult[]): AssessmentGroup[] {
  const map = new Map<string, AssessmentGroup>();
  for (const r of results) {
    const key = r.testId || r.testName || "unknown";
    if (!map.has(key)) {
      map.set(key, {
        testId: r.testId || "unknown",
        testName: r.testName || "Assessment",
        type: r.assessmentType || "mcq",
        results: [],
        sections: [],
        totalSubmissions: 0,
        avgPercentage: 0,
        passRate: 0,
        colleges: new Set<string>(),
        depts: new Set<string>(),
        years: new Set<string>(),
      });
    }
    const group = map.get(key)!;
    group.results.push(r);
    if (r.college) group.colleges.add(r.college);
    if (r.department) group.depts.add(r.department);
    if (r.year) group.years.add(r.year);
    // Keep the richest sections array
    if (r.sections.length > group.sections.length) group.sections = r.sections;
  }

  const list: AssessmentGroup[] = [];
  for (const group of map.values()) {
    const total = group.results.length;
    const avgPct = total > 0 ? group.results.reduce((s, r) => s + r.percentage, 0) / total : 0;
    const passCount = group.results.filter((r) => r.percentage >= 50).length;
    group.totalSubmissions = total;
    group.avgPercentage = Math.round(avgPct * 10) / 10;
    group.passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;
    list.push(group);
  }
  return list.sort((a, b) => b.totalSubmissions - a.totalSubmissions);
}

// ── Status Distribution (Good to Go / Needs Improvement / Needs Training) ─────

export interface StatusDistribution {
  goodToGo: number;      // >= 70%
  needsImprovement: number; // 50–69%
  needsTraining: number; // < 50%
}

export function computeStatusDistribution(results: NormalizedResult[]): StatusDistribution {
  let goodToGo = 0, needsImprovement = 0, needsTraining = 0;
  for (const r of results) {
    const p = r.percentage;
    if (p >= 70) goodToGo++;
    else if (p >= 50) needsImprovement++;
    else needsTraining++;
  }
  return { goodToGo, needsImprovement, needsTraining };
}

// ── Overall Tag Stats (cross-result, for dashboard insight) ──────────────────

export function computeOverallTagStats(results: NormalizedResult[]): TagStat[] {
  const allQs = results.flatMap((r) => r.questions);
  return buildTagStats(allQs);
}

// ── Insight counts ────────────────────────────────────────────────────────────

export interface InsightCount {
  best: number;
  good: number;
  average: number;
  poor: number;
}

export function computeInsightCounts(results: NormalizedResult[]): InsightCount {
  const counts = { best: 0, good: 0, average: 0, poor: 0 };
  for (const r of results) {
    const ic = getInsightCategory(r.percentage);
    if (ic.category === "Best") counts.best++;
    else if (ic.category === "Good") counts.good++;
    else if (ic.category === "Average") counts.average++;
    else counts.poor++;
  }
  return counts;
}
