const { onValueWritten } = require('firebase-functions/v2/database');
const { getDatabase } = require('firebase-admin/database');
const { LIKE_THRESHOLD } = require('./constants');

// 04번 — 좋아요 20개 이상 시 자동 오픈 (라이트 검증)
// likeCount는 별도 read로 집계하지 않고 market 노드 자체의 transaction 안에서 +1/-1로 갱신한다.
// (동시에 여러 명이 좋아요를 누르면 각 트리거 호출이 독립적으로 실행되는데, 밖에서 미리 읽은 개수를
//  트랜잭션에 그대로 써버리면 커밋 순서에 따라 최신 값이 오래된 값으로 덮여쓰이는 경쟁 조건이 생긴다.
//  market 노드 하나에 대한 원자적 delta 누적만이 커밋 순서와 무관하게 정확한 합을 보장한다.)
const onLikeWritten = onValueWritten('/bettingMarket/likes/{marketId}/{uid}', async (event) => {
  const marketId = event.params.marketId;
  const existedBefore = event.data.before.exists();
  const existsAfter = event.data.after.exists();
  let delta = 0;
  if (!existedBefore && existsAfter) delta = 1;
  else if (existedBefore && !existsAfter) delta = -1;
  if (delta === 0) return;

  const marketRef = getDatabase().ref('bettingMarket/markets/' + marketId);
  // 좋아요가 짧은 시간에 몰리면(예: 20명이 거의 동시에 클릭) 같은 market 노드에 트랜잭션이
  // 대량으로 몰려 낙관적 동시성 재시도가 소진될 수 있다. 애플리케이션 레벨에서 재시도를 덧붙여
  // 카운트 누락을 방지한다.
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await marketRef.transaction((market) => {
      if (!market) return market;
      market.validation = market.validation || {};
      market.validation.likeCount = Math.max(0, (market.validation.likeCount || 0) + delta);
      if (market.status === 'pendingValidation' && market.validation.likeCount >= LIKE_THRESHOLD) {
        market.status = 'open';
        market.validation.method = 'likes';
        market.validation.validatedAt = Date.now();
      }
      return market;
    });
    if (result.committed) break;
    await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 70));
  }
});

module.exports = { onLikeWritten };
