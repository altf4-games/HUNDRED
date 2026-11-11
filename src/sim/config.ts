// Every balance constant lives here. Tune with `npm run sim` across several seeds.

export const CFG = {
  // --- time ---
  dayTicks: 1440, // 1 tick = 1 sim minute
  totalDays: 100,

  // --- city ---
  gridSize: 64,
  walkSpeed: 3, // tiles per sim minute: natural at 1x, longest commute ~35 min
  maxAgents: 128, // instancing buffer size
  startAgents: 100,

  // --- needs (per sim minute) ---
  hungerDecay: 1 / 620,
  hungerDecayAsleep: 1 / 1700,
  energyDecay: 1 / 1050,
  energySleepGain: 1 / 430,
  socialDecay: 1 / 1500,
  funDecay: 1 / 1200,
  healthRegen: 1 / 2800,
  moodFollow: 0.03, // how fast mood tracks its target, per 10 minutes
  boostDecay: 0.985, // per 10 minutes; event-driven mood boosts fade over ~a day

  // --- prices (multiplied by the price index) ---
  mealHome: 4, // one food unit bought at the grocery
  mealCafe: 9,
  mealRestaurant: 15,
  barVisit: 8,
  storeBasket: 22,
  clinicFee: 35,
  rentHouse: 20, // per household per day, paid to the town
  rentApartment: 13,
  costOfGoods: 0.42, // share of each shop sale that leaves town as imports

  // --- public finances ---
  incomeTax: 0.22,
  stateGrant: 620, // outside money entering the treasury each day
  pension: 34, // per senior per day
  benefit: 17, // per unemployed adult per day
  childAllowance: 8,
  fineTheft: 60,
  fineFight: 40,
  treasuryReserve: 2500, // civic hiring freezes below this

  // --- businesses ---
  startCashDays: 6, // businesses start with this many days of payroll
  layoffBelowDays: 2.5, // lay off when cash covers fewer payroll days than this
  hireAboveDays: 5, // post vacancies when cash covers more than this
  profitCapDays: 16, // cash above this many payroll days drains to outside owners
  profitDrain: 0.15,
  closeAfterBrokeDays: 6,
  reopenAfterDays: 14,
  reopenChance: 0.12,
  reopenCash: 1500, // outside investment when a closed business reopens
  exportMargin: 1.15, // export income per worker-day relative to wage at demand 1
  demandRevert: 0.05,
  demandNoise: 0.045,
  shockChance: 0.04, // per industry per day
  shockSize: 0.42,
  overhead: 0.04, // industry running cost as a share of export income

  // --- social ---
  socialEvery: 20, // minutes between interaction rounds
  friendAt: 0.42,
  closeAt: 0.72,
  rivalAt: -0.4,
  datingAt: 0.56,
  breakupAt: 0.18,
  proposeAfterDays: 7,
  proposeAt: 0.74,
  gossipChance: 0.22,
  affinityFade: 0.988, // daily pull of non-family affinity back towards zero
  wealthSpend: 0.035, // share of spare cash a comfortable shopper drops at the general store
  barFightChance: 0.005,

  // --- crime ---
  stealStress: 0.72, // money stress above which theft is considered
  arrestBase: 0.22,
  arrestPerOfficer: 0.14,
  jailDaysMin: 2,
  jailDaysMax: 4,

  // --- health ---
  fluBase: 0.003, // spontaneous daily chance
  contagion: 0.0016, // per sick occupant per interaction round
  immunityDays: 28,
  deathBase: 0.0012,
  deathSenior: 0.02,

  // --- migration ---
  leaveAfterUnhappyDays: 9,
  leaveChance: 0.22,
  arrivalBase: 0.02,
  arrivalPerVacancy: 0.035,
  arrivalLowPop: 0.35, // extra daily chance when the town has shrunk
  lowPop: 82,
  popSoftCap: 118,

  // --- mind ---
  intentionDays: 4,
  dilemmaDeadline: 60, // sim minutes an agent mulls before the rule choice applies
  budgetDefault: 12, // automatic model calls per sim day
  budgetMax: 30,
  memorySize: 30,
} as const;

/** Split a total daily call budget into intentions / dilemmas / newspaper (8 / 3 / 1 at 12). */
export function splitBudget(total: number): { intentions: number; dilemmas: number; news: number } {
  const t = Math.max(0, Math.min(CFG.budgetMax, Math.round(total)));
  if (t === 0) return { intentions: 0, dilemmas: 0, news: 0 };
  const news = 1;
  const dilemmas = Math.round(((t - news) * 3) / 11);
  return { intentions: t - news - dilemmas, dilemmas, news };
}
