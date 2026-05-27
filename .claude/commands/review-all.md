---
description: Dispatch the full Lancer review team — all 13 specialist agents run in parallel and report back into a single aggregated review.
argument-hint: "[optional: scope, e.g., 'src/components/RequestEditor', 'recent commits', 'before release']"
---

# /review-all — Full team review of Lancer

Run the entire Lancer review team in parallel. Aggregate findings into one prioritized report.

## Scope (from user)

$ARGUMENTS

If empty, review the **entire current working tree**.

## Agents to dispatch (in parallel, single message, multiple Agent tool calls)

### Group A — Frontend / Design
1. `ui-design-reviewer` — visual polish, Tailwind tokens, theme parity
2. `ux-flow-reviewer` — user journeys, friction, empty/error states
3. `a11y-reviewer` — WCAG 2.2, keyboard, screen reader
4. `react-code-reviewer` — React 19 + Zustand + TS quality

### Group B — Performance / Backend
5. `performance-reviewer` — bundle size, render hot paths, Tauri IPC
6. `tauri-rust-reviewer` — Rust idioms, command surface, capabilities
7. `storage-persistence-reviewer` — SQLite, .bru I/O, keyring

### Group C — Domain / Product
8. `api-client-domain-expert` — HTTP correctness, auth, transport
9. `postman-insomnia-competitive-reviewer` — feature gaps vs competitors
10. `importer-format-reviewer` — Postman/Insomnia/OpenAPI/cURL import

### Group D — Quality / Risk
11. `security-privacy-reviewer` — secrets, IPC, telemetry, supply chain
12. `testing-strategy-reviewer` — vitest + Rust test coverage and quality
13. `docs-consistency-reviewer` — README/SPEC/ROADMAP/CHANGELOG accuracy

## How to run

1. Send ONE message with 13 Agent tool calls — all in parallel
2. Pass the same scope ($ARGUMENTS or "entire repo") to each agent's prompt
3. Tell each agent to keep their report under 800 words (so aggregation stays readable)
4. After all 13 return, aggregate into a single report:

```
# Lancer Team Review — <date>
Scope: <what was reviewed>

## TL;DR
- N Critical, M High, K Medium findings across 13 agents
- Top 3 things to fix this week:
  1. ...
  2. ...
  3. ...

## Findings by severity (deduplicated across agents)

### Critical
- [<agent-name>] Title — `path:LN` — one-line summary
- ...

### High
...

### Medium
...

## Per-agent summaries
### ui-design-reviewer
<3-line summary + link/anchor to their detailed findings>

### ux-flow-reviewer
...
(etc for all 13)

## Cross-cutting themes
- E.g., "Three agents flagged the request editor as a hot spot"
- ...

## Strengths the team agreed on
- ...
```

5. When the same issue is flagged by multiple agents, deduplicate and credit all of them in brackets
6. Sort Critical/High findings to surface the cross-cutting ones first
7. Reply in Thai for prose; English for code paths and snippets

## Notes

- Each agent has its own confidence threshold (≥70%) — don't second-guess their filtering
- Don't add new findings of your own during aggregation; you're only deduplicating + prioritizing
- If a scope argument was given, remind each agent to stay within it
