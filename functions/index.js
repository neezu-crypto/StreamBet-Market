const { initializeApp } = require('firebase-admin/app');
initializeApp();

const { claimAttendance, claimJackpotDraw, syncJackpotWinPublic } = require('./src/rewards');
const {
  submitMarketProposal,
  reviewProposal,
  closeMarketEarly,
  voidMarket,
  setMinParticipantsOverride,
  judgeMarket,
  cancelPendingJudgment,
  syncBettingMarketPublic,
} = require('./src/markets');

module.exports = {
  submitMarketProposal,
  reviewProposal,
  closeMarketEarly,
  voidMarket,
  setMinParticipantsOverride,
  judgeMarket,
  cancelPendingJudgment,
  syncBettingMarketPublic,
  ...require('./src/bets'),
  ...require('./src/likes'),
  ...require('./src/scheduled'),
  ...require('./src/exchange'),
  ...require('./src/verification'),
  claimAttendance,
  claimJackpotDraw,
  syncJackpotWinPublic,
  ...require('./src/reports'),
  ...require('./src/profile'),
  ...require('./src/chest'),
  ...require('./src/admin-tools'),
  ...require('./src/streamer-requests'),
  ...require('./src/chat'),
  ...require('./src/skins'),
  ...require('./src/whoami'),
  ...require('./src/streamerVisitLog'),
  ...require('./src/privacy-migration'),
};
