// 08번 배당 배수 계산 — 배당 배수 = (전체 풀 × (1 − 수수료율)) ÷ 승리 outcome 풀
// 최소 배당 하한선(1.1배) 적용, 부족분은 reserveFund에서 충당하고 재원이 부족하면 하한을 적용하지 않는다.
// 14번 — 수수료 중 일부(jackpotRakeShare)는 항상 잭팟으로 먼저 떼어두고, 나머지만
// reserveFund 적립·부족분 충당에 사용한다(잭팟은 최소배당 보장 재원으로 쓰이지 않음).
function computeSettlement({ totalPool, winningPool, rakeRate, minPayoutMultiplier, reserveBalance, jackpotRakeShare }) {
  const rakeAmount = totalPool * rakeRate;
  const distributable = totalPool - rakeAmount;

  if (winningPool <= 0) {
    // 승자 없음 — 배당 계산 불가, 전액 환불 (08번)
    return { void: true, reason: 'no-winning-pool' };
  }

  const jackpotDelta = rakeAmount * (jackpotRakeShare || 0);
  const reserveRakeAmount = rakeAmount - jackpotDelta;

  const rawMultiplier = distributable / winningPool;
  let multiplier = rawMultiplier;
  let reserveDelta = reserveRakeAmount; // 수수료(잭팟 몫 제외)는 항상 reserveFund에 적립

  if (rawMultiplier < minPayoutMultiplier) {
    const floorTotal = minPayoutMultiplier * winningPool;
    const shortfall = floorTotal - distributable;
    if (reserveBalance + reserveRakeAmount >= shortfall) {
      multiplier = minPayoutMultiplier;
      reserveDelta = reserveRakeAmount - shortfall; // 재원에서 부족분만큼 차감 후 적립
    }
    // 재원 부족 시 공식값(rawMultiplier) 그대로 지급, reserveDelta는 reserveRakeAmount 그대로 유지
  }

  return { void: false, multiplier, reserveDelta, rakeAmount, jackpotDelta };
}

module.exports = { computeSettlement };
