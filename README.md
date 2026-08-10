# SEED-IT Admin Hub

Build a production-grade, state-of-the-art Admin Portal for "SEED-IT Platform" using React, TailwindCSS (with Shadcn UI or Material UI), Lucide Icons, Recharts, and Firebase (Firestore + Firebase Auth v2).

The application must be completely serverless, driven natively by Firebase Firestore for data storage and Firebase Auth for credentials and role-based access control.

---

## 🎯 1. Platform Purpose & User Roles

The SEED-IT Admin Portal enables educational admins and staff to:

1. Manage Institutional Tenants (Colleges) and Cohorts (Academic Years & Departments).

2. Provision Student Accounts (Singularly & via Excel `.xlsx` Roster Uploads) and manage Premium Feature Licenses.

3. Author & Publish Assessments (MCQ, Coding, Spoken English / SEA).

4. Assign Assessment Modules to specific College Cohorts (`allowedModules`).

5. View Real-time Student Performance Reports, Proctoring Logs, and Exam Violation History.

### User Roles:

- `admin` / `superadmin`: Unrestricted access across all pages, tenants, and system settings.

- `staff`: Access restricted to assigned College Tenant for managing assessments, viewing student performance, and reviewing proctoring logs.

---

## 🗄️ 2. Firestore v2 Database Schema

All database reads and writes MUST conform strictly to the following Firestore schema:

### Collection: `tenants` (`tenants/{tenantId}`)

- `id` (string, e.g., `"KITE"`): Stable uppercase slug used everywhere.

- `name` (string, e.g., `"KG Kit College"`).

- `slug` (string, e.g., `"kite"`).

- `createdAt` (timestamp).

- `active` (boolean).

- `settings` (map: `{ gracePeriodSeconds: 900, maxViolations: 5, proctorMode: "face+audio" }`).

#### Subcollection: `tenants/{tenantId}/cohorts/{cohortId}`

- `id` (string, e.g., `"2K22"` or `"2K22-CSE"`).

- `label` (string, e.g., `"2K22 - CSE, ECE, IT"`).

- `year` (string, e.g., `"2K22"`).

- `departments` (array of strings, e.g., `["CSE", "ECE", "IT", "MECH"]`).

- `allowedModules` (array of strings: assessment/module IDs enabled for this cohort).

- `batchStart` (string/ISO date).

- `batchEnd` (string/ISO date).

### Collection: `users` (`users/{uid}`)

- `uid` (string: Firebase Auth user ID or sanitized email key `user_email_com`).

- `email` (string, required).

- `displayName` (string).

- `role` (string: `"student"` | `"staff"` | `"admin"`).

- `tenantId` (string: assigned college slug).

- `cohortId` (string: assigned cohort ID).

- `college` (string: fallback tenant slug).

- `year` (string: fallback cohort year).

- `department` (string: branch, e.g., `"CSE"`).

- `rollNumber` (string).

- `premium` (boolean: Premium feature access license).

- `createdAt` (timestamp).

- `lastLoginAt` (timestamp | null).

### Collection: `assessments` (`assessments/{assessmentId}`)

- `id` (string, e.g., `"ast_mcq_midterm_2026"`).

- `title` (string).

- `type` (string: `"mcq"` | `"coding"` | `"multisection"` | `"spoken-english"`).

- `tenantId` (string: college slug or `"ALL"`).

- `durationMinutes` (number).

- `totalMarks` (number).

- `status` (string: `"draft"` | `"active"` | `"archived"`).

- `scheduledStart` (timestamp / ISO date).

- `scheduledEnd` (timestamp / ISO date).

- `proctorConfig` (map: `{ enabled: true, cameraRequired: true, tabSwitchLimit: 3, maxViolations: 5, autoSubmitOnViolation: true }`).

#### Subcollection: `assessments/{assessmentId}/sections/{sectionId}`

- Contains questions, coding test cases, options, and marking schemes.

