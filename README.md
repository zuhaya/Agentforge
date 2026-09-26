# AgentForge

A multi-agent AI system where specialized agents (Researcher, Writer, Reviewer)
collaborate on a task and connect to **real external tools** through the
**Model Context Protocol (MCP)** — instead of just generating text from an
LLM's memory.

> **Status: Milestone 1 complete.** A single agent, backed by a real MCP
> tool server, running an end-to-end tool-use loop against Groq's free
> API. Multi-agent orchestration (Researcher → Writer → Reviewer) and the
> React frontend are built on top of this same loop in later milestones.
>
> **Cost: $0.** This project runs entirely on Groq's free tier (no credit
> card required) and a free-tier search API. See "Running it locally"
> below.

## Why MCP, and not just function calling?

Anthropic's tool-use API lets a model call functions you define inline.
MCP goes one step further: it's an open, model-agnostic **protocol** for
exposing tools/resources as standalone servers that any MCP-compatible
host can connect to. That means AgentForge's `web-search` tool isn't
wired into one prompt — it's a reusable server any agent (or any other
MCP host, like Claude Desktop) could plug into. This project treats MCP
servers as the tool layer and the orchestrator as just one possible host
consuming them.

## Architecture

```
Browser (React)
      │
      ▼
Express orchestrator  ──spawns──▶  MCP server(s) over stdio
      │                              (mcp-servers/web-search, ...)
      ▼
Groq API (tool-use loop, free tier)
```

1. A task comes in to the orchestrator.
2. The orchestrator connects to each configured MCP server, lists its
   tools, and translates their schemas into OpenAI-style function-calling
   format (Groq's API is OpenAI-compatible).
3. The model decides which tool(s) to call. The orchestrator routes each
   call to the right MCP server, gets a result, and feeds it back.
4. This repeats until the model returns a final answer (capped at
   `MAX_TOOL_ROUNDS` to keep demos bounded).

**Why Groq and not Claude/OpenAI?** Groq's free tier requires no credit
card and is fast enough that the tool-calling loop (several round trips
per task) doesn't feel sluggish. The agent loop lives entirely in one
file (`src/agent.js`), so swapping providers later — Claude, OpenAI, a
local model via Ollama — is a contained change, not a rewrite.

## Repo structure

```
agentforge/
├── apps/
│   ├── web/              # React + Vite + Tailwind (not yet built)
│   └── orchestrator/      # Express — agent loop, Claude calls, MCP client
│       └── src/
│           ├── index.js       # HTTP server, /api/task route
│           ├── agent.js       # the actual tool-use agent loop (Groq)
│           └── mcpClient.js   # spawns + talks to MCP servers over stdio
├── mcp-servers/
│   └── web-search/        # MCP server: web_search tool (Tavily-backed)
└── package.json            # npm workspaces root
```

## Running it locally

```bash
npm install                                  # from repo root, installs all workspaces
cp apps/orchestrator/.env.example apps/orchestrator/.env
# edit apps/orchestrator/.env and set GROQ_API_KEY (required, free —
# get one with no credit card at https://console.groq.com/)
# TAVILY_API_KEY is optional — without it, web_search returns mock
# results so you can still exercise the whole pipeline for free.

npm run dev:orchestrator
```

Then:

```bash
curl -X POST http://localhost:3001/api/task \
  -H "Content-Type: application/json" \
  -d '{"task": "What is the Model Context Protocol?"}'
```

The orchestrator will spawn the `web-search` MCP server as a child
process automatically — you don't run it separately.

## Build plan / roadmap

- [x] **Milestone 1** — single agent, single MCP tool, end-to-end loop against Claude
- [ ] **Milestone 2** — second MCP server (`filesystem`, for versioned drafts)
- [ ] **Milestone 3** — split into Researcher → Writer agents with shared state
- [ ] **Milestone 4** — add Reviewer + bounded revision loop
- [ ] **Milestone 5** — React frontend (task input → loading state → final report)
- [ ] **Milestone 6** — polish: architecture diagram, demo video, deploy

## Tech stack

React, Vite, Tailwind, Node.js, Express, Groq API (free tier, Llama
models), Model Context Protocol (`@modelcontextprotocol/sdk`), MongoDB
(planned, for a `memory` MCP server).
