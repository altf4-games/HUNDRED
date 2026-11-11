// LlmMind: the default mind. A small instruct model runs in a Web Worker through WebLLM.
// One queue, one call at a time, short outputs. Anything that fails to parse is dropped and
// the sim falls back to its rule choice.
import type { DecisionRequest, Mind, NewsRequest } from '../sim/types';
import { type Chat, decisionPrompt, newsPrompt, parseChoice, parseNews } from './prompts';

// Model ids come from WebLLM's prebuilt list (prebuiltAppConfig), checked against v0.2.88.
const MODEL_F16 = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
const MODEL_F32 = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';

export interface AiState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  progress: number; // 0..1 while loading
  text: string;
  model: string;
  calls: number;
  failures: number;
  avgSec: number;
  queue: number;
}

interface Job { priority: number; chat: Chat; done: (reply: string | null) => void; wanted: () => boolean; }

interface Engine {
  chat: { completions: { create(args: unknown): Promise<{ choices: { message: { content: string | null } }[] }> } };
}

export class LlmMind implements Mind {
  readonly kind = 'llm' as const;
  state: AiState = { status: 'idle', progress: 0, text: 'AI minds not started', model: '', calls: 0, failures: 0, avgSec: 0, queue: 0 };
  onState: (s: AiState) => void = () => {};
  private engine: Engine | null = null;
  private queue: Job[] = [];
  private busy = false;
  private totalSec = 0;

  /** `stillWanted` lets the mind skip requests the sim has already resolved by deadline. */
  constructor(private stillWanted: (id: number) => boolean) {}

  private set(patch: Partial<AiState>): void {
    Object.assign(this.state, patch);
    this.onState(this.state);
  }

  /** Download (or load from cache) and start the model. Resolves false if it cannot run here. */
  async load(): Promise<boolean> {
    if (this.state.status === 'loading' || this.state.status === 'ready') return this.state.status === 'ready';
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    if (!gpu) {
      this.set({ status: 'unavailable', text: 'AI minds unavailable: this browser has no WebGPU. Running on rules.' });
      return false;
    }
    this.set({ status: 'loading', progress: 0, text: 'Checking WebGPU…' });
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) throw new Error('no WebGPU adapter');
      const model = adapter.features.has('shader-f16') ? MODEL_F16 : MODEL_F32;
      this.set({ model, text: 'Starting model download…' });
      const webllm = await import('@mlc-ai/web-llm');
      const worker = new Worker(new URL('./llmWorker.ts', import.meta.url), { type: 'module' });
      this.engine = (await webllm.CreateWebWorkerMLCEngine(worker, model, {
        initProgressCallback: (p: { progress: number; text: string }) => {
          this.set({ progress: p.progress, text: p.progress < 1 ? `Loading AI minds ${Math.round(p.progress * 100)}%` : 'Warming up…' });
        },
      })) as unknown as Engine;
      this.set({ status: 'ready', progress: 1, text: 'AI minds on' });
      this.pump();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.set({ status: 'unavailable', text: `AI minds unavailable (${msg.slice(0, 80)}). Running on rules.` });
      this.queue.splice(0).forEach((j) => j.done(null));
      return false;
    }
  }

  get ready(): boolean {
    return this.state.status === 'ready';
  }

  private enqueue(job: Job): void {
    if (!this.ready) { job.done(null); return; }
    this.queue.push(job);
    this.queue.sort((a, b) => a.priority - b.priority);
    this.set({ queue: this.queue.length });
    this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy || !this.engine) return;
    this.busy = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift() as Job;
      this.set({ queue: this.queue.length });
      if (!job.wanted()) { job.done(null); continue; }
      const t0 = performance.now();
      let reply: string | null = null;
      try {
        const res = await Promise.race([
          this.engine.chat.completions.create({
            messages: [{ role: 'system', content: job.chat.system }, { role: 'user', content: job.chat.user }],
            max_tokens: job.chat.maxTokens,
            temperature: 0.7,
          }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000)),
        ]);
        reply = res.choices[0]?.message.content ?? null;
      } catch {
        reply = null;
      }
      const sec = (performance.now() - t0) / 1000;
      this.totalSec += sec;
      const calls = this.state.calls + 1;
      this.set({ calls, avgSec: this.totalSec / calls, failures: this.state.failures + (reply === null ? 1 : 0) });
      job.done(reply);
    }
    this.busy = false;
  }

  /** Drop everything queued (used by Fast skip and when a new run starts). */
  clear(): void {
    this.queue.splice(0).forEach((j) => j.done(null));
    this.set({ queue: 0 });
  }

  decide(req: DecisionRequest, resolve: (choice: number, reason: string) => void): void {
    this.enqueue({
      priority: req.kind === 'dilemma' ? 1 : 2,
      chat: decisionPrompt(req),
      wanted: () => this.stillWanted(req.id),
      done: (reply) => {
        const parsed = reply ? parseChoice(reply, req.options.length) : null;
        // Unparseable replies are ignored; the sim applies its rule choice at the deadline.
        if (parsed) resolve(parsed.choice, parsed.reason);
        else if (reply !== null) this.set({ failures: this.state.failures + 1 });
      },
    });
  }

  newspaper(req: NewsRequest, done: (headline: string, blurb: string) => void): void {
    this.enqueue({
      priority: 3, chat: newsPrompt(req), wanted: () => true,
      done: (reply) => {
        const parsed = reply ? parseNews(reply) : null;
        if (parsed) done(parsed.headline, parsed.blurb);
      },
    });
  }

  /** Free-form flavour text (inner voice, final chronicle). Jumps the queue. */
  say(chat: Chat): Promise<string | null> {
    return new Promise((res) => {
      this.enqueue({ priority: 0, chat, wanted: () => true, done: (reply) => res(reply ? reply.replace(/^["“]|["”]$/g, '').trim() : null) });
    });
  }
}
