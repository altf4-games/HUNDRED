// Prompt building and strict reply parsing. Pure functions, so they can be tested in Node.
import type { DecisionRequest, NewsRequest } from '../sim/types';

export interface Chat { system: string; user: string; maxTokens: number; }

export function decisionPrompt(req: DecisionRequest): Chat {
  const lines = [req.persona, req.situation];
  if (req.memories.length) lines.push(`Recent: ${req.memories.slice(-3).join(' ')}`);
  lines.push('Options:');
  req.options.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
  lines.push('Which option? Answer as: <number> - <reason>');
  return {
    system: 'You decide for one character in a small-town life simulation. Stay in character. Reply with the number of ONE option, a dash, then a first-person reason of at most 12 words. Example: "2 - I cannot risk losing this job."',
    user: lines.join('\n'),
    maxTokens: 40,
  };
}

/** Returns the chosen option index and reason, or null if the reply is not a valid option. */
export function parseChoice(reply: string, optionCount: number): { choice: number; reason: string } | null {
  const m = reply.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1] as string, 10);
  if (!(n >= 1 && n <= optionCount)) return null;
  let reason = reply.slice((m.index ?? 0) + (m[1] as string).length).replace(/^[\s.\-–—:)]+/, '').split('\n')[0] ?? '';
  reason = reason.replace(/^["'“]+|["'”]+$/g, '').trim();
  if (reason.length > 110) reason = `${reason.slice(0, 107).trimEnd()}...`;
  return { choice: n - 1, reason };
}

export function newsPrompt(req: NewsRequest): Chat {
  return {
    system: 'You write for the Hundred Herald, a small-town daily paper. Be vivid but stick to the facts given. Reply in exactly two lines:\nHEADLINE: <at most 9 words>\nBLURB: <one sentence>',
    user: `Day ${req.day + 1}. Facts:\n${req.facts.length ? req.facts.map((f) => `- ${f}`).join('\n') : '- A quiet day with nothing unusual.'}`,
    maxTokens: 64,
  };
}

export function parseNews(reply: string): { headline: string; blurb: string } | null {
  const h = reply.match(/HEADLINE:\s*(.+)/i);
  const b = reply.match(/BLURB:\s*(.+)/i);
  if (!h) return null;
  const clean = (s: string) => s.replace(/[*_#"]+/g, '').trim();
  const headline = clean(h[1] as string);
  if (headline.length < 4 || headline.length > 110) return null;
  return { headline, blurb: b ? clean(b[1] as string).slice(0, 220) : '' };
}

export function voicePrompt(persona: string, state: string, doing: string, memories: string[], intention: string): Chat {
  return {
    system: 'You voice the private thoughts of a character in a small-town life simulation. Write two short first-person sentences. No quotation marks, no narration.',
    user: `${persona}\n${state}\nDoing now: ${doing}.${intention ? `\nCurrent aim: ${intention}.` : ''}${memories.length ? `\nRecent: ${memories.join(' ')}` : ''}\nWhat is going through their mind?`,
    maxTokens: 60,
  };
}

export function chroniclePrompt(facts: string[]): Chat {
  return {
    system: 'You are the town chronicler. In three sentences, sum up how the town changed over one hundred days. Warm, plain, specific. Use only the facts given.',
    user: facts.map((f) => `- ${f}`).join('\n'),
    maxTokens: 80,
  };
}
