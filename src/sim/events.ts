// Typed event log, agent memories and small shared helpers.
import { CFG } from './config';
import type { Agent, EventType, Sim, SimEvent } from './types';

export function dayOf(sim: Sim): number {
  return Math.floor(sim.tick / CFG.dayTicks);
}

export function minuteOf(sim: Sim): number {
  return sim.tick % CFG.dayTicks;
}

export function fullName(a: Agent): string {
  return `${a.first} ${a.last}`;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function remember(a: Agent, day: number, type: EventType, text: string, other = -1): void {
  a.mem.push({ day, type, text, other });
  if (a.mem.length > CFG.memorySize) a.mem.shift();
}

/** Record an event. Involved agents remember it and their "life changed" score rises. */
export function emit(sim: Sim, type: EventType, sev: number, text: string, a = -1, b = -1, place = -1): SimEvent {
  const day = dayOf(sim);
  const ev: SimEvent = { id: sim.events.length, tick: sim.tick, day, type, sev, a, b, place, text };
  sim.events.push(ev);
  if (a >= 0) {
    const ag = sim.agents[a] as Agent;
    remember(ag, day, type, text, b);
    ag.shock += sev;
  }
  if (b >= 0) {
    const bg = sim.agents[b] as Agent;
    remember(bg, day, type, text, a);
    bg.shock += sev * 0.7;
  }
  return ev;
}

export function isActive(a: Agent): boolean {
  return a.status === 'active';
}

export function isAdult(a: Agent): boolean {
  return a.age >= 18;
}

export function isWorkingAge(a: Agent): boolean {
  return a.age >= 18 && a.age < 66;
}

export function isChild(a: Agent): boolean {
  return a.age < 18;
}

export function isSenior(a: Agent): boolean {
  return a.age >= 66;
}