### Collection: `assessmentResults` (`assessmentResults/{assessmentId}/students/{userId}`)

- Single canonical result path storing student score summary, section breakdowns, time taken, and submission status (`"completed"` | `"auto-submitted"`).

### Collection: `proctoringLogs` (`proctoringLogs/{attemptId}/events/{eventId}`)

- Real-time proctoring events logged during exams (`"TAB_SWITCH"`, `"MULTIPLE_FACES"`, `"NO_FACE"`).

---

## 🔐 3. Authentication & Secondary Session Pattern

- Admin login uses `signInWithEmailAndPassword(auth, email, password)`.

- **CRITICAL Pattern for Student Creation**: When creating students individually or processing bulk Excel uploads, DO NOT use the active Auth instance (which causes the Admin to log out). Use an **isolated secondary Firebase App instance** (`initializeApp(config, "SecondaryAuthApp")`) to register student credentials in Firebase Auth and save their profiles to `users/{uid}` in Firestore.

---

## 🖥️ 4. Page Architecture & Feature Specifications

### 📊 Page 1: Executive Dashboard (`/dashboard`)

- **Metric Cards**: Total Tenants, Registered Students, Active Assessments, Staff Count, and Active Premium Licenses.

- **Charts**: Student distribution by College Tenant and Test Submissions over time (Recharts).

- **Recent Activity Feed**: Real-time log of published assessments and student uploads.

### 🏫 Page 2: Colleges & Cohorts Manager (`/colleges`)

- **Tenant Management**: Create/Edit Colleges with Name, Slug, and Default Proctor Settings.

- **Cohort Builder**: Add Cohorts (`2K21`, `2K22`, `2K23`, etc.) with department tags (`CSE`, `ECE`, `IT`, `MECH`, `EEE`) and Batch Validity dates.

- **Analytics & Module Counter**: Display allowed module count per college/cohort.

### 👥 Page 3: Student Roster & License Portal (`/students`)

- **Tab 1: Roster View**:

  - Filter dropdowns: College Tenant -> Cohort Year -> Department (`ALL` or specific).

  - Search bar: Filter by Name, Email, or Roll Number.

  - Table & Grid Cards view modes.

  - Add Single Student Modal: Email, Password, Name, Roll No, Department Select, Cohort Select, Premium Toggle.

  - Edit & Delete student profile actions.

- **Tab 2: Bulk Roster Excel Upload**:

  - Drag-and-Drop `.xlsx` parser using `sheetjs` / `xlsx`.

  - Column auto-mapping (`Email`, `Name`, `Roll Number`, `College`, `Year`, `Department`, `Premium`).

  - Account provisioning in Firebase Auth + Firestore batch write with live progress bar and inline error logs.

- **Tab 3: Premium License Manager**:

  - Filtered Bulk Update: Select Tenant + Cohort + Dept -> toggle Premium status on/off for matching students in 1 click.

  - Email Batch Update: Paste list of emails or upload an Excel of email IDs to update Premium licenses.

### ⚙️ Page 4: Module Assignment Matrix (`/assign-modules`)

- **Selection**: Choose College Tenant and Cohort Year.

- **Dual-List Transfer Box**: Left column showing Available Assessments, Right column showing Assigned Modules (`allowedModules`).

- **One-Click Sync**: Updates `tenants/{tenantId}/cohorts/{cohortId}.allowedModules` in Firestore.

### 👨‍🏫 Page 5: Staff Management (`/staff-management`)

- Create and assign faculty accounts with tenant access scopes (`role: 'staff'`).

### 📝 Page 6: Assessment Creators (`/mcq-creator`, `/coding-creator`, `/sea-creator`)

- **MCQ Creator**: Multi-section question authoring, positive/negative marking, explanation text, and options setup.

- **Coding Creator**: Code problem statement, starter code templates (Python, C++, Java, JS), input/output test cases (hidden & visible), memory & time limits.

- **SEA Creator**: Spoken English Audio prompts and voice evaluation criteria.

