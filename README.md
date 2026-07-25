# ALS Refactored for React Three Fiber

A standalone web port of [ALS Refactored](https://github.com/Sixze/ALS-Refactored), built on React Three Fiber and Rapier with the native `SK_Als` skeleton.

This repository is a reference implementation and forkable template for ALS-grade locomotion on the web. It is still in active parity work: [ROADMAP.md](./ROADMAP.md) is the authoritative status, and [AGENTS.md](./AGENTS.md) defines the source-of-truth and contribution rules.

## Run locally

Requirements: Node.js 24+ and pnpm 11.15.1.

```sh
pnpm install
pnpm dev
```

Click the scene to lock the pointer.

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look |
| Tap / hold `Shift` | Roll / Sprint |
| Left `Alt` | Toggle Walking / Running |
| Left `Ctrl` | Toggle Standing / Crouching |
| `Space` | Jump / mantle |
| Right mouse | Aim |
| `1` | Toggle VelocityDirection / ViewDirection |
| `2` | Toggle first / third person |
| `C` | Switch shoulder |
| Hold `Q` + wheel | Select overlay mode in slow motion; release to apply |

## Verify

```sh
pnpm check
pnpm lint
pnpm e2e
```

`pnpm check` runs the pure-module test suite and production build. The Playwright smoke owns its local Vite server and runs serially.

## Scope and licensing

Gameplay systems beyond ALS locomotion belong in downstream forks. ALS-derived assets under `public/assets/` retain the upstream MIT notice in [`LICENSE-ALS-Refactored.md`](./public/assets/LICENSE-ALS-Refactored.md). A license for this port's original source code must be selected before public distribution.
