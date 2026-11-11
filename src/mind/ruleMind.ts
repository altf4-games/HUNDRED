// Rule-based fallback mind. Answers instantly with the choice the sim's own rules prefer.
// Used when the model is unavailable, in headless runs and in tests. No DOM, no network.
import type { DecisionRequest, Mind } from '../sim/types';

export class RuleMind implements Mind {
  readonly kind = 'rule' as const;
  decide(req: DecisionRequest, resolve: (choice: number, reason: string) => void): void {
    resolve(req.ruleChoice, '');
  }
}
