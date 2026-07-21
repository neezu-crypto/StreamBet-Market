// 08번 배당 배수 계산 — 배당 배수 = (전체 풀 × (1 − 수수료율)) ÷ 승리 outcome 풀
// 최소 배당 하한선(1.1배) 적용, 부족분은 reserveFund에서 충당하고 재원이 부족하면 하한을 적용하지 않는다.
function computeSettlement({ totalPool, winningPool, rakeRate, minPayoutMultiplier, reserveBalance }) {
  const rakeAmount = totalPool * rakeRate;
  const distributable = totalPool - rakeAmount;

  if (winningPool <= 0) {
    // 승자 없음 — 배당 계산 불가, 전액 환불 (08번)
    return { void: true, reason: 'no-winning-pool' };
  }

  const rawMultiplier = distributable / winningPool;
  let multiplier = rawMultiplier;
  let reserveDelta = rakeAmount; // 수수료는 항상 reserveFund에 적립

  if (rawMultiplier < minPayoutMultiplier) {
    const floorTotal = minPayoutMultiplier * winningPool;
    const shortfall = floorTotal - distributable;
    if (reserveBalance + rakeAmount >= shortfall) {
      multiplier = minPayoutMultiplier;
      reserveDelta = rakeAmount - shortfall; // 재원에서 부족분만큼 차감 후 적립
    }
    // 재원 부족 시 공식값(rawMultiplier) 그대로 지급, reserveDelta는 rakeAmount 그대로 유지
  }

  return { void: false, multiplier, reserveDelta, rakeAmount };
}

module.exports = { computeSettlement };
