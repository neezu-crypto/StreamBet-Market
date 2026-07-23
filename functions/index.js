const { initializeApp } = require('firebase-admin/app');
initializeApp();

const { claimAttendance, distributeJackpotWeekly } = require('./src/rewards');
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
  distributeJackpotWeekly,
  ...require('./src/reports'),
  ...require('./src/profile'),
  ...require('./src/charge'),
  ...require('./src/admin-tools'),
};