- **Proctoring Settings Bar**: Toggle Camera Monitoring, Audio Monitoring, Tab Switch Limit, and Max Violation Auto-Submit limit.

### 📊 Page 7: Reports & Student Analysis (`/reports`)

- Performance overview by College, Cohort, and Assessment.

- Detailed score breakdown, rank list, pass/fail ratios, and proctoring violation logs.

- Export results to Excel `.xlsx` and PDF reports.

---

## 🎨 Design System & UI Aesthetics

- **Theme**: Modern Indigo primary (`#6366f1`), Slate background (`#f8fafc`), clean dark text (`#0f172a`), with subtle glassmorphism and rounded card containers (`rounded-2xl`).

- **Feedback**: Include Toast / Snackbar notifications for all CRUD operations, inline error badges, and clean loading skeletons.

- **Responsive**: Fully desktop-optimized layout with collapsable sidebar navigation.

Build the application clean, modular, fully typed, and ready to deploy with zero hardcoded legacy paths!



use the https://github.com/seeditDev/seed-it-admin for how the application works and uses. reports tab. assessment creation etc.  now i will share the implementation for the requirement.

@secret:GITHUB_PERSONAL_ACCESS_TOKEN  - git pat

below is the assessment platform that's going to work based on above sturcture.

# SEED-IT Platform — Recommended Firestore Schema (v2)

> Designed from scratch for the full SEED-IT SEB platform.  
> Covers every data entity: institutions, students, assessments, results, proctoring, practice, live presence, and API config.

---

## Design Principles

| Principle | Decision |
|---|---|
| **Assessment-first reads** | Results indexed by `assessmentId` so staff can pull all results for an exam in one collection query |
| **Student-first reads** | Results mirrored on the student doc as a subcollection for dashboard/history |
| **No denormalized paths in doc IDs** | Only use stable, opaque IDs — no `college/year/dept` embedded in document IDs |
| **Tenant isolation** | All student data carries `tenantId` (college slug) and `cohortId` (year-dept slug) as queryable fields |
| **Subcollections for unbounded data** | Events, violations, attempts, and submissions live in subcollections — never in array fields |
| **Single write, dual read** | One canonical write path; no silent dual-writes to legacy paths |

---

## Top-Level Collections

```
Firestore Root
├── tenants/                        ← Institutions / Colleges
├── users/                          ← All user accounts (students + staff)
├── assessments/                    ← Assessment definitions
├── assessmentResults/              ← All results, indexed by assessmentId
├── codingChallenges/               ← Practice problem bank
├── codingProgress/                 ← Per-user practice progress (aggregated)
├── livePresence/                   ← Real-time active session tracking
├── proctoringLogs/                 ← Violation event logs per attempt
└── systemConfig/                   ← API keys, feature flags, platform config
```

---

## 1. `tenants/{tenantId}` — Institution Registry

```
tenants/{tenantId}
├── name: "Sri Ramachandra University"
├── slug: "src-univ"                    ← used as tenantId everywhere
├── logoUrl: "https://..."
├── active: true
├── createdAt: Timestamp
├── settings: {
│     gracePeriodSeconds: 900,
│     maxViolations: 5,
│     proctorMode: "face+audio",       ← "face" | "audio" | "face+audio" | "off"
│     allowedBrowsers: ["electron"]
│   }
│
└── subcollections:
    ├── cohorts/{cohortId}             ← year+department combos
    │   ├── label: "2024 - CSE"
    │   ├── year: "2024"
    │   ├── department: "CSE"
    │   ├── active: true
    │   └── studentCount: 120
    │
    └── staff/{staffId}               ← Staff members belonging to this tenant
        ├── email: "hod@src.edu"
        ├── role: "admin"             ← "admin" | "faculty" | "proctor"
        └── addedAt: Timestamp
```

---

## 2. `users/{userId}` — All User Accounts

