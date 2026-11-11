# HUNDRED — plan.md

*Working title. 100 agents, 100 days, one small 3D city, running entirely in the browser.*

## 1. What we are building

A SimCity-meets-The-Sims simulation. A small 3D city (homes, school, clinic, police station, town hall, shops, factory, park) is populated by 100 human-looking agents who live out their days: sleep, commute, work, study, eat, make friends, fall out, get sick, lose jobs, commit crimes, leave town. The player watches from a city-wide view, zooms down to street level, and follows any individual. After 100 simulated days the app produces a report showing what changed in the town and in individual lives.

**The pitch in one line:** press play on Day 1, come back on Day 100, and read how the town turned out, then rerun the same seed with one policy changed and see a different town.

## 2. Hard constraints

| Constraint | Consequence |
|---|---|
| Must be mostly finished in one build session | Milestones ordered so every one ends in a demoable state. Clear cut-lines (P0 / P1 / P2). |
| LLM on by default, but few calls | An in-browser model steers agents' goals and big decisions out of the box, under a hard daily call budget (about 12 per sim day). Minute-to-minute behaviour is rule-based (utility AI). If the model cannot load, the app falls back to rules and says so. |
| 3D only | Three.js scene, no 2D map mode. Camera goes from city overview to street level. |
| Peds look roughly human | Procedural low-poly humanoids with heads, torsos, arms, legs, hair, skin tones, clothes, walk cycle. No capsules or dots. |
| Runs locally on the web | Static site. No backend, no API keys, no paid services, no downloaded art assets. Everything procedural. |

## 3. Tech stack

- **Vite + TypeScript** (strict mode)
- **Three.js** with `WebGLRenderer` (widest compatibility; do not use the WebGPU renderer)
- **Vitest** for sim tests
- **Vanilla DOM + CSS** for UI (no React; keeps the bundle and the build simple)
- **Charts:** uPlot, or hand-rolled SVG if that is quicker
- **LLM:** WebLLM (WebGPU) in a Web Worker, loaded at startup with a progress bar. Check the current WebLLM docs for API and model IDs before writing this code.
- **Deploy:** GitHub Pages (static `dist/`)

## 4. Architecture

Three layers with a strict one-way dependency: `sim` knows nothing about `render` or `ui`.

```
src/
  sim/        pure TypeScript, deterministic, no DOM, no Three.js
    rng.ts          seeded PRNG (the only source of randomness)
    world.ts        grid, buildings, path cache
    agent.ts        agent state, traits, needs
    brain.ts        utility AI: pick next action
    actions.ts      action definitions and effects
    social.ts       interactions, relationships, gossip
    economy.ts      wages, prices, rent, tax, businesses
    crime.ts        theft, fights, police, jail
    health.ts       illness, contagion, clinic
    migration.ts    leavers and newcomers
    events.ts       typed event log
    metrics.ts      daily snapshots
    sim.ts          tick loop, public API
  render/     Three.js: city meshes, instanced peds, camera, lighting
  ui/         HUD, inspector, event feed, report, god tools
  mind/       LLM layer (default) + rule/template fallback
  main.ts
scripts/
  run-sim.ts  headless runner (Node): npm run sim -- --days 100 --seed 42
```

**Why this split matters:** the sim can be run headless in Node. That gives fast tests, a 100-day run in seconds, and a determinism check (same seed gives the same final state hash).

## 5. Simulation design

### 5.1 Time

- 1 tick = 1 simulated minute. 1,440 ticks per day, 144,000 for 100 days.
- Agents only make a decision when their current action ends, so most ticks per agent are a cheap counter decrement.
- Speeds: **1x** (1 sim minute per real second, a day takes 24 minutes), **5x**, **30x**, and **Skip** (rendering throttled, runs to a chosen day as fast as possible).
- **Time-compression cheat:** do not use real-world walking speeds. Tune ped speed so walking looks natural at 1x (about 2 tiles per second on screen) and the longest commute is under about 30 sim minutes.

### 5.2 The city

- Grid of roughly 64 x 64 tiles. Seeded block-grid generator with a fixed zoning template: civic centre in the middle, shops around it, housing outside, industry on one edge, park near the centre.
- Buildings (about 55 total):
  - **Housing:** ~30 houses, 3 apartment blocks (4 households each)
  - **Civic:** school, clinic, police station (with jail), town hall
  - **Commerce:** grocery, general store, cafe, restaurant, bar
  - **Industry:** factory, office, farm
  - **Leisure:** park
