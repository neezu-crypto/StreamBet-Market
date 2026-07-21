// 기획서 확정 수치 (섹션 번호는 스트리머_배팅시장_기획서.html 기준)
const ADMIN_EMAIL = 'skftodwocks2@gmail.com'; // 07번

const RAKE_RATE = 0.05; // 08번 배팅 풀 수수료
const MIN_PAYOUT_MULTIPLIER = 1.1; // 08번 최소 배당 하한선

const EXCHANGE_FEE_RATE = 0.10; // 07번 환전 수수료
const EXCHANGE_RATE = 1; // 07번 1:1
const EXCHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 07번 24시간 쿨다운
const EXCHANGE_DAILY_CAPS = [200000, 500000, 1000000]; // 07번 1일차/2일차/3일차 이후
const EXCHANGE_STEP = 10000;

const NEW_ACCOUNT_WAIT_MS = 60 * 1000; // 09번 신규 계정 1분 대기 (배팅·환전 공통)
const BET_MAX_AMOUNT = 1000000; // 09번 1회 최대 배팅
const BET_STEP = 10000; // 09번 배팅 입력 단위
const BET_MIN_PARTICIPANTS = 5; // 09번 최소 참여자 수
const BET_CANCEL_COOLDOWN_MS = 30 * 1000; // 09번 취소+재배팅 쿨다운
const NEW_ACCOUNT_BET_CAPS = [500000, 1000000]; // 09번 1일차 / 2일차 이후 배팅 한도

const LIKE_THRESHOLD = 20; // 04번 좋아요 다수결 통과 기준

const PROPOSAL_COOLDOWN_MS = 60 * 1000; // 배팅 주제 제안 매크로 방지 — 계정당 쿨다운 (관리자·인증 스트리머 제외)

const REPORT_COOLDOWN_MS = 5 * 60 * 1000; // 04번 신고 간 쿨다운
const NEW_ACCOUNT_REPORT_WAIT_MS = 10 * 60 * 1000; // 04번 신규 계정 신고 대기

const NICKNAME_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 13번 닉네임 1일 1회
const NICKNAME_MAX_LENGTH = 12;

const ATTENDANCE_SCHEDULE = [10000, 14000, 20000, 26000, 32000, 40000, 60000]; // 12번 7일 주기
const PROPOSAL_REWARD_BASE = 10000;
const PROPOSAL_REWARD_PER_PARTICIPANT = 500;
const PROPOSAL_REWARD_CAP = 50000;
const PROPOSAL_REWARD_DAILY_MAX = 3;

const PROHIBITED_TOPIC_REASONS = [ // 04번 금지 주제 8종
  '스트리머 비하',
  '평가 불가능한 주관적인 주제',
  '사회적 · 정치적 뉴스 주제',
  '방송 송출 시 주의가 필요한 주제',
  '사생활 · 명예훼손 소지',
  '금전 · 도박 암시 · 유도',
  '불법행위 조장 · 미화',
  '차별 · 혐오 표현 포함',
];

module.exports = {
  ADMIN_EMAIL,
  RAKE_RATE,
  MIN_PAYOUT_MULTIPLIER,
  EXCHANGE_FEE_RATE,
  EXCHANGE_RATE,
  EXCHANGE_COOLDOWN_MS,
  EXCHANGE_DAILY_CAPS,
  EXCHANGE_STEP,
  NEW_ACCOUNT_WAIT_MS,
  BET_MAX_AMOUNT,
  BET_STEP,
  BET_MIN_PARTICIPANTS,
  BET_CANCEL_COOLDOWN_MS,
  NEW_ACCOUNT_BET_CAPS,
  LIKE_THRESHOLD,
  PROPOSAL_COOLDOWN_MS,
  REPORT_COOLDOWN_MS,
  NEW_ACCOUNT_REPORT_WAIT_MS,
  NICKNAME_CHANGE_COOLDOWN_MS,
  NICKNAME_MAX_LENGTH,
  ATTENDANCE_SCHEDULE,
  PROPOSAL_REWARD_BASE,
  PROPOSAL_REWARD_PER_PARTICIPANT,
  PROPOSAL_REWARD_CAP,
  PROPOSAL_REWARD_DAILY_MAX,
  PROHIBITED_TOPIC_REASONS,
};
