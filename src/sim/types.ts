// Plain data shapes for the whole simulation. No behaviour here.
import type { Rng } from './rng';

export type BuildingKind =
  | 'house' | 'apartment'
  | 'school' | 'clinic' | 'police' | 'townhall'
  | 'grocery' | 'store' | 'cafe' | 'restaurant' | 'bar'
  | 'factory' | 'office' | 'farm'
  | 'park';

export interface Building {
  id: number;
  kind: BuildingKind;
  name: string;
  icon: string;
  /** Footprint in tiles. */
  x: number; y: number; w: number; h: number;
  /** Road tile in front of the building. */
  doorX: number; doorY: number;
  /** Point on the building's front wall where peds step in. */
  entryX: number; entryY: number;
  /** Number of households the building can hold (0 for non-housing). */
  homes: number;
  /** Cosmetic variant index. */
  variant: number;
}

export type DecorKind = 'woods' | 'field' | 'pond' | 'garden' | 'cemetery';
export interface Decor { kind: DecorKind; x: number; y: number; w: number; h: number; }

export const TILE_GRASS = 0;
export const TILE_ROAD = 1;
export const TILE_LOT = 2;
export const TILE_PARK = 3;

export interface World {
  size: number;
  tiles: Uint8Array;
  tileBuilding: Int16Array;
  buildings: Building[];
  decor: Decor[];
  roadLines: number[];
  /** BFS parent arrays per source door, filled lazily. */
  bfs: Map<number, Int16Array>;
  /** Polyline cache per door pair: x0,y0,x1,y1,... */
  routes: Map<number, Float32Array>;
  routeLen: Map<number, number>;
}

export type Sector = 'commerce' | 'industry' | 'civic';

export interface Business {
  id: number; // building id
  sector: Sector;
  open: boolean;
  cash: number;
  slots: number;
  baseWage: number;
  staff: number[];
  hiring: boolean;
  brokeDays: number;
  closedDay: number;
  /** Export demand multiplier (industry only). */
  demand: number;
  salesToday: number;
  shiftStart: number; // minute of day
  shiftEnd: number;
  worksWeekend: boolean;
}

export interface Household {
  id: number;
  home: number; // building id, -1 once the household has left
  members: number[];
  food: number; // meal units in the cupboard
}

export interface Traits {
  sociability: number;
  ambition: number;
  honesty: number;
  impulsivity: number;
  resilience: number;
}

export interface Needs {
  hunger: number; // 1 = fully satisfied
  energy: number;
  social: number;
  fun: number;
  health: number;
}

export type RelKind = 'none' | 'friend' | 'close' | 'rival' | 'dating' | 'partner' | 'family' | 'ex';

export interface Rel {
  aff: number; // -1..1
  fam: number; // 0..1
  kind: RelKind;
  since: number; // day the current kind began
}

export type ActionKind =
  | 'sleep' | 'eatHome' | 'eatOut' | 'work' | 'school' | 'shopFood' | 'shop'
  | 'socialise' | 'relax' | 'jobHunt' | 'doctor' | 'sickRest' | 'steal'
  | 'jailed' | 'mull' | 'visit';

export interface Memory {
  day: number;
  type: EventType;
  text: string;
  other: number; // agent id or -1
}

export interface Intention {
  tag: IntentionTag;
  target: number; // agent id or -1
  until: number; // day it expires
  reason: string;
  by: 'rule' | 'llm';
}

export type IntentionTag =
  | 'carry-on' | 'find-better-job' | 'save-money' | 'go-out-more' | 'reconcile-with'
  | 'confront' | 'lie-low' | 'look-after-family' | 'work-hard' | 'get-healthy' | 'find-love';

export interface Illness {
  kind: 'flu' | 'serious';
  severity: number;
  until: number; // tick
  treated: boolean;
}

export interface Look {
  skin: number; // palette index
  hairStyle: number; // 0 short, 1 long, 2 bun/top, 3 bald
  hairColor: number;
  shirt: number; // packed 0xRRGGBB
  pants: number;
  height: number; // scale
  female: boolean;
}

export type AgentStatus = 'active' | 'left' | 'dead';

