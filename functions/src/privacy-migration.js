const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { isAdmin } = require('./lib/auth');
const { ensurePublicId, publicIdFor, publicVerificationRecord } = require('./lib/public-identity');
const { sanitizePublicMarket } = require('./markets');

const migrateBettingPublicIdentityData = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  const email = request.auth && request.auth.token && request.auth.token.email;
  if (!uid || !(await isAdmin(uid, email))) throw new HttpsError('permission-denied', '관리자만 사용할 수 있습니다.');
  const db = getDatabase();
  const [verificationSnap, profilesSnap, rankingsSnap, blockedSnap] = await Promise.all([
    db.ref('streamerVerifications').get(), db.ref('bettingMarket/profiles').get(),
    db.ref('bettingMarket/rankings').get(), db.ref('bettingMarket/blockedNicknames').get(),
  ]);
  const updates = {};
  verificationSnap.forEach((child) => {
    const record = child.val() || {};
    if (!record.uid) return;
    updates[`streamerVerificationsPublic/${child.key}`] = publicVerificationRecord(record);
    updates[`users/${record.uid}/streamerVerified`] = true;
    updates[`users/${record.uid}/streamerProfile`] = { nickname: record.nickname || '', soopId: record.soopId || null };
  });
  profilesSnap.forEach((child) => {
    const profile = child.val() || {};
    const publicId = publicIdFor('bet', child.key);
    updates[`privateUserIds/bet/byUid/${child.key}`] = publicId;
    updates[`privateUserIds/bet/byPublicId/${publicId}`] = child.key;
    updates[`bettingMarket/publicProfiles/${publicId}`] = { nickname: profile.nickname || '', avatarUrl: profile.avatarUrl || '' };
  });
  const rankings = rankingsSnap.val() || {};
  for (const [kind, values] of Object.entries(rankings)) {
    if (kind === 'updatedAt' || !values || typeof values !== 'object') continue;
    for (const [uidKey, entry] of Object.entries(values)) {
      const entryUid = entry && (entry.uid || uidKey);
      if (!entryUid || !entry) continue;
      const publicId = await ensurePublicId(db, 'bet', entryUid);
      const sanitized = Object.assign({}, entry, { publicId });
      delete sanitized.uid;
      updates[`bettingMarket/rankingsPublic/${kind}/${publicId}`] = sanitized;
    }
  }
  const blocked = blockedSnap.val() || {};
  for (const [blockedUid, entry] of Object.entries(blocked)) {
    const publicId = await ensurePublicId(db, 'bet', blockedUid);
    const sanitized = Object.assign({}, entry, { publicId });
    delete sanitized.blockedBy;
    updates[`bettingMarket/blockedNicknamesPublic/${publicId}`] = sanitized;
  }
  const marketsSnap = await db.ref('bettingMarket/markets').get();
  for (const [marketId, source] of Object.entries(marketsSnap.val() || {})) {
    if (!source) continue;
    const publicMarket = sanitizePublicMarket(source);
    if (source.proposerUid) {
      const publicId = await ensurePublicId(db, 'bet', source.proposerUid);
      publicMarket.proposerPublicId = publicId;
    }
    updates[`bettingMarket/marketsPublic/${marketId}`] = publicMarket;
  }
  const jackpotWinsSnap = await db.ref('bettingMarket/jackpotWins').get();
  for (const [winId, source] of Object.entries(jackpotWinsSnap.val() || {})) {
    if (!source || !source.uid) continue;
    const publicId = await ensurePublicId(db, 'bet', source.uid);
    updates[`bettingMarket/jackpotWinsPublic/${winId}`] = {
      publicId,
      amount: source.amount || 0,
      at: source.at || null,
    };
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  return { migrated: Object.keys(updates).length };
});

module.exports = { migrateBettingPublicIdentityData };