- Every building has a door tile. Paths between all door pairs are precomputed once (BFS over road tiles) and cached.

### 5.3 The people

- 100 agents at start: about 18 children (6 to 17), 70 working-age adults, 12 seniors. Grouped into about 38 households. Hard cap of 128 agents (instancing buffer size).
- **Traits** (0 to 1, fixed): sociability, ambition, honesty, impulsivity, resilience.
- **Needs** (0 to 1, decay over time): hunger, energy, social, fun, health. Plus money stress derived from cash vs. upcoming rent.
- **State:** age, household, job, cash, skill, mood, reputation, relationships (sparse map of affinity and familiarity), memory (ring buffer of the last ~30 notable events).
- Generated from the seed using name lists and templates. No LLM needed.

### 5.4 Decisions (utility AI, steered by the LLM)

- Each role has a schedule skeleton: work shift, school hours, sleep window.
- In free time the agent scores every available action and takes the best:
  `score = need urgency x trait modifier x intention bias x feasibility + small seeded noise`
- Actions: sleep, eat at home, eat out, go to work, go to school, shop, socialise (visit a friend, bar, cafe, park), relax, job hunt, see doctor, steal, leave town.
- **Intentions** are how the LLM steers behaviour without being called every tick. An intention is a tag from a fixed list (for example `find-better-job`, `save-money`, `go-out-more`, `reconcile-with:X`, `confront:X`, `lie-low`, `look-after-family`) that biases the utility weights for a few days. The model sets them (section 8); a rule-based picker sets them when the model is unavailable.

### 5.5 Systems that create change over 100 days

These are what make Day 100 differ from Day 1. Each is small on its own; the interest comes from them interacting.

- **Economy.** Businesses pay wages from their own cash. Agents spend on food, goods, leisure, rent. Town hall collects tax and pays teachers, police, clinic staff. Factory, office and farm earn outside income from an "export demand" value that drifts randomly, which is the main source of shocks. A business short of cash lays staff off; one that stays broke closes.
- **Relationships.** Agents who share a place and have free time may interact. Affinity moves based on trait compatibility and mood. Thresholds produce friend, close friend, rival, dating, partner, move in together, break up.
- **Gossip and reputation.** Interactions can pass on a memory. Known crimes lower public reputation, which affects hiring and friendships.
- **Crime.** Desperate, low-honesty agents may steal. Fights can break out in the bar. If witnessed, it is reported; arrest chance depends on police staffing. Jail time, fines, risk of job loss.
- **Health.** Random illness, more likely when needs are low. Spreads by contact, so flu waves emerge. Clinic visits cost money and speed recovery. Rare deaths.
- **Migration.** Agents who are unemployed and unhappy for long enough leave. Newcomers arrive when there are vacant homes and open jobs.

### 5.6 Events and metrics

- Every notable thing is a typed event with a severity: `hired`, `fired`, `befriended`, `partnered`, `brokeUp`, `theft`, `arrest`, `fellIll`, `died`, `businessClosed`, `movedAway`, `movedIn`, and so on.
- Events feed the on-screen ticker, agent memories, the newspaper and the final report.
- One metrics snapshot per day: population, mean mood, employment rate, mean and median wealth, Gini coefficient, crimes, illnesses, price index, open businesses, friendships, couples.

## 6. 3D presentation

### 6.1 City

- Procedural buildings from boxes and simple roofs, coloured by type, each with a readable sign (canvas-text sprite or icon).
- Roads with lane markings, trees and benches in the park, street lamps.
- Day/night cycle: sun direction and sky colour follow the clock. Windows glow at night in occupied buildings.
- One directional light with a shadow map for buildings. Blob shadows under peds (cheap).

### 6.2 Peds

- Built from about 8 parts: head, hair, torso, hips, two arms, two legs. One `InstancedMesh` per part with per-instance colour, so 100 peds cost about 8 draw calls.
- Variety: skin tone palette, 3 to 4 hair shapes and colours, clothing colours, height (children smaller, seniors slightly stooped).
- Job outfits where it reads clearly: police in blue, clinic staff in white, children with backpacks.
- Two dark eye dots so faces read as human when zoomed in.
- Procedural animation: arm and leg swing while walking, slight idle sway, turn to face the direction of travel.
- Indoors: peds fade out at the door. Hovering a building lists who is inside. (Roof cutaway is P2.)

