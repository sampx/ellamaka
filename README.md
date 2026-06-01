<p align="center">
  <h1 align="center">Ellamaka</h1>
</p>
<p align="center">Train your agent once. Take it everywhere.</p>
<p align="center">
  <a href="https://github.com/wopal-cn/ellamaka/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/wopal-cn/ellamaka?style=flat-square&label=release" /></a>
  <a href="https://github.com/wopal-cn/ellamaka/actions/workflows/publish-ellamaka.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/wopal-cn/ellamaka/publish-ellamaka.yml?style=flat-square" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" /></a>
</p>

---

You spent weeks dialing in an AI agent. It learned your code style. It understood your project structure. It knew when to ask and when to just get things done.

Then you started a new project.

Back to zero. Rewrite the rules. Redefine the agents. Rebuild every workflow. Everything you taught it was trapped in the old directory.

Ellamaka fixes exactly this: **your agent setup becomes an asset you can carry.**

## How

Ellamaka is the execution engine for [WopalSpace](https://github.com/wopal-cn/wopal-space-ontology), built on [OpenCode](https://github.com/anomalyco/opencode). Its core innovation: upgrading agent configuration from scattered files to a structured ontology.

An ontology is everything you've defined for your agent — personality, commands, skills, permissions — organized in `.wopal/`, versioned like code. Then:

```text
Project A: you build a great agent setup
   │
   │  Fork the ontology
   ▼
Project B: your agent shows up fully trained. You focus on the project,
           not on retraining.
```

The ontology travels. Your memories stay. Your workflows get cloned. Your private context stays private.

## vs OpenCode

OpenCode is a powerful general-purpose AI coding agent. Ellamaka takes that foundation and adds one thing: **agent configuration as a first-class asset.**

| | OpenCode | Ellamaka |
|---|---|---|
| Configuration model | Per-project, starts fresh every time | Ontology-level, reusable across projects |
| Release cadence | Continuous, APIs shift frequently | Curated upstream merges, predictable behavior |
| Runtime | CLI + Web UI + Desktop | CLI + Web UI, focused on what matters |
| Data isolation | Shares system paths | Separate data directory, zero interference |
| Extension model | In-project plugins | Ontology-level plugins + skills, fork and carry |

## Try It

Ellamaka works standalone or as part of WopalSpace:

```bash
# Install
wopal ellamaka install

# Or download directly: https://github.com/wopal-cn/ellamaka/releases

# Launch anywhere — it's your AI partner
ellamaka

# Launch in WopalSpace — loads your space ontology
ellamaka --wopal-space
```

## Development

| I want to | Command |
|---|---|
| Start dev environment | `./scripts/dev.sh` |
| Build a local binary | `./scripts/build.sh` |
| Build with branding | `bun packages/ellamaka/build.ts` |
| Typecheck | `bun typecheck` |
| Clean up after upstream merge | `./scripts/check-cleanup.sh --clean` |
| Browse API docs | `bun ./scripts/scalar-doc.ts` |

See `AGENTS.md` for the full picture.

## More

| Document | Content |
|---|---|
| `docs/DESIGN.md` | Architecture and WopalSpace adaptations |
| `docs/DISTRIBUTION.md` | Release workflow and artifact specs |
| `docs/BRANDING.md` | Branding changes |
| `docs/UPSTREAM-MERGE-LOG.md` | Upstream merge history |

## License

Forked from OpenCode. MIT. See `LICENSE`.