> **userId** = sanitized email (e.g. `john_doe_src_edu`). Using email as ID preserves lookups without a secondary index.

```
users/{userId}
├── email: "john.doe@src.edu"
├── displayName: "John Doe"
├── photoUrl: "https://..."
├── role: "student"                   ← "student" | "staff" | "admin"
├── tenantId: "src-univ"
├── cohortId: "2024-cse"              ← points to tenants/{t}/cohorts/{c}
├── department: "CSE"
├── year: "2024"
├── college: "Sri Ramachandra University"
├── rollNumber: "21CSR042"
├── createdAt: Timestamp
├── lastLoginAt: Timestamp
├── activeSessionId: "sess_abc123"    ← set on login, cleared on logout
├── apiKeys: {                        ← AI tutor / external API credentials
│     openai: "sk-...",
│     gemini: "AIza..."
│   }
│
└── subcollections:
    ├── assessmentAttempts/{assessmentId}   ← ONE doc per assessment taken
    │   ├── assessmentId: "...",
    │   ├── type: "multi-section"           ← "mcq" | "coding" | "multi-section" | "spoken-english"
    │   ├── title: "Unit Test 1"
    │   ├── tenantId: "src-univ"
    │   ├── startedAt: Timestamp
    │   ├── submittedAt: Timestamp
    │   ├── status: "submitted"             ← "in-progress" | "submitted" | "auto-submitted" | "expired"
    │   ├── totalScore: 42
    │   ├── maxScore: 60
    │   ├── percentage: 70.0
    │   └── resultRef: "assessmentResults/{assessmentId}/students/{userId}"
    │
    ├── practiceProgress/{questionId}      ← One doc per practice question
    │   ├── questionId: "..."
    │   ├── status: "solved"               ← "unseen" | "attempted" | "solved"
    │   ├── lastAttemptAt: Timestamp
    │   ├── bestScore: 100
    │   ├── attempts: 3
    │   └── language: "python"
    │
    └── sessions/{sessionId}               ← Login session history
        ├── startedAt: Timestamp
        ├── endedAt: Timestamp
        ├── deviceInfo: { os, browser, version }
        └── ipAddress: "..."
```

---

## 3. `assessments/{assessmentId}` — Assessment Definitions

```
assessments/{assessmentId}
├── id: "unit-test-1-cse-2024"
├── title: "Unit Test 1 — Data Structures"
├── type: "multi-section"               ← "mcq" | "coding" | "multi-section" | "spoken-english"
├── tenantId: "src-univ"
├── cohortIds: ["2024-cse", "2024-it"]  ← which cohorts can take this
├── createdBy: "staff@src.edu"
├── createdAt: Timestamp
├── scheduledStart: Timestamp
├── scheduledEnd: Timestamp
├── durationMinutes: 120
├── totalMarks: 100
├── status: "active"                    ← "draft" | "active" | "closed"
├── proctorConfig: {
│     mode: "face+audio",
│     faceThreshold: 0.8,
│     maxFaceViolations: 5,
│     gracePeriodSeconds: 900
│   }
│
└── subcollections:
    └── sections/{sectionId}            ← Each section within the assessment
        ├── order: 1
        ├── title: "MCQ Section"
        ├── type: "mcq"                 ← "mcq" | "coding" | "spoken-english"
        ├── durationMinutes: 45
        ├── totalMarks: 40
        └── questions: [...]            ← embedded array OK for fixed question sets
```

---

## 4. `assessmentResults/{assessmentId}/students/{userId}` — Canonical Results

> **Primary read path for staff**: query `assessmentResults/{assessmentId}/students` to get all results for an exam in one collection group query.

