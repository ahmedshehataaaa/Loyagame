# ADR 0002: Detach mcdonalds/ from Krispy Kreme's live Vercel project

**Date:** 2026-08-06 · **Status:** Accepted (partial — new link still needed)

## Context

`mcdonalds/.vercel/project.json` and `krispy-kreme/.vercel/project.json`
contained the **identical** `projectId`
(`prj_y9kuQXsAAfFLWqqa9dzO6sp6NWu5`) and `projectName: "krispy-kreme"`.
Queried via the Vercel MCP `get_project` tool: this project has a real
`production` deployment and three public `*.vercel.app` domains — it is
live. `mcdonalds/` was forked from `krispy-kreme/` by copying the folder,
including its `.vercel` link, without relinking.

## Decision

Renamed `mcdonalds/.vercel` → `mcdonalds/.vercel.krispy-kreme-link.bak`
(reversible — nothing deleted). This was deliberately the *smaller* action:
provisioning a brand-new Vercel project via API was considered and rejected
for this pass, since creating cloud resources on the user's account without
them choosing the name/team/settings is a bigger, less reversible action
than the approval given ("relink to its own project") covered.

## Consequences

- Running `vercel` or `vercel deploy` inside `mcdonalds/` will now prompt to
  create/select a project fresh, instead of silently deploying over Krispy
  Kreme's production site.
- **A real link (new or existing McDonald's-specific project) is required
  before `mcdonalds/` can be deployed at all.** This is a prerequisite for
  the `release-manager` agent's preview-deploy responsibilities — see
  `.claude/agents/release-manager.md`.
- `krispy-kreme/.vercel/project.json` was **not** touched — it's still
  correctly linked to its own (shared, as it happens) project.
