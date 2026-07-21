const { initializeApp } = require('firebase-admin/app');
initializeApp();

const { claimAttendance, distributeJackpotWeekly } = require('./src/rewards');
const { computeRankingsScheduled } = require('./src/rankings');

module.exports = {
  ...require('./src/markets'),
  ...require('./src/bets'),
  ...require('./src/likes'),
  ...require('./src/scheduled'),
  ...require('./src/exchange'),
  ...require('./src/verification'),
  claimAttendance,
  distributeJackpotWeekly,
  computeRankingsScheduled,
  ...require('./src/reports'),
  ...require('./src/profile'),
};