### 6.3 Camera

- Pan, rotate, zoom. Tilt changes with zoom: near top-down when far out, near eye level when close.
- Click a ped to select; a follow mode tracks them smoothly.
- Level of detail by distance: far away shows building icons only; up close shows name tags and emoji thought bubbles (asleep, hungry, chatting, broke). Bubbles are rule-based, not LLM.

## 7. UI

- **Top bar:** day and clock, speed buttons, Skip to day N, seed display.
- **Event ticker:** scrolling feed of notable events; clicking one jumps the camera there.
- **Inspector (selected ped):** name, age, job, household, need bars, mood, cash, traits, top relationships, recent memories, current action.
- **Town panel:** live mini-charts of the key metrics.
- **Report screen:** see section 9.
- **God tools (P1):** close the factory, stimulus payment, flu outbreak, double the police.

## 8. LLM layer (on by default, hard-capped)

The model is part of the default experience and changes what agents do. It is called rarely, at the moments where it matters most.

### 8.1 Loading

- On first launch the app downloads a small instruct model (1B to 3B, 4-bit) via WebLLM with a progress bar, then caches it. The sim can start on rules while the download finishes and switches over when the model is ready.
- If WebGPU is missing or the load fails, the app runs on the rule-based fallback and shows a clear "AI minds unavailable" notice.
- Everything goes through one `Mind` interface with two implementations: `LlmMind` (default) and `RuleMind` (fallback, also used in tests).
- One Worker, one request queue, one call at a time, outputs under ~80 tokens.

### 8.2 What the model does

| Use | Effect on the sim | When | Budget per sim day |
|---|---|---|---|
| **Daily intentions** | Sets an agent's intention tag (section 5.4), which biases their choices for the next few days | Overnight batch, for the agents whose lives changed most (fired, new partner, arrested, broke, ill) plus a rotating few | 8 |
| **Dilemmas** | Picks one option from a numbered list: quit, steal, propose, report a friend, leave town | High-stakes moments during the day | 3 |
| **Newspaper** | Headline and blurb from the day's top events (flavour only) | End of day | 1 |
| **Inner voice** | A few first-person lines for the selected ped (flavour only) | On click, cached per agent per day | User-driven, outside the budget |
| **Final chronicle** | Narrative summary in the report | Once | 1 total |

- **Default budget: 12 automatic calls per sim day**, about 1,200 over a full run. A settings slider goes from 0 to 30.
- With 8 intention calls a day, every agent gets a model-set intention roughly every 12 days, and agents in crisis get one straight away.

### 8.3 Keeping it from slowing the sim

- **The per-minute tick never waits on the model.**
- **Intentions and newspaper** are queued at midnight and applied as they return. At 1x and 5x they finish in the background while the town sleeps.
- **Dilemmas** do not block. The agent "mulls it over" for up to 60 sim minutes (shown as a thought bubble). If no answer arrives in time, the utility choice is used.
- **At 30x and Skip**, the clock holds briefly at dawn until the night's batch is done, with a visible "town is thinking" indicator and a per-day timeout. Unfinished calls fall back to rules.
- **Fast skip (no AI)** is offered as a separate button for when speed matters more: zero calls, pure rules.

### 8.4 Keeping outputs safe to use

- Prompts are short: persona line, current state, last few memories, and a numbered list of allowed options.
- Replies must parse to a valid option or intention tag. Anything else falls back to the rule choice. The one-line reason the model gives is stored as a memory and shown in the inspector.
- Every model decision is written to the event log, so a run can be replayed exactly from its log even though the model itself is not deterministic.

## 9. The Day 100 report

- **Then vs. now cards:** population, employment, average mood, inequality, crime, open businesses.
- **Charts over time** for each daily metric, with major events marked.
- **Stories:** auto-picked standout agents, each with a short timeline built from their memories. Biggest rise, biggest fall, most connected, most notorious, a newcomer.
- **Town timeline:** the top ~20 events by severity.
- **Export:** download the full run as JSON.
- Available at any time, not only on Day 100.

