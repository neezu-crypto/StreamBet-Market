function classifyBettingVerificationNoteNoMatch(requests, senderId, now) {
  const pendingForSender = Object.entries(requests || {}).filter(([, entry]) => entry &&
    (!entry.status || entry.status === "pending") &&
    (entry.isSwitch === true || String(entry.soopId || "").trim().toLowerCase() === senderId));
  if (!pendingForSender.length) return "no-pending-request-for-sender";

  const eligibleForSender = pendingForSender.filter(([, entry]) => entry.noteEligible === true && entry.requesterUid &&
    (entry.isSwitch || (entry.requesterUid === entry.uid && !entry.soopIdAlreadyVerifiedByOther)));
  if (!eligibleForSender.length) return "request-not-eligible-for-auto-verification";

  const hasActiveCode = eligibleForSender.some(([, entry]) =>
    !!entry.noteVerificationCodeHash && Number(entry.noteVerificationCodeExpiresAt) > now,
  );
  return hasActiveCode ? "code-mismatch" : "pending-request-code-missing-or-expired";
}

module.exports = { classifyBettingVerificationNoteNoMatch };
