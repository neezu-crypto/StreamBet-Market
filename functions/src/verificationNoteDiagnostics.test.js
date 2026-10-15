const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyBettingVerificationNoteNoMatch } = require("./verificationNoteDiagnostics");

test("발신자에 대응하는 대기 신청이 없으면 구분한다", () => {
  assert.equal(classifyBettingVerificationNoteNoMatch({}, "byunja", 100), "no-pending-request-for-sender");
  assert.equal(classifyBettingVerificationNoteNoMatch({ other: { status: "pending", soopId: "other" } }, "byunja", 100), "no-pending-request-for-sender");
});

test("자동 쪽지 검증 대상이 아닌 요청은 구분한다", () => {
  assert.equal(classifyBettingVerificationNoteNoMatch({ a: { status: "pending", soopId: "byunja", noteEligible: false } }, "byunja", 100), "request-not-eligible-for-auto-verification");
});

test("인증 코드가 없거나 만료되면 구분한다", () => {
  const eligible = { status: "pending", soopId: "byunja", uid: "u1", requesterUid: "u1", noteEligible: true };
  assert.equal(classifyBettingVerificationNoteNoMatch({ a: eligible }, "byunja", 100), "pending-request-code-missing-or-expired");
  assert.equal(classifyBettingVerificationNoteNoMatch({ a: { ...eligible, noteVerificationCodeHash: "hash", noteVerificationCodeExpiresAt: 99 } }, "byunja", 100), "pending-request-code-missing-or-expired");
});

test("유효한 인증 코드가 후보와 일치하지 않으면 구분한다", () => {
  assert.equal(classifyBettingVerificationNoteNoMatch({ a: { status: "pending", soopId: "byunja", uid: "u1", requesterUid: "u1", noteEligible: true, noteVerificationCodeHash: "hash", noteVerificationCodeExpiresAt: 101 } }, "byunja", 100), "code-mismatch");
});
