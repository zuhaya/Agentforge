import "dotenv/config";
import express from "express";
import cors from "cors";
import { runAgent } from "./agent.js";
import { closeAll } from "./mcpClient.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/task", async (req, res) => {
  const { task } = req.body;

  if (!task || typeof task !== "string" || !task.trim()) {
    return res.status(400).json({ error: "Request body must include a non-empty 'task' string." });
  }

  try {
    const { result, toolCalls } = await runAgent(task);
    res.json({ result, toolCalls });
  } catch (err) {
    console.error("Agent run failed:", err);
    res.status(500).json({ error: "Agent run failed.", details: err.message });
  }
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`AgentForge orchestrator listening on http://localhost:${PORT}`);
});

// Clean up child-process MCP server connections on shutdown.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await closeAll();
    server.close(() => process.exit(0));
  });
}
