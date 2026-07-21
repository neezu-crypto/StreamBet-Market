const { getDatabase } = require('firebase-admin/database');

// 10번 — 감사 로그는 클라이언트가 아니라 서버(Cloud Functions)가 직접 기록해야 신뢰할 수 있다.
async function logAudit(actorUid, actorName, action, detail) {
  const ref = getDatabase().ref('bettingMarket/auditLog').push();
  await ref.set({ actorUid, actorName: actorName || actorUid, action, detail: detail || '', at: Date.now() });
}

module.exports = { logAudit };
