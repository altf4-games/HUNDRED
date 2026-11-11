// Turning sim state into words and emoji. Rule-based; never calls the model.
import { jobTitle } from '../sim/brain';
import { moneyStress } from '../sim/economy';
import { hash01 } from '../sim/rng';
import type { ActionKind, Agent, Building, Sim } from '../sim/types';

const VERB: Record<ActionKind, string> = {
  sleep: 'sleep', eatHome: 'eat', eatOut: 'eat out', work: 'work', school: 'go to school', shopFood: 'buy groceries',
  shop: 'shop', socialise: 'see people', relax: 'unwind', jobHunt: 'look for work', doctor: 'see the doctor',
  sickRest: 'rest', steal: 'do something desperate', jailed: 'serve time', mull: 'think', visit: 'see someone',
};

const DOING: Record<ActionKind, string> = {
  sleep: 'Asleep', eatHome: 'Eating', eatOut: 'Eating out', work: 'Working', school: 'In class', shopFood: 'Buying groceries',
  shop: 'Shopping', socialise: 'Hanging out', relax: 'Relaxing', jobHunt: 'Looking for work', doctor: 'Seeing the doctor',
  sickRest: 'Resting in bed', steal: 'Up to no good', jailed: 'In a cell', mull: 'Mulling over a big decision', visit: 'Visiting someone',
};

export function placeName(sim: Sim, a: Agent, id: number): string {
  const b = sim.world.buildings[id] as Building;
  const home = sim.households[a.hh]?.home;
  return id === home ? 'home' : b.kind === 'house' ? b.name : b.name;
}

export function describeAction(sim: Sim, a: Agent): string {
  if (a.status === 'dead') return 'Died';
  if (a.status === 'left') return 'Left town';
  const where = placeName(sim, a, a.place);
  if (a.tripFrom >= 0) return `Walking ${where === 'home' ? 'home' : `to ${where}`} to ${VERB[a.action]}`;
  return `${DOING[a.action]} ${where === 'home' ? 'at home' : `at ${where}`}`;
}

/** Thought bubble shown over a ped at street level. */
export function bubbleFor(sim: Sim, a: Agent): string {
  if (a.action === 'mull') return '🤔';
  if (a.illness && a.illness.severity > 0.45) return '🤒';
  const kind = (sim.world.buildings[a.place] as Building).kind;
  switch (a.action) {
    case 'sleep': return '😴';
    case 'work': return '💼';
    case 'school': return '🎒';
    case 'eatHome': return '🍲';
    case 'eatOut': return kind === 'cafe' ? '☕' : '🍝';
    case 'shopFood': return '🛒';
    case 'shop': return '🛍️';
    case 'socialise': return kind === 'bar' ? '🍺' : kind === 'park' ? (a.tripFrom >= 0 ? '🌳' : '💬') : '☕';
    case 'relax': return a.age >= 18 && moneyStress(sim, a) > 0.7 ? '💸' : '🏠';
    case 'jobHunt': return '📄';
    case 'doctor': return '🩺';
    case 'sickRest': return '🤧';
    case 'steal': return '🫣';
    case 'jailed': return '🚓';
    case 'visit': return a.intention?.tag === 'confront' ? '😠' : '🤝';
    default: return '';
  }
}

export function moodEmoji(m: number): string {
  return m > 0.75 ? '😄' : m > 0.6 ? '🙂' : m > 0.45 ? '😐' : m > 0.3 ? '😟' : '😢';
}

export function intentionText(sim: Sim, a: Agent): string {
  const it = a.intention;
  if (!it) return '';
  const t = it.target >= 0 ? (sim.agents[it.target] as Agent).first : '';
  const map: Record<string, string> = {
    'carry-on': 'Carry on as usual', 'find-better-job': 'Find a better job', 'save-money': 'Save money', 'go-out-more': 'Go out more',
    'reconcile-with': `Make peace with ${t}`, confront: `Have it out with ${t}`, 'lie-low': 'Lie low', 'look-after-family': 'Look after family',
    'work-hard': 'Work hard', 'get-healthy': 'Get healthy', 'find-love': 'Find love',
  };
  return map[it.tag] ?? it.tag;
}

/** Templated inner voice, used when the model is unavailable. */
export function ruleVoice(sim: Sim, a: Agent): string {
  const n = a.needs;
  const pickOne = (list: string[]) => list[Math.floor(hash01(a.id, sim.tick >> 9) * list.length)] as string;
  const lines: string[] = [];
  if (a.action === 'jailed') lines.push('Four walls and too much time to think. I never meant for it to go this far.');
  else if (a.illness) lines.push(pickOne(['Everything aches. I just want to feel like myself again.', 'I should not be out like this, but life does not stop for a fever.']));
  else if (a.age >= 18 && a.age < 66 && a.job < 0) lines.push(pickOne(['Another day without work. Something has to turn up soon.', 'I keep checking the board at the town hall. Somebody must need a pair of hands.']));
  else if (a.age >= 18 && moneyStress(sim, a) > 0.6) lines.push('I keep doing the sums and they keep coming out wrong.');
  else if (n.hunger < 0.3) lines.push('I could eat a horse. Food first, everything else after.');
  else if (n.energy < 0.25) lines.push('I am running on fumes. Bed cannot come soon enough.');
  else if (n.social < 0.3) lines.push('It has been too long since I had a proper conversation with anyone.');
  else if (a.mood > 0.7) lines.push(pickOne(['Not a bad life, this. Not bad at all.', 'Good day so far. Long may it last.']));
  else lines.push(pickOne(['Same streets, same faces. There is comfort in that.', `Being a ${jobTitle(sim, a)} was never the plan, but here we are.`]));
  if (a.intention && a.intention.tag !== 'carry-on') lines.push(`I have made up my mind: ${intentionText(sim, a).toLowerCase()}.`);
  else if (a.partner >= 0) lines.push(`At least there is ${(sim.agents[a.partner] as Agent).first}.`);
  return lines.join(' ');
}