```
assessmentResults/{assessmentId}
├── _meta: {                            ← top-level doc for assessment metadata cache
│     title: "Unit Test 1",
│     tenantId: "src-univ",
│     totalMarks: 100,
│     closedAt: Timestamp
│   }
│
└── students/{userId}
    ├── userId: "john_doe_src_edu"
    ├── email: "john.doe@src.edu"
    ├── displayName: "John Doe"
    ├── tenantId: "src-univ"
    ├── cohortId: "2024-cse"
    ├── department: "CSE"
    ├── year: "2024"
    ├── rollNumber: "21CSR042"
    │
    ├── assessmentId: "unit-test-1-cse-2024"
    ├── assessmentTitle: "Unit Test 1"
    ├── assessmentType: "multi-section"
    │
    ├── startedAt: Timestamp            ← exact ISO timestamp assessment began
    ├── startedAtISO: "2024-08-10T06:00:00Z"
    ├── submittedAt: Timestamp
    ├── submittedAtISO: "2024-08-10T08:00:00Z"
    ├── status: "submitted"
    ├── submissionReason: "manual"      ← "manual" | "auto-timeout" | "auto-offline" | "force-submit"
    │
    ├── totalScore: 42
    ├── maxScore: 100
    ├── percentage: 42.0
    ├── passed: true
    │
    ├── sections: [                     ← array of section-level results
    │   {
    │     sectionId: "sec-1",
    │     sectionTitle: "MCQ",
    │     sectionType: "mcq",
    │     order: 1,
    │     startedAt: Timestamp,
    │     startedAtISO: "2024-08-10T06:00:00Z",
    │     submittedAt: Timestamp,
    │     submittedAtISO: "2024-08-10T06:45:00Z",
    │     timeSpentSeconds: 2700,
    │     timeTakenFormatted: "45:00",
    │     score: 28,
    │     maxScore: 40,
    │     percentage: 70.0,
    │     totalQuestions: 20,
    │     attempted: 18,
    │     correct: 14,
    │     wrong: 4,
    │     skipped: 2,
    │     answers: { "q1": "A", "q2": "C", ... }
    │   },
    │   {
    │     sectionId: "sec-2",
    │     sectionTitle: "Coding",
    │     sectionType: "coding",
    │     order: 2,
    │     startedAt: Timestamp,
    │     startedAtISO: "2024-08-10T06:46:00Z",
    │     submittedAt: Timestamp,
    │     submittedAtISO: "2024-08-10T08:00:00Z",
    │     timeSpentSeconds: 4440,
    │     timeTakenFormatted: "74:00",
    │     score: 14,
    │     maxScore: 60,
    │     percentage: 23.3,
    │     challenges: [
    │       {
    │         challengeId: "...",
    │         title: "Two Sum",
    │         language: "python",
    │         score: 10,
    │         maxScore: 20,
    │         testsPassed: 5,
    │         totalTests: 8,
    │         finalCode: "def two_sum(...",
    │         submittedAt: Timestamp
    │       }
    │     ]
    │   }
    │ ]
    │
    ├── proctorSummary: {
    │     totalViolations: 2,
    │     faceViolations: 1,
    │     audioViolations: 1,
    │     tabSwitches: 0,
    │     screenshotCount: 12,
    │     overallRiskLevel: "low"       ← "clean" | "low" | "medium" | "high"
    │   }
    │
    └── submittedAt: Timestamp
```

---

## 5. `codingChallenges/{challengeId}` — Practice Problem Bank

```
codingChallenges/{challengeId}
├── id: "two-sum"
├── title: "Two Sum"
├── slug: "two-sum"
├── difficulty: "easy"               ← "easy" | "medium" | "hard"
├── category: "arrays"
├── tags: ["hash-map", "two-pointer"]
├── companies: ["Google", "Amazon"]
├── description: "..."               ← markdown
├── inputFormat: "..."
├── outputFormat: "..."
├── constraints: "..."
├── examples: [ { input, output, explanation } ]
├── starterCode: { python: "...", java: "...", cpp: "..." }
├── solutionCode: { python: "..." }  ← staff-only, security rules enforced
├── testCases: [                     ← visible test cases
│     { id: "tc1", input: "...", expected: "...", isHidden: false }
│   ]
├── hiddenTestCases: [...]           ← hidden test cases, security rules enforced
├── maxScore: 20
├── createdBy: "staff@src.edu"
├── createdAt: Timestamp
└── active: true
```

