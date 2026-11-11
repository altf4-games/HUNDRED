#!/bin/sh
# Compare several seeds side by side while tuning: sh scripts/seeds.sh
for s in 1 7 42 99 2024 31337; do
  npx tsx scripts/run-sim.ts --seed "$s" --brief
done
