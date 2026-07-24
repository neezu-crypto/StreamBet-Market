const { onValueWritten } = require('firebase-functions/v2/database');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { LIKE_THRESHOLD } = require('./constants');

// 04번 — 좋아요 10개 이상 시 자동 오픈 (라이트 검증)
// likeCount는 ServerValue.increment로 원자적으로 +1/-1 반영한다 — 커밋 순서와 무관하게
// 정확한 합이 보장되고, 동시에 몰려도 재시도 루프가 필요 없다. (예전에는 ref.transaction()을
// 썼는데, 이 경로에서 실제 값이 있는데도 간헐적으로 market을 null로 잘못 인식하는 현상이
// 확인됐고(07번 환전 버그 조사), 그 상태에서 `if (!market) return market`이 null을 반환하면
// RTDB 트랜잭션에서는 "그 경로 삭제"로 커밋돼 마켓 자체가 지워질 위험이 있었다.)
const onLikeWritten = onValueWritten('/bettingMarket/likes/{marketId}/{uid}', async (event) => {
  const marketId = event.params.marketId;
  const existedBefore = event.data.before.exists();
  const existsAfter = event.data.after.exists();
  let delta = 0;
  if (!existedBefore && existsAfter) delta = 1;
  else if (existedBefore && !existsAfter) delta = -1;
  if (delta === 0) return;

  const marketRef = getDatabase().ref('bettingMarket/markets/' + marketId);
  const countRef = marketRef.child('validation/likeCount');
  await countRef.set(ServerValue.increment(delta));
  const countSnap = await countRef.get();
  const likeCount = countSnap.val() || 0;
  if (likeCount < 0) {
    await countRef.set(0); // 방어적 보정 — 음수로 내려가면 0으로 고정
  }
  if (likeCount >= LIKE_THRESHOLD) {
    const statusSnap = await marketRef.child('status').get();
    if (statusSnap.val() === 'pendingValidation') {
      await marketRef.update({
        status: 'open',
        'validation/method': 'likes',
        'validation/validatedAt': Date.now(),
      });
    }
  }
});

module.exports = { onLikeWritten };
