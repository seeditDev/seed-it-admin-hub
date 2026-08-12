/** ─── SEED-IT Report Engine Types ──────────────────────────────────────────── */

export interface NormalizedSection {
  name: string;
  score: number;
  totalMarks: number;
  percentage: number;
  timeTaken: string;
  timeTakenSeconds: number;
  status: "Pass" | "Fail";
  cefrLevel?: string | undefined;
  wpm?: number | undefined;
  fillerCount?: number | undefined;
}

export interface NormalizedQuestion {
  index: number;
  questionText: string;
  topic: string;
  tags: string[];
  isCorrect: boolean;
  selectedAnswer: string;
  correctAnswer: string;
  timeTakenSeconds: number;
  timeTaken: string;
  difficulty: string;
  marks: number;
}

export interface NormalizedCodingSubmission {
  questionNumber: number;
  problemTitle: string;
  language: string;
  timeComplexity: string;
  spaceComplexity: string;
  testsPassed: number;
  totalTests: number;
  score: number;
  maxMarks: number;
  accuracy: number;
  timeTakenSeconds: number;
  timeTaken: string;
  difficulty: string;
  attempted: boolean;
  code: string;
  submittedAt?: number | undefined;
}

export interface NormalizedResult {
  studentId: string;
  rollNumber: string;
  name: string;
  email: string;
  college: string;
  department: string;
  year: string;
  tenantId: string;

  assessmentId: string;
  testId: string;
  testName: string;
  assessmentType: string;
  assessmentVersion: number;

  startedAt: string;
  submittedAt: string;
  submittedAtDate: Date | null;
  timeTaken: string;
  timeTakenSeconds: number;

  score: number;
  totalMarks: number;
  percentage: number;
  partialScore: number;
  fullScore: number;
  correctAnswers: number;
  totalQuestions: number;
  initialScore: string;

  status: "PASS" | "FAIL";
  passed: boolean;

  violationCount: number;
  violationTime: string;
  autoSubmitted: boolean;

  insight: string;
  category: string;
  readinessCategory: string;
  readinessPkg: string;

  sections: NormalizedSection[];
  questions: NormalizedQuestion[];
  codingSubmissions: NormalizedCodingSubmission[];

  cefrLevel: string;
  cefrName: string;
  wpm: number;
  fillerCount: number;
}

export interface TagStat {
  tag: string;
  correct: number;
  total: number;
  accuracy: number;
  avgTimeSeconds: number;
}

export interface AssessmentGroup {
  testId: string;
  testName: string;
  type: string;
  results: NormalizedResult[];
  sections: NormalizedSection[];
  totalSubmissions: number;
  avgPercentage: number;
  passRate: number;
  colleges: Set<string>;
  depts: Set<string>;
  years: Set<string>;
}

export interface ReportFilters {
  testName?: string;
  college?: string;
  year?: string;
  passThreshold?: number;
}
