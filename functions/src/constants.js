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

const LIKE_THRESHOLD = 10; // 04번 좋아요 다수결 통과 기준

const PROPOSAL_COOLDOWN_MS = 60 * 1000; // 배팅 주제 제안 매크로 방지 — 계정당 쿨다운 (관리자·인증 스트리머 제외)

const REPORT_COOLDOWN_MS = 5 * 60 * 1000; // 04번 신고 간 쿨다운
const NEW_ACCOUNT_REPORT_WAIT_MS = 10 * 60 * 1000; // 04번 신규 계정 신고 대기

const NICKNAME_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 13번 닉네임 1일 1회
const NICKNAME_MAX_LENGTH = 12;
// XSS 방지 — 닉네임에 <, >, 제어문자를 넣어 저장형 스크립트 주입을 시도하는 것을 서버에서부터 차단
const NICKNAME_FORBIDDEN_RE = /[<>\x00-\x1F\x7F]/;
// 주식시장과 동일한 SOOP 아이디 형식(소문자/숫자 2~20자) — 형식을 좁혀두면 자동으로 XSS·매크로성
// 쓰레기 입력도 함께 막힌다
const SOOP_ID_RE = /^[a-z0-9]{2,20}$/;

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

const NICKNAME_REPORT_REASONS = ['부적절한 표현', '사칭 · 도용', '광고 · 스팸성 닉네임', '기타']; // 13번
const REPORT_DETAIL_MAX_LENGTH = 300; // 신고 상세 사유 자유 입력 길이 제한 (XSS·매크로성 대량 입력 방지)

const JUDGE_GRACE_MS = 60 * 1000; // 판정 유예시간 — 확정 전 1분간 취소·재판정 가능

const JACKPOT_RAKE_SHARE = 0.2; // 14번 — 마켓 정산 시 수수료의 20%는 잭팟, 나머지 80%는 reserveFund로 적립
const JACKPOT_WIN_CHANCE = 1 / 50; // 14번 — 1일 1회 확인, 당첨 확률 1/50, 당첨 시 적립금 전액 지급 후 리셋

const CHAT_MESSAGE_MAX_LENGTH = 300; // 관리 탭 채팅 — 자유 입력 길이 제한 (XSS·매크로성 대량 입력 방지)

const AUDIT_LOG_CAP = 200; // 관리 탭 "최근 처리 내역" — 이 개수를 넘는 오래된 항목은 매 기록 시 삭제
const ADMIN_CHAT_CAP = 200; // 관리 탭 채팅 — 이 개수를 넘는 오래된 메시지는 매 전송 시 삭제

const RANKING_DISPLAY_CAP = 100; // 13번 — 자산·승률·누적수익 랭킹은 상위 100명까지만 계산·저장

// 16번 — 스킨 카탈로그. 별도 관리자 CRUD 없이 서버·클라이언트 양쪽 상수로 관리하며,
// 새 스킨은 코드 배포로 추가한다. price는 서버 값이 항상 기준(클라이언트 표시는 참고용).
const SKIN_CATALOG = {
  // 상표권 리스크 방지 — 특정 브랜드명 대신 시각적 특징으로 설명적인 이름을 쓴다
  // (내부 skinId는 기존 구매·장착 데이터 호환을 위해 그대로 유지).
  'excel-default': { name: '스프레드시트 테마', category: 'theme', price: 200000 },
  'win11-folder': { name: '탐색기 스타일 테마', category: 'theme', price: 200000 },
  'macos-finder': { name: '트래픽라이트 테마', category: 'theme', price: 200000 },
  'retro-pc': { name: '레트로 PC 테마', category: 'theme', price: 200000 },
  'spring-bloom': { name: '벚꽃 테마', category: 'theme', price: 200000 },
  'summer-ocean': { name: '오션 테마', category: 'theme', price: 200000 },
  'autumn-maple': { name: '단풍 테마', category: 'theme', price: 200000 },
  'winter-snow': { name: '스노우 테마', category: 'theme', price: 200000 },
};
const SKIN_PURCHASE_LOG_CAP = 200; // 관리 탭 "스킨 구매 내역" — 이 개수를 넘는 오래된 항목은 매 구매 시 삭제

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
  NICKNAME_FORBIDDEN_RE,
  SOOP_ID_RE,
  NICKNAME_REPORT_REASONS,
  REPORT_DETAIL_MAX_LENGTH,
  ATTENDANCE_SCHEDULE,
  PROPOSAL_REWARD_BASE,
  PROPOSAL_REWARD_PER_PARTICIPANT,
  PROPOSAL_REWARD_CAP,
  PROPOSAL_REWARD_DAILY_MAX,
  PROHIBITED_TOPIC_REASONS,
  JUDGE_GRACE_MS,
  JACKPOT_RAKE_SHARE,
  JACKPOT_WIN_CHANCE,
  CHAT_MESSAGE_MAX_LENGTH,
  AUDIT_LOG_CAP,
  ADMIN_CHAT_CAP,
  RANKING_DISPLAY_CAP,
  SKIN_CATALOG,
  SKIN_PURCHASE_LOG_CAP,
};
