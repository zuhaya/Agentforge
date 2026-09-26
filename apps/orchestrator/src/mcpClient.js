/**
 * Thin wrapper around the MCP TypeScript/JS SDK client.
 *
 * Each entry in MCP_SERVERS below is spawned as a child process speaking
 * MCP over stdio — the standard pattern for local MCP servers (this is
 * exactly how Claude Desktop and other MCP hosts talk to local servers
 * too). Adding a new MCP server to AgentForge means: build it under
 * mcp-servers/<name>, then add one line here.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");

/** Register additional MCP servers here as you build them. */
const MCP_SERVERS = {
  "web-search": {
    command: "node",
    args: [path.join(REPO_ROOT, "mcp-servers/web-search/src/index.js")],
  },
  // "filesystem": { command: "node", args: [...] },
  // "memory":     { command: "node", args: [...] },
};

const connections = new Map();

/**
 * Connect to (or reuse an existing connection to) a named MCP server.
 * Returns { client, tools } where tools is the server's tool list in MCP's
 * native shape ({ name, description, inputSchema }).
 */
async function connect(serverName) {
  if (connections.has(serverName)) {
    return connections.get(serverName);
  }

  const config = MCP_SERVERS[serverName];
  if (!config) {
    throw new Error(`Unknown MCP server: ${serverName}`);
  }

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: process.env,
  });

  const client = new Client({ name: "agentforge-orchestrator", version: "0.1.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const connection = { client, tools };
  connections.set(serverName, connection);
  return connection;
}

/**
 * Connect to every configured MCP server and return a flat list of tools,
 * each tagged with which server it came from and pre-translated into
 * Claude's tool schema shape.
 */
export async function loadAllTools() {
  const allTools = [];
  for (const serverName of Object.keys(MCP_SERVERS)) {
    const { tools } = await connect(serverName);
    for (const tool of tools) {
      allTools.push({
        serverName,
        name: tool.name,
        description: tool.description,
        // Groq's API is OpenAI-compatible, which wraps each tool in a
        // { type: "function", function: {...} } envelope. MCP calls the
        // schema `inputSchema`; OpenAI-style calls it `parameters`. Same
        // JSON Schema underneath — just reshaped.
        groqTool: {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        },
      });
    }
  }
  return allTools;
}

/** Call a tool by name (looked up across all connected servers). */
export async function callTool(toolName, input, toolIndex) {
  const entry = toolIndex.find((t) => t.name === toolName);
  if (!entry) {
    throw new Error(`No MCP server exposes a tool named "${toolName}"`);
  }
  const { client } = await connect(entry.serverName);
  const result = await client.callTool({ name: toolName, arguments: input });

  const textBlock = result.content?.find((c) => c.type === "text");
  return textBlock ? textBlock.text : JSON.stringify(result.content);
}

/** Close all child-process MCP server connections (used on shutdown). */
export async function closeAll() {
  for (const { client } of connections.values()) {
    await client.close();
  }
  connections.clear();
}
