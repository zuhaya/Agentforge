/**
 * The core agent loop: send a task to Groq with a set of MCP-backed tools
 * available, and keep looping — executing whatever tool calls the model
 * requests, feeding results back — until it stops asking for tools and
 * returns a final answer.
 *
 * Groq is used here because it has a genuinely free tier (no credit card)
 * and is OpenAI-compatible, including function/tool calling — so this
 * project runs at zero cost. Swapping to a different OpenAI-compatible
 * provider later (or back to Claude) only touches this file.
 *
 * This is milestone 1 from the AgentForge build plan: ONE agent, real
 * tool access via MCP, end-to-end. Multi-agent roles (Researcher /
 * Writer / Reviewer) are built on top of this same loop in a later step —
 * each role will just be this function called with a different system
 * prompt and a different subset of tools.
 */

import Groq from "groq-sdk";
import { loadAllTools, callTool } from "./mcpClient.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MAX_TOOL_ROUNDS = 6;

/**
 * @param {string} task - the user's task/question
 * @param {object} [opts]
 * @param {string} [opts.model] - defaults to a fast, free-tier Groq model
 *        that supports tool calling.
 * @param {string} [opts.systemPrompt]
 * @returns {Promise<{ result: string, toolCalls: Array }>}
 */
export async function runAgent(task, opts = {}) {
  const {
    model = "openai/gpt-oss-20b",
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
  } = opts;

  const toolIndex = await loadAllTools();
  const groqTools = toolIndex.map((t) => t.groqTool);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];
  const toolCallLog = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await groq.chat.completions.create({
      model,
      messages,
      tools: groqTools,
      tool_choice: "auto",
      max_tokens: 1500,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // Model is done — final answer.
      return { result: assistantMessage.content ?? "", toolCalls: toolCallLog };
    }

    // Execute every tool call the model asked for, then feed each result
    // back as its own "tool" role message (OpenAI/Groq's tool-calling
    // convention — one tool message per tool_call_id, unlike Claude which
    // batches them into one user message).
    for (const call of toolCalls) {
      const args = safeParseJSON(call.function.arguments);
      let outputText;
      try {
        outputText = await callTool(call.function.name, args, toolIndex);
      } catch (err) {
        outputText = `Error calling tool "${call.function.name}": ${err.message}`;
      }

      toolCallLog.push({ name: call.function.name, input: args, output: outputText });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: outputText,
      });
    }
  }

  return {
    result:
      "Agent stopped after reaching the maximum number of tool-use rounds " +
      `(${MAX_TOOL_ROUNDS}) without a final answer.`,
    toolCalls: toolCallLog,
  };
}

function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

const DEFAULT_SYSTEM_PROMPT = `You are a research assistant with access to a
web_search tool. When the user asks something that depends on current or
factual information, use web_search before answering — don't rely on
memory alone. Cite which sources you used. Keep your final answer concise
and well-organized.`;