## 10. Milestones

Do them in order. Each ends with a commit and a working app.

### M0. Scaffold
- Vite + TS + Three.js + Vitest. Folder layout from section 4. `npm run dev`, `npm test`, `npm run sim` all work.
- **Done when:** a blank Three.js canvas renders and one trivial test passes.

### M1. Sim core, headless (P0)
- Seeded RNG, world grid and buildings, path cache, agent generation, needs, schedules, utility brain with intention bias, basic actions, event log, daily metrics.
- Define the `Mind` interface now and ship `RuleMind`, so the intention and dilemma hooks exist from the start.
- **Done when:** `npm run sim -- --days 100 --seed 42` (using `RuleMind`) finishes in under 30 seconds, prints a summary, and passes invariants: no NaN, no agent stuck for more than a day, population within bounds, same seed gives the same state hash twice.

### M2. 3D city and peds (P0)
- Procedural city, lighting, day/night, camera controls, instanced humanoid peds with walk animation, positions driven by the sim.
- **Done when:** at 1x you can watch the morning commute from above, zoom to street level, and the peds read as people. 60 FPS with 100 peds.

### M3. UI (P0)
- Top bar with speeds and Skip, event ticker, ped selection and follow cam, inspector, thought bubbles.
- **Done when:** you can click any ped and understand who they are and what they are doing.

### M4. Deep systems (P0)
- Economy, relationships, gossip, crime and police, health and contagion, migration. Build and test each one headless first.
- **Done when:** two different seeds give visibly different Day 100 towns, and the money supply check passes (cash only enters or leaves through defined sources and sinks).

### M5. Report (P0)
- Report screen from section 9, JSON export.
- **Done when:** after a Skip to Day 100 the report tells a coherent story with charts and at least four agent stories.

### M6. LLM layer (P0)
- `LlmMind` via WebLLM in a Worker, startup loading with progress, overnight intention batch, dilemmas, newspaper, inner voice, budget enforcement, dawn hold at high speed, Fast skip button, fallback notice.
- **Done when:** a fresh load starts with AI minds on; over a 10-day run at 30x the call count stays within budget; the inspector shows model-set intentions with reasons; and with WebGPU disabled the app still runs a full 100 days on `RuleMind`.

### M7. Polish and ship (P1)
- God tools, performance pass, loading screen, README with architecture notes and screenshots, GitHub Pages deploy.
- **Done when:** the public URL works on a fresh machine.

### P2, only if there is time left
- Roof cutaway to see inside a selected building
- Same-seed A/B comparison (run twice with one policy changed, show the two reports side by side)
- Social network graph in the report
- Save and resume a run (IndexedDB)
- Ambient audio

## 11. Cut-lines

If the session is running short, drop in this order: P2 items, god tools, LLM newspaper and final chronicle, gossip, contagion. Never cut: the headless sim, humanoid peds, the zoom from city to street, the report, LLM daily intentions and dilemmas.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Sim settles into a boring steady state | Export-demand shocks, contagion, migration. Tune with the headless runner and compare seeds. |
| Economy explodes or collapses | Money supply invariant in tests. Clamp prices and wages to sane ranges. |
| Peds look stiff or toy-like | Budget real time for proportions and walk cycle in M2; check with close-up screenshots. |
| Small in-browser model returns junk | Numbered options only, strict parsing, rule fallback. |
| Model calls make fast-forward crawl | Hard daily budget, overnight batching, dawn hold with timeout, Fast skip (no AI) button. Measure seconds per call early in M6 and lower the default budget if a 100-day run would take too long. |
| Model download is large or WebGPU is missing | Start on rules while it downloads; cached after first load; clear fallback notice. |
| Agents get stuck | "Stuck for a day" invariant; fallback action is always "go home". |
| Scope creep | Follow milestone order. P2 stays untouched until M7 is done. |

## 13. Progress

- [x] M0 Scaffold
- [x] M1 Sim core
- [x] M2 3D city and peds
- [x] M3 UI
- [x] M4 Deep systems
- [x] M5 Report
- [x] M6 LLM layer
- [x] M7 Polish and ship (God tools, README, vercel.json; GitHub Pages workflow not needed, any static host works)
