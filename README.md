# HUNDRED

100 people, 100 days, one small 3D town, simulated entirely in your browser. Watch from above like SimCity, drop down to street level like The Sims, then read the Day 100 report on what changed. Rerun the same seed with one policy changed and get a different town.

Static site: no backend, no API keys, no downloaded art. Everything (buildings, people, textures, icons) is generated in code.

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm test           # Vitest
npm run sim -- --days 100 --seed 42   # headless 100-day run with invariant checks
npm run typecheck
```

`npm run sim` prints the then-vs-now numbers, the money ledger, stories, and fails if any invariant breaks (NaN values, stuck agents, population out of 60 to 128, money leaking, or two same-seed runs hashing differently). `sh scripts/seeds.sh` compares six seeds side by side.

## Deploy (Vercel, Netlify, GitHub Pages, any static host)

`vercel.json` is included. Import the repo in Vercel and deploy, or run `npx vercel`. Build command `npm run build`, output directory `dist`. Asset paths are relative, so it also works from a sub-path. No special headers are needed.

## Controls

Drag to pan, right-drag or `Q`/`E` to rotate, scroll or `+`/`-` to zoom from city to street, click a person or building. `Space` pauses, `1` `2` `3` set 1x / 5x / 30x, `F` follows the selected person, `Esc` deselects.

## The AI minds

On load the app downloads a small instruct model (Llama 3.2 1B, 4-bit) through [WebLLM](https://github.com/mlc-ai/web-llm) and runs it in a Web Worker on WebGPU. It is cached after the first visit. The town starts on rules and switches over when the model is ready. Without WebGPU, or if loading fails, the app says so and runs on rules.

The model is called rarely and can only choose from a numbered list:

| Use | Per sim day |
|---|---|
| Daily intentions (who steers their next few days) | 8 |
| Dilemmas (steal, quit, move in together, report a friend, leave town) | 3 |
| Newspaper headline | 1 |

That is the default budget of 12 automatic calls per sim day, adjustable from 0 to 30 under God tools. Inner voice (click "Listen in") and the final chronicle sit outside it. The minute-to-minute tick never waits on the model: dilemmas resolve within 60 sim minutes or the rule choice applies, and at 30x and Skip the clock holds at dawn (with a 20 second timeout) while the night's calls finish. **Fast skip (no AI)** makes zero calls.

Measured here: about 0.5 s per call, so a 100-day run with AI on takes roughly 6 to 8 minutes of wall time at the default budget, versus about 10 seconds for Fast skip. Lower the budget to trade intelligence for speed. Replies that do not parse fall back to the rule choice, and every model decision is logged so a run can be replayed exactly from its log (covered by a test).

## Architecture

```
src/sim/      deterministic simulation: pure TypeScript, no DOM, no Three.js, seeded RNG only
src/render/   Three.js scene: procedural city, instanced humanoid peds, day/night, camera
src/ui/       DOM panels: top bar, feed, inspector, town charts, report, god tools
src/mind/     LlmMind (WebLLM in a Worker, default) and RuleMind (fallback, tests, headless)
scripts/      headless runner
```

Data flows one way: sim to render and UI. User input goes back through explicit sim API calls (speed, god tools). One tick is one sim minute. Peds are drawn with one `InstancedMesh` per body part (about a dozen draw calls for everyone) with a procedural walk cycle, and positions are interpolated from the sim. Paths between all building doors are cached once. All balance constants live in `src/sim/config.ts`.

Systems that make Day 100 differ from Day 1: an economy with export-demand shocks and business closures, relationships with gossip and reputation, crime and policing, contagious illness, and migration. See `plan.md` for the full design.