export interface Agent {
  id: number;
  status: AgentStatus;
  first: string;
  last: string;
  age: number;
  female: boolean;
  hh: number;
  traits: Traits;
  needs: Needs;
  cash: number;
  skill: number;
  mood: number;
  moodBoost: number;
  rep: number;
  job: number; // building id of employer, -1 if none
  wage: number;
  workedToday: number; // minutes
  rel: Record<number, Rel>;
  partner: number;
  mem: Memory[];
  intention: Intention | null;
  lastIntentionDay: number;
  shock: number; // how much life changed recently; drives who gets a model-set intention
  illness: Illness | null;
  immuneUntil: number; // day
  jailUntil: number; // tick, 0 if free
  record: number; // known offences
  unemployedDays: number;
  unhappyDays: number;
  // --- activity ---
  at: number; // building the agent is in (or heading from)
  action: ActionKind;
  place: number; // building the action happens in
  until: number; // tick the current action ends
  decidedAt: number; // tick of the last decision (stuck detection)
  tripFrom: number; // building id, -1 when not walking
  tripStart: number;
  tripEnd: number;
  forced: { action: ActionKind; place: number; minutes: number } | null;
  pendingDecision: number; // id of the dilemma being mulled, -1 otherwise
  lastDilemmaDay: number;
  lastVisitDay: number;
  lastHuntDay: number;
  look: Look;
  // --- report bookkeeping ---
  arrivedDay: number;
  goneDay: number;
  startCash: number;
  startMood: number;
  startJob: number;
}

export type EventType =
  | 'hired' | 'fired' | 'quit' | 'befriended' | 'closeFriends' | 'fellOut' | 'reconciled'
  | 'dating' | 'partnered' | 'brokeUp' | 'theft' | 'fight' | 'arrest' | 'released'
  | 'fellIll' | 'recovered' | 'died' | 'businessClosed' | 'businessOpened' | 'layoffs'
  | 'movedAway' | 'movedIn' | 'shock' | 'outbreak' | 'policy' | 'gossip' | 'decision'
  | 'evicted' | 'milestone';

export interface SimEvent {
  id: number;
  tick: number;
  day: number;
  type: EventType;
  sev: number; // 1 (minor) .. 5 (town-shaking)
  a: number; // main agent or -1
  b: number; // other agent or -1
  place: number; // building id or -1
  text: string;
}

export interface DayMetrics {
  day: number;
  population: number;
  mood: number;
  employment: number;
  meanWealth: number;
  medianWealth: number;
  gini: number;
  crimes: number;
  illnesses: number;
  sick: number;
  priceIndex: number;
  openBusinesses: number;
  friendships: number;
  couples: number;
  treasury: number;
  demand: number;
}

export type DilemmaKind = 'quit' | 'steal' | 'propose' | 'report' | 'leave';

/** A choice the sim hands to the Mind. The model only ever picks an option number. */
export interface DecisionRequest {
  id: number;
  kind: 'intention' | 'dilemma';
  dilemma: DilemmaKind | null;
  agent: number;
  other: number;
  place: number;
  persona: string;
  situation: string;
  memories: string[];
  options: string[]; // human-readable, numbered by index + 1
  tags: string[]; // machine tags parallel to options
  ruleChoice: number; // index the rule-based picker would take
  created: number;
  deadline: number; // tick at which ruleChoice is applied if unresolved
}

export interface DecisionLog {
  id: number;
  tick: number; // sim.tick at the moment the choice was applied
  kind: 'intention' | 'dilemma';
  agent: number;
  choice: number;
  tag: string;
  reason: string;
  by: 'rule' | 'llm';
}

export interface NewsItem {
  day: number;
  headline: string;
  blurb: string;
  by: 'rule' | 'llm';
}

export interface NewsRequest {
  day: number;
  facts: string[];
  ruleHeadline: string;
  ruleBlurb: string;
}

/**
 * The Mind is injected into the sim. The sim never awaits it: it hands over a request and a
 * callback, and applies the rule choice itself if the deadline passes first.
 */
export interface Mind {
  readonly kind: 'rule' | 'llm' | 'replay';
  decide(req: DecisionRequest, resolve: (choice: number, reason: string) => void): void;
  newspaper?(req: NewsRequest, done: (headline: string, blurb: string) => void): void;
}

export interface Ledger {
  initial: number;
  sources: Record<string, number>;
  sinks: Record<string, number>;
}

export interface Town {
  cash: number;
  priceIndex: number;
  policeBoost: number; // extra officers from the god tool
  crimesToday: number;
  illnessesToday: number;
  callsToday: { intentions: number; dilemmas: number; news: number };
  callsTotal: number;
}

export interface Sim {
  seed: number;
  rng: Rng;
  tick: number;
  world: World;
  agents: Agent[];
  households: Household[];
  biz: (Business | null)[];
  town: Town;
  ledger: Ledger;
  events: SimEvent[];
  metrics: DayMetrics[];
  pending: DecisionRequest[];
  decisions: DecisionLog[];
  news: NewsItem[];
  budget: number;
  mind: Mind;
  nextDecisionId: number;
  /** Decisions to re-apply at their logged tick (replay mode). */
  replay: DecisionLog[] | null;
  replayCursor: number;
  /** Scratch: agent ids per building, rebuilt each interaction round. */
  occupants: number[][];
}
