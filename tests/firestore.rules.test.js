/**
 * firestore.rules.test.js
 *
 * Firebase Emulator security-rule tests for SEED-IT Platform.
 *
 * Run:
 *   npx jest tests/firestore.rules.test.js
 *   (Requires Firebase Emulator: firebase emulators:start --only firestore)
 *
 * Install deps:
 *   npm install --save-dev @firebase/rules-unit-testing firebase jest
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');

const ADMIN_UID = 'admin-001';
const STAFF_UID = 'staff-001';
const STUDENT_A = 'student-a-uid';
const STUDENT_B = 'student-b-uid';
const TENANT_ID = 'TN000001';
const OTHER_TID  = 'TN000099';

function token(uid, role, tenantId = '') {
  return { uid, token: { email: `${uid}@test.com`, role, tenantId } };
}

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'seed-it-test',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => { await testEnv.cleanup(); });
afterEach(async () => { await testEnv.clearFirestore(); });

function asAdmin()    { return testEnv.authenticatedContext(ADMIN_UID, token(ADMIN_UID, 'admin', TENANT_ID)).firestore(); }
function asStaff()    { return testEnv.authenticatedContext(STAFF_UID, token(STAFF_UID, 'staff', TENANT_ID)).firestore(); }
function asStudentA() { return testEnv.authenticatedContext(STUDENT_A, token(STUDENT_A, 'student', TENANT_ID)).firestore(); }
function asStudentB() { return testEnv.authenticatedContext(STUDENT_B, token(STUDENT_B, 'student', OTHER_TID)).firestore(); }
function asGuest()    { return testEnv.unauthenticatedContext().firestore(); }

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const parts = path.split('/');
    const ref = db.doc(path);
    await ref.set(data);
  });
}

// ════════════════════════════════════════════════════════════
// STUDENT: profile access
// ════════════════════════════════════════════════════════════
describe('STUDENT: profile access', () => {
  beforeEach(async () => {
    await seed(`users/${STUDENT_A}`, { role: 'student', tenantId: TENANT_ID, uid: STUDENT_A });
    await seed(`users/${STUDENT_B}`, { role: 'student', tenantId: OTHER_TID,  uid: STUDENT_B });
  });

  test('can read own profile', async () => {
    await assertSucceeds(asStudentA().doc(`users/${STUDENT_A}`).get());
  });

  test('cannot read another student profile', async () => {
    await assertFails(asStudentA().doc(`users/${STUDENT_B}`).get());
  });

  test('cannot list all users', async () => {
    await assertFails(asStudentA().collection('users').get());
  });

  test('cannot escalate own role', async () => {
    await assertFails(asStudentA().doc(`users/${STUDENT_A}`).update({ role: 'admin' }));
  });
});

// ════════════════════════════════════════════════════════════
// STUDENT: attempt lifecycle
// ════════════════════════════════════════════════════════════
describe('STUDENT: attempt lifecycle', () => {
  const ap = `users/${STUDENT_A}/contestAttempts/test-001`;

  beforeEach(async () => {
    await seed(`users/${STUDENT_A}`, { role: 'student', tenantId: TENANT_ID });
  });

  test('can create own attempt', async () => {
    await assertSucceeds(asStudentA().doc(ap).set({ assessmentId: 'test-001', completed: false }));
  });

  test('can update active attempt', async () => {
    await seed(ap, { assessmentId: 'test-001', completed: false });
    await assertSucceeds(asStudentA().doc(ap).update({ timeRemainingSeconds: 1500 }));
  });

  test('cannot un-complete a submitted attempt', async () => {
    await seed(ap, { assessmentId: 'test-001', completed: true });
    await assertFails(asStudentA().doc(ap).update({ completed: false }));
  });

  test('cannot write to another student attempt', async () => {
    await assertFails(asStudentB().doc(ap).set({ assessmentId: 'test-001', completed: false }));
  });

  test('cannot read another student attempt', async () => {
    await seed(ap, { assessmentId: 'test-001', completed: false });
    await assertFails(asStudentB().doc(ap).get());
  });
});

// ════════════════════════════════════════════════════════════
// STUDENT: assessment content enumeration
// ════════════════════════════════════════════════════════════
describe('STUDENT: content access', () => {
  beforeEach(async () => {
    await seed(`users/${STUDENT_A}`, { role: 'student', tenantId: TENANT_ID });
    await seed('assessments/assess-001', { name: 'Test', guestEnabled: false });
    await seed('questionBank/q-001', { text: 'Q1' });
    await seed('codingChallenges/cc-001', { title: 'FizzBuzz' });
    await seed(`tenantCourses/${OTHER_TID}/tests/t-001`, { name: 'Other', guestEnabled: false });
    await seed(`tenantCourses/${TENANT_ID}/tests/t-002`, { name: 'Mine', guestEnabled: false });
  });

  test('can get assessment by ID', async () => {
    await assertSucceeds(asStudentA().doc('assessments/assess-001').get());
  });

  test('cannot list all assessments', async () => {
    await assertFails(asStudentA().collection('assessments').get());
  });

  test('cannot list questionBank', async () => {
    await assertFails(asStudentA().collection('questionBank').get());
  });

  test('can get questionBank by ID', async () => {
    await assertSucceeds(asStudentA().doc('questionBank/q-001').get());
  });

  test('cannot list codingChallenges', async () => {
    await assertFails(asStudentA().collection('codingChallenges').get());
  });

  test('cannot read another tenant tests', async () => {
    await assertFails(asStudentA().doc(`tenantCourses/${OTHER_TID}/tests/t-001`).get());
  });

  test('can read own tenant tests', async () => {
    await assertSucceeds(asStudentA().doc(`tenantCourses/${TENANT_ID}/tests/t-002`).get());
  });
});

// ════════════════════════════════════════════════════════════
// STUDENT: result write semantics
// ════════════════════════════════════════════════════════════
describe('STUDENT: result write', () => {
  const rp = `assessmentResults/test-001/students/${STUDENT_A}`;

  beforeEach(async () => {
    await seed(`users/${STUDENT_A}`, { role: 'student', tenantId: TENANT_ID });
  });

  test('can create own result', async () => {
    await assertSucceeds(asStudentA().doc(rp).set({ userId: STUDENT_A, score: 80, status: 'submitted' }));
  });

  test('cannot create result for another student', async () => {
    await assertFails(asStudentA().doc(`assessmentResults/test-001/students/${STUDENT_B}`).set({
      userId: STUDENT_B, score: 100, status: 'submitted',
    }));
  });

  test('cannot update submitted result', async () => {
    await seed(rp, { userId: STUDENT_A, score: 80, status: 'submitted' });
    await assertFails(asStudentA().doc(rp).update({ score: 100 }));
  });

  test('can update in-progress result', async () => {
    await seed(rp, { userId: STUDENT_A, score: 0, status: 'in_progress' });
    await assertSucceeds(asStudentA().doc(rp).update({ score: 50, status: 'in_progress' }));
  });
});

// ════════════════════════════════════════════════════════════
// STUDENT: tenantResults ownership
// ════════════════════════════════════════════════════════════
describe('STUDENT: tenantResults write', () => {
  beforeEach(async () => {
    await seed(`users/${STUDENT_A}`, { role: 'student', tenantId: TENANT_ID });
  });

  test('can write own result to own tenant', async () => {
    await assertSucceeds(asStudentA().collection(`tenantResults/${TENANT_ID}/results`).add({
      userId: STUDENT_A, tenantId: TENANT_ID, score: 75, assessmentId: 'test-001',
    }));
  });

  test('cannot write to another tenant', async () => {
    await assertFails(asStudentA().collection(`tenantResults/${OTHER_TID}/results`).add({
      userId: STUDENT_A, tenantId: OTHER_TID, score: 75, assessmentId: 'test-001',
    }));
  });

  test('cannot spoof another userId', async () => {
    await assertFails(asStudentA().collection(`tenantResults/${TENANT_ID}/results`).add({
      userId: STUDENT_B, tenantId: TENANT_ID, score: 100, assessmentId: 'test-001',
    }));
  });
});

// ════════════════════════════════════════════════════════════
// STUDENT: codingProgress isolation
// ════════════════════════════════════════════════════════════
describe('STUDENT: codingProgress isolation', () => {
  beforeEach(async () => {
    await seed(`users/${STUDENT_A}`, { role: 'student', tenantId: TENANT_ID });
    await seed(`codingProgress/${STUDENT_A}`, { solvedProblems: ['q1'] });
    await seed(`codingProgress/${STUDENT_B}`, { solvedProblems: ['q2'] });
  });

  test('can read own codingProgress', async () => {
    await assertSucceeds(asStudentA().doc(`codingProgress/${STUDENT_A}`).get());
  });

  test('cannot read another student codingProgress', async () => {
    await assertFails(asStudentA().doc(`codingProgress/${STUDENT_B}`).get());
  });

  test('cannot write another student codingProgress', async () => {
    await assertFails(asStudentA().doc(`codingProgress/${STUDENT_B}`).set({ solvedProblems: [] }));
  });
});

// ════════════════════════════════════════════════════════════
// STUDENT: livePresence
// ════════════════════════════════════════════════════════════
describe('STUDENT: livePresence', () => {
  beforeEach(async () => {
    await seed(`users/${STUDENT_A}`, { role: 'student', tenantId: TENANT_ID });
  });

  test('cannot read all sessions', async () => {
    await assertFails(asStudentA().collection('livePresence/2026-08-12/sessions').get());
  });

  test('can write own session heartbeat', async () => {
    await assertSucceeds(asStudentA().doc(`livePresence/2026-08-12/sessions/${STUDENT_A}`).set({
      userId: STUDENT_A, tenantId: TENANT_ID, lastSeen: '2026-08-12T00:00:00Z',
    }));
  });

  test('cannot write session with wrong userId', async () => {
    await assertFails(asStudentA().doc('livePresence/2026-08-12/sessions/other').set({
      userId: STUDENT_B, tenantId: TENANT_ID, lastSeen: '2026-08-12T00:00:00Z',
    }));
  });
});

// ════════════════════════════════════════════════════════════
// GUEST: unauthenticated access
// ════════════════════════════════════════════════════════════
describe('GUEST: access rules', () => {
  beforeEach(async () => {
    await seed(`publicTenants/${TENANT_ID}`, { name: 'Test College', slug: 'tc', active: true });
    await seed(`tenants/${TENANT_ID}`, { name: 'Test College', gateKey: 'SECRET', active: true });
    await seed(`tenantCourses/${TENANT_ID}/tests/t-pub`, { name: 'Guest Test', guestEnabled: true });
    await seed(`tenantCourses/${TENANT_ID}/tests/t-priv`, { name: 'Private', guestEnabled: false });
    await seed('questionBank/q-001', { text: 'Q1' });
  });

  test('can read publicTenants', async () => {
    await assertSucceeds(asGuest().doc(`publicTenants/${TENANT_ID}`).get());
  });

  test('cannot read private tenants', async () => {
    await assertFails(asGuest().doc(`tenants/${TENANT_ID}`).get());
  });

  test('can read guestEnabled test', async () => {
    await assertSucceeds(asGuest().doc(`tenantCourses/${TENANT_ID}/tests/t-pub`).get());
  });

  test('cannot read private (non-guest) test', async () => {
    await assertFails(asGuest().doc(`tenantCourses/${TENANT_ID}/tests/t-priv`).get());
  });

  test('can submit guest result', async () => {
    await assertSucceeds(asGuest().doc('assessmentResults/t-pub/guests/guest-001').set({
      guestId: 'guest-001', score: 80, status: 'submitted', isGuest: true,
    }));
  });

  test('cannot submit as a named student', async () => {
    await assertFails(asGuest().doc(`assessmentResults/t-pub/students/${STUDENT_A}`).set({
      userId: STUDENT_A, score: 100, status: 'submitted',
    }));
  });

  test('cannot read questionBank', async () => {
    await assertFails(asGuest().doc('questionBank/q-001').get());
  });

  test('cannot write to tenantResults', async () => {
    await assertFails(asGuest().collection(`tenantResults/${TENANT_ID}/results`).add({
      score: 100,
    }));
  });
});

// ════════════════════════════════════════════════════════════
// ADMIN: management access
// ════════════════════════════════════════════════════════════
describe('ADMIN: management', () => {
  beforeEach(async () => {
    await seed(`users/${ADMIN_UID}`, { role: 'admin', tenantId: TENANT_ID });
    await seed(`users/${STUDENT_A}`, { role: 'student', tenantId: TENANT_ID });
    await seed(`tenants/${TENANT_ID}`, { name: 'TC', active: true });
    await seed(`assessmentResults/t-001/students/${STUDENT_A}`, {
      userId: STUDENT_A, score: 80, status: 'submitted',
    });
  });

  test('can list tenants', async () => {
    await assertSucceeds(asAdmin().collection('tenants').get());
  });

  test('can read any student profile', async () => {
    await assertSucceeds(asAdmin().doc(`users/${STUDENT_A}`).get());
  });

  test('can list all users', async () => {
    await assertSucceeds(asAdmin().collection('users').get());
  });

  test('can update submitted result', async () => {
    await assertSucceeds(asAdmin().doc(`assessmentResults/t-001/students/${STUDENT_A}`)
      .update({ reviewNote: 'OK', status: 'verified' }));
  });
});

// ════════════════════════════════════════════════════════════
// LEGACY: blocked paths
// ════════════════════════════════════════════════════════════
describe('LEGACY: blocked writes', () => {
  beforeEach(async () => {
    await seed(`users/${STUDENT_A}`, { role: 'student', tenantId: TENANT_ID });
    await seed(`users/${ADMIN_UID}`, { role: 'admin',   tenantId: TENANT_ID });
  });

  test('AssessmentResults v1 write blocked for students', async () => {
    await assertFails(asStudentA().doc(
      `AssessmentResults/t-001/colleges/${TENANT_ID}/years/2/students/s@test.com`
    ).set({ score: 100 }));
  });

  test('colleges/* write blocked', async () => {
    await assertFails(asStudentA().doc(
      `colleges/${TENANT_ID}/years/2/departments/CS/students/s@test.com/results/t-001`
    ).set({ score: 100 }));
  });

  test('LiveUsers write blocked', async () => {
    await assertFails(asStudentA().doc(
      `LiveUsers/2026-08-12/colleges/${TENANT_ID}/years/2/users/s_test_com`
    ).set({ lastSeen: '2026-08-12' }));
  });

  test('proctor_logs write blocked', async () => {
    await assertFails(asStudentA().doc(
      `proctor_logs/${STUDENT_A}/test_001/evt-001`
    ).set({ type: 'face-not-detected' }));
  });

  test('AssessmentResults v1 admin-readable', async () => {
    await seed(
      `AssessmentResults/t-001/colleges/${TENANT_ID}/years/2/students/s@test.com`,
      { score: 80 }
    );
    await assertSucceeds(asAdmin().doc(
      `AssessmentResults/t-001/colleges/${TENANT_ID}/years/2/students/s@test.com`
    ).get());
  });
});
