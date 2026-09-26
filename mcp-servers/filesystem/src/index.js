#!/usr/bin/env node
/**
 * AgentForge — filesystem MCP server
 *
 * Exposes three tools over the Model Context Protocol for working with
 * versioned text drafts (reports, articles, whatever the Writer agent
 * produces):
 *
 *   write_draft({ name, content })      -> saves a new version, returns its version number
 *   read_draft({ name, version? })      -> reads a specific version, or the latest if omitted
 *   list_drafts({ name? })              -> lists all draft names, or all versions of one draft
 *
 * Every write creates a NEW version file rather than overwriting — this is
 * what lets the Writer/Reviewer revision loop (milestone 4) keep every
 * draft round instead of losing earlier attempts.
 *
 * Storage: flat files under ./workspace, one subfolder per draft name.
 * Transport: stdio (spawned as a child process by the orchestrator, same
 * pattern as the web-search MCP server).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = path.join(__dirname, "..", "workspace");

const server = new McpServer({
  name: "agentforge-filesystem",
  version: "0.1.0",
});

/**
 * Draft names come from the LLM, so they're untrusted input. Restrict to a
 * safe character set and reject anything that could be a path-traversal
 * attempt (../, absolute paths, etc.) before it ever touches the filesystem.
 */
function sanitizeName(name) {
  if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(name)) {
    throw new Error(
      `Invalid draft name "${name}". Use only letters, numbers, hyphens, and underscores (max 100 chars).`
    );
  }
  return name;
}

function draftDir(name) {
  return path.join(WORKSPACE_DIR, sanitizeName(name));
}

async function nextVersionNumber(name) {
  const dir = draftDir(name);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return 1; // directory doesn't exist yet — this is the first version
  }
  const versions = files
    .map((f) => f.match(/^v(\d+)\.md$/))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  return versions.length ? Math.max(...versions) + 1 : 1;
}

server.registerTool(
  "write_draft",
  {
    title: "Write Draft",
    description:
      "Save a new version of a named draft (a report, article, or any " +
      "text output). Each call creates a NEW version — it never " +
      "overwrites a previous one — so earlier attempts stay recoverable. " +
      "Use this whenever you produce a draft that later steps (a " +
      "reviewer, or the end user) need to read back.",
    inputSchema: {
      name: z
        .string()
        .describe("Short identifier for this draft, e.g. 'q3-report' (letters, numbers, -, _ only)"),
      content: z.string().describe("The full text content of this draft version"),
    },
  },
  async ({ name, content }) => {
    const dir = draftDir(name);
    await fs.mkdir(dir, { recursive: true });
    const version = await nextVersionNumber(name);
    const filePath = path.join(dir, `v${version}.md`);
    await fs.writeFile(filePath, content, "utf-8");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ name, version, savedAt: new Date().toISOString() }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "read_draft",
  {
    title: "Read Draft",
    description:
      "Read a draft's content. Omit 'version' to get the most recent one.",
    inputSchema: {
      name: z.string().describe("The draft's identifier"),
      version: z
        .number()
        .int()
        .optional()
        .describe("Specific version number to read; omit for the latest"),
    },
  },
  async ({ name, version }) => {
    const dir = draftDir(name);
    const resolvedVersion = version ?? (await nextVersionNumber(name)) - 1;

    if (resolvedVersion < 1) {
      return {
        content: [{ type: "text", text: `No draft named "${name}" exists yet.` }],
        isError: true,
      };
    }

    const filePath = path.join(dir, `v${resolvedVersion}.md`);
    try {
      const text = await fs.readFile(filePath, "utf-8");
      return {
        content: [{ type: "text", text: `[${name} v${resolvedVersion}]\n\n${text}` }],
      };
    } catch {
      return {
        content: [{ type: "text", text: `Version ${resolvedVersion} of "${name}" not found.` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_drafts",
  {
    title: "List Drafts",
    description:
      "List all draft names, or (if 'name' is given) all version numbers of one draft.",
    inputSchema: {
      name: z.string().optional().describe("If given, list versions of just this draft"),
    },
  },
  async ({ name }) => {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });

    if (name) {
      const dir = draftDir(name);
      let files = [];
      try {
        files = await fs.readdir(dir);
      } catch {
        // no versions yet
      }
      const versions = files
        .map((f) => f.match(/^v(\d+)\.md$/))
        .filter(Boolean)
        .map((m) => parseInt(m[1], 10))
        .sort((a, b) => a - b);
      return {
        content: [{ type: "text", text: JSON.stringify({ name, versions }, null, 2) }],
      };
    }

    let entries = [];
    try {
      entries = await fs.readdir(WORKSPACE_DIR, { withFileTypes: true });
    } catch {
      // workspace doesn't exist yet
    }
    const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    return {
      content: [{ type: "text", text: JSON.stringify({ drafts: names }, null, 2) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);