const { initializeApp } = require('firebase-admin/app');
initializeApp();

const { claimAttendance, claimJackpotDraw } = require('./src/rewards');
const {
  submitMarketProposal,
  reviewProposal,
  closeMarketEarly,
  voidMarket,
  setMinParticipantsOverride,
  judgeMarket,
  cancelPendingJudgment,
} = require('./src/markets');

module.exports = {
  submitMarketProposal,
  reviewProposal,
  closeMarketEarly,
  voidMarket,
  setMinParticipantsOverride,
  judgeMarket,
  cancelPendingJudgment,
  ...require('./src/bets'),
  ...require('./src/likes'),
  ...require('./src/scheduled'),
  ...require('./src/exchange'),
  ...require('./src/verification'),
  claimAttendance,
  claimJackpotDraw,
  ...require('./src/reports'),
  ...require('./src/profile'),
  ...require('./src/chest'),
  ...require('./src/admin-tools'),
  ...require('./src/streamer-requests'),
  ...require('./src/chat'),
  ...require('./src/skins'),
  ...require('./src/whoami'),
};
