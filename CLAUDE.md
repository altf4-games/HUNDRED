# CLAUDE.md

## Project

**HUNDRED** (working title): a 3D browser simulation of a small city with 100 human-looking agents living through 100 days, ending in a report of what changed. SimCity view from above, Sims view up close.

`plan.md` is the source of truth for scope, design and milestone order. Read it before starting work. Tick off the Progress checklist in `plan.md` as milestones finish.

## Commands

```
npm run dev                              # Vite dev server
npm run build                            # production build to dist/
npm test                                 # Vitest
npm run sim -- --days 100 --seed 42      # headless 100-day run with invariant checks
npm run typecheck                        # tsc --noEmit
```

## Non-negotiable rules

1. **Static site only.** No backend, no API keys, no paid services, no network calls at runtime except the optional model download.
2. **No downloaded art.** Buildings, peds, textures and icons are all procedural (geometry, canvas textures, emoji).
3. **3D only.** No 2D map mode.
4. **Peds must look human.** Head, hair, torso, arms, legs, skin tones, clothes, walk cycle. Never capsules, cubes or dots.
5. **LLM on by default, strictly budgeted.** The in-browser model sets agents' intentions and resolves dilemmas under a hard cap of 12 automatic calls per sim day (plan.md section 8). Minute-to-minute behaviour is rule-based. The sim must still run a full 100 days on `RuleMind` when the model is unavailable.
6. **`src/sim/` is pure.** It must not import Three.js, touch the DOM, or import from `render/`, `ui/` or `mind/`. It has to run in Node.
7. **Determinism.** All randomness in `src/sim/` goes through the seeded RNG in `rng.ts`. Never `Math.random()` or `Date.now()` in sim code. With `RuleMind`, the same seed gives the same state hash. With `LlmMind`, every model decision is logged so the run can be replayed from its log.

## Architecture

```
src/sim/      deterministic simulation (no DOM, no Three.js)
src/render/   Three.js scene; reads sim state, never writes it
src/ui/       DOM panels; talks to the sim through its public API only
src/mind/     LlmMind (default, WebLLM in a Worker) and RuleMind (fallback, tests)
scripts/      headless runner
```

- Data flows one way: `sim` to `render` and `ui`. User input goes back through explicit sim API calls (set speed, god tools).
- Sim ticks on a fixed step (1 tick = 1 sim minute). Rendering interpolates positions between ticks.
- The `Mind` interface is defined in `src/sim/` (types only) and injected into the sim. `src/sim/` never imports the implementations.
- Peds are drawn with one `InstancedMesh` per body part. Buffer size is 128. Do not create a mesh per ped.
- Use `WebGLRenderer`, not the WebGPU renderer.

## How to work

- **Follow the milestone order in plan.md.** Each milestone must end with a working app and a commit. Do not start P2 items before M7 is done.
- **Sim features go headless first.** Write the system, add tests, run `npm run sim`, then wire up visuals.
- **Check visuals by looking.** After render or UI changes, run the dev server, open it in the browser, and take screenshots at city zoom and street zoom. Fix what looks wrong before moving on. Pay particular attention to ped proportions and the walk cycle.
- **Tune with numbers.** When balancing the economy or social systems, run several seeds headless and compare the daily metrics. Do not tune by guesswork.
- **Keep tunables together.** All balance constants live in `src/sim/config.ts` with a short comment each.
- **Do not gold-plate.** If a milestone's "done when" is met, move on. If time is short, follow the cut-lines in plan.md section 11.

## Before every commit

- `npm run typecheck` passes
- `npm test` passes
- `npm run sim -- --days 100 --seed 42` passes all invariants
- The app loads with no console errors

## Invariants the headless run must check

- No NaN or infinite values in agent or business state
- No agent stuck in the same action for more than one sim day
- Population stays between 60 and 128
- Money only enters or leaves through defined sources and sinks (export income, migration, fines, etc.)
- Two runs with the same seed give identical state hashes

## Performance budgets

- 60 FPS at 1x with 100 peds on a laptop GPU
- 100 days headless in under 30 seconds
- In-browser Skip to Day 100 in under about a minute
- Initial bundle (without the model) under about 1.5 MB
- Automatic model calls never exceed the daily budget

## LLM layer

- Look up the current WebLLM documentation for the API and available model IDs before writing this code. Do not rely on memory for either.
- On by default: load the model at startup with a progress bar; the sim may start on `RuleMind` and switch when the model is ready. If WebGPU is unavailable or loading fails, stay on `RuleMind` and show a notice.
- All calls go through the `Mind` interface and one queue. One call at a time, outputs under ~80 tokens.
- Enforce the budget in code: 12 automatic calls per sim day by default (8 intentions, 3 dilemmas, 1 newspaper), adjustable 0 to 30. Inner voice on click is outside the budget but cached per agent per day.
- The model only ever chooses from a numbered list (intention tags or dilemma options). Replies that do not parse fall back to the rule choice.
- The per-minute tick never awaits a model call. Dilemmas resolve asynchronously with a 60 sim-minute deadline. The only place the clock may hold is the dawn gate at 30x and Skip, and it must have a timeout.
- "Fast skip (no AI)" makes zero calls.
- Measure seconds per call on the first working version and report the projected time for a 100-day run. Lower the default budget if it is unreasonable.
- Headless runs and tests always use `RuleMind`.

## Code style

- TypeScript strict. No `any` in `src/sim/`.
- Plain data objects and functions in the sim. Avoid class hierarchies.
- Small files, one system per file.
- Comments explain why, not what.

## Common pitfalls

- Real-world walking speeds make peds look frantic at 1x. Use the tuned speed described in plan.md section 5.1.
- Recomputing paths every tick. Use the precomputed door-to-door cache.
- Allocating vectors or matrices inside the render loop. Reuse scratch objects.
- Letting UI code mutate sim state directly.
- Updating DOM panels every frame. Throttle to a few times per second.
