#!/usr/bin/env node
/**
 * AgentForge — web-search MCP server
 *
 * Exposes one tool over the Model Context Protocol:
 *   web_search({ query, maxResults }) -> array of { title, url, snippet }
 *
 * Backed by the Tavily Search API (https://tavily.com). If TAVILY_API_KEY
 * is not set, falls back to a clearly-labeled mock result so the rest of
 * the pipeline (orchestrator -> Claude -> tool loop) can still be
 * exercised end-to-end without a paid key.
 *
 * Transport: stdio. This server is meant to be spawned as a child process
 * by the orchestrator (see apps/orchestrator/src/mcpClient.js), which is
 * the standard local-dev pattern for MCP servers.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_URL = "https://api.tavily.com/search";

const server = new McpServer({
  name: "agentforge-web-search",
  version: "0.1.0",
});

server.registerTool(
  "web_search",
  {
    title: "Web Search",
    description:
      "Search the live web and return a short list of relevant results " +
      "(title, url, snippet). Use this whenever you need current " +
      "information you don't already know.",
    inputSchema: {
      query: z.string().describe("The search query"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Maximum number of results to return (default 5)"),
    },
  },
  async ({ query, maxResults = 5 }) => {
    const results = TAVILY_API_KEY
      ? await searchWithTavily(query, maxResults)
      : mockSearch(query, maxResults);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }
);

async function searchWithTavily(query, maxResults) {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      max_results: maxResults,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

/** Deterministic fallback so the pipeline is demoable without an API key. */
function mockSearch(query, maxResults) {
  return Array.from({ length: Math.min(maxResults, 3) }).map((_, i) => ({
    title: `[MOCK — set TAVILY_API_KEY for real results] Result ${i + 1} for "${query}"`,
    url: "https://example.com/mock-result",
    snippet:
      "This is placeholder content. Set TAVILY_API_KEY in apps/orchestrator/.env " +
      "(the MCP server reads it from its own process env) to get real search results.",
  }));
}

const transport = new StdioServerTransport();
await server.connect(transport);