---

## 6. `codingProgress/{userId}` — Aggregated Practice Progress

```
codingProgress/{userId}
├── userId: "john_doe_src_edu"
├── email: "john.doe@src.edu"
├── tenantId: "src-univ"
├── totalSolved: 42
├── totalAttempted: 60
├── byDifficulty: { easy: 20, medium: 15, hard: 7 }
├── byCategory: { arrays: 10, graphs: 5, ... }
├── streak: { current: 5, longest: 12 }
├── lastActiveAt: Timestamp
├── updatedAt: Timestamp
│
└── questions: {                     ← flat map of questionId → status (for fast lookup)
      "two-sum": { status: "solved", attempts: 3, bestScore: 20, solvedAt: Timestamp },
      "binary-search": { status: "attempted", attempts: 1, bestScore: 10 }
    }
```

> **Note**: The nested `questions` map works because Firestore supports partial field updates via `merge: true`. For very active students (1000+ questions), migrate this to a `questions/{questionId}` subcollection.

---

## 7. `livePresence/{dateStr}/sessions/{sessionId}` — Real-Time Active Users

```
livePresence/{dateStr}                ← e.g. "2024-08-10"
└── sessions/{sessionId}
    ├── userId: "john_doe_src_edu"
    ├── email: "john.doe@src.edu"
    ├── tenantId: "src-univ"
    ├── cohortId: "2024-cse"
    ├── assessmentId: "unit-test-1"   ← null if just browsing
    ├── page: "/student/assessment/..."
    ├── connectedAt: Timestamp
    ├── lastHeartbeatAt: Timestamp    ← updated every 30s; TTL rule cleans up stale docs
    └── deviceInfo: { os, browser }
```

> **TTL**: Set a Firestore TTL policy on `lastHeartbeatAt` with 5-minute expiry to auto-purge dead sessions.

---

## 8. `proctoringLogs/{attemptId}` — Violation Events

> `attemptId` = `{assessmentId}_{userId}`

```
proctoringLogs/{attemptId}
├── userId: "john_doe_src_edu"
├── assessmentId: "unit-test-1"
├── tenantId: "src-univ"
│
└── events/{eventId}                  ← subcollection, one doc per violation event
    ├── type: "face-not-detected"     ← "face-not-detected" | "multiple-faces" | "audio-spike"
    │                                    | "tab-switch" | "fullscreen-exit" | "copy-paste"
    ├── severity: "medium"            ← "info" | "low" | "medium" | "high"
    ├── timestamp: Timestamp
    ├── sectionId: "sec-1"
    ├── snapshotUrl: "https://..."    ← Firebase Storage URL
    └── metadata: { confidence: 0.92, faceCount: 0 }
```

---

## 9. `systemConfig/{configId}` — Platform-Level Configuration

```
systemConfig/featureFlags
├── enableAiTutor: true
├── enablePracticeContests: true
├── enableSpokenEnglish: false
└── maintenanceMode: false

systemConfig/judgeLimits
├── maxExecutionTimeMs: 5000
├── maxMemoryMb: 256
└── allowedLanguages: ["python", "java", "cpp", "javascript"]
```

---

## Current → Recommended Path Migration Map

| Current (Legacy) Path | Recommended Path |
|---|---|
| `AssessmentResults/{aId}/colleges/{c}/years/{y}/students/{email}` | `assessmentResults/{aId}/students/{userId}` |
| `colleges/{c}/years/{y}/departments/{d}/students/{email}/mcq_results/{aId}` | *(removed — mirror in `users/{userId}/assessmentAttempts/{aId}`)* |
| `colleges/{c}/years/{y}/departments/{d}/students/{email}/coding_results/{aId}` | *(removed — same mirror)* |
| `colleges/{c}/years/{y}/departments/{d}/students/{email}/sea_results/{aId}` | *(removed — same mirror)* |
| `users/{email}/contestAttempts/{aId}` | `users/{userId}/assessmentAttempts/{aId}` |
| `users/{email}/codingAttempts/{questionId}` | `users/{userId}/practiceProgress/{questionId}` |
| `codingProgress/{uid}` | `codingProgress/{userId}` *(same, minor field restructure)* |
| `proctor_logs/{studentId}/{testId}/...` | `proctoringLogs/{attemptId}/events/{eventId}` |
| `LiveUsers/{date}/colleges/{c}/years/{y}/users/{email}` | `livePresence/{date}/sessions/{sessionId}` |
| `assessmentAttempts/{docId}` *(SEA)* | `assessmentResults/{aId}/students/{userId}` |
| `userApiKeys/{email}` | `users/{userId}.apiKeys` *(embedded field)* |

---

## Firestore Security Rules Summary

```js
// assessmentResults — staff read all; student reads only their own doc
match /assessmentResults/{assessmentId}/students/{userId} {
  allow read: if isStaff() || request.auth.uid == userId;
  allow write: if isAuthenticated();  // service account writes in prod
}

// users — users read/write own doc only
match /users/{userId} {
  allow read, write: if request.auth.uid == userId || isStaff();
}

// codingChallenges — public read, staff write
match /codingChallenges/{id} {
  allow read: if isAuthenticated();
  allow write: if isStaff();
  // hiddenTestCases field: deny field-level read for students via field masks
}

// proctoringLogs — write only during active session; staff read
match /proctoringLogs/{attemptId}/events/{eventId} {
  allow write: if isAuthenticated();
  allow read: if isStaff();
}
```

---

## Composite Index Requirements

| Collection | Fields Indexed | Query |
|---|---|---|
| `assessmentResults/{aId}/students` | `tenantId ASC`, `percentage DESC` | Ranked leaderboard per tenant |
| `assessmentResults/{aId}/students` | `cohortId ASC`, `totalScore DESC` | Per-cohort rankings |
| `users` | `tenantId ASC`, `lastLoginAt DESC` | Active students per tenant |
| `livePresence/{date}/sessions` | `tenantId ASC`, `assessmentId ASC` | Live exam monitoring |
| `proctoringLogs/{aId}/events` | `type ASC`, `timestamp DESC` | Violation report by type |

---

## Key Improvements Over Current Structure

| Area | Current Problem | Fix |
|---|---|---|
| **Dual write paths** | Results written to 2-3 different paths (canonical + legacy + SEA) → divergence risk | Single canonical path with one mirror subcollection |
| **College/year in doc ID** | `colleges/{c}/years/{y}/...` makes cross-cohort queries impossible | All results have `tenantId` + `cohortId` as **fields**, not path segments |
| **Scattered section timing** | `startTimeISO` missing from many paths | Every result doc mandates `startedAtISO`, `submittedAtISO`, and per-section timing |
| **User API keys in top-level collection** | `userApiKeys/{email}` is a separate collection | Merged into `users/{userId}.apiKeys` — one fewer collection, one fewer read |
| **Live tracking depth** | `LiveUsers/{date}/colleges/{c}/years/{y}/users/{email}` is 6 levels deep | Flattened to `livePresence/{date}/sessions/{sessionId}` — 3 levels |
| **Proctor logs** | `proctor_logs/{studentId}/{testId}` — student-centric, hard to query by assessment | `proctoringLogs/{attemptId}/events` — assessment-centric, O(1) to pull all violations for an exam |
| **Practice progress** | Split between `codingProgress/{uid}` (aggregated) and `users/{email}/codingAttempts/{id}` (per-question) | Unified in `codingProgress/{userId}` with `questions` map + `users/{userId}/practiceProgress` subcollection |

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b673f9e4-158d-41eb-a21e-9859e6fcd355).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
