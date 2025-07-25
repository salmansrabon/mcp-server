// src/routes/logStream.route.js
const express = require("express");
const fs = require("fs/promises");
const path = require("path");
require("dotenv").config();

const {
  COMMIT_DIFF_PATH
} = require("../config/env");

const { extractLastLogBlock } = require("../watchers/tailWatcher");
const extractEndpoint = require("../utils/extractEndpoint");
const extractStackTrace = require("../utils/extractStackTrace");
const findResponsePattern = require("../analyzers/findResponsePattern");
const findRelevantCodeViaVector = require("../analyzers/findRelevantCodeViaVector");
const { findRelevantCommitsViaVector } = require("../analyzers/findRelevantCommitsViaVector");

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = express.Router();
router.use(express.text({ type: "*/*" }));

router.post("/", async (req, res) => {
  const logText = req.body;
  if (!logText || typeof logText !== "string" || !logText.trim()) {
    return res.status(400).json({ error: "Empty or invalid log body" });
  }

  try {
    // Save latest log to runtime.log
    const logsDir = path.join(process.cwd(), "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(path.join(logsDir, "runtime.log"), logText);
    console.log("📩 Log received via CI. Analyzing...");

    const block = extractLastLogBlock ? extractLastLogBlock(logText) : logText;

    // Read commit diff if available
    let diff = "No diff available";
    try {
      const stat = await fs.lstat(COMMIT_DIFF_PATH);
      if (!stat.isDirectory()) {
        diff = await fs.readFile(COMMIT_DIFF_PATH, "utf-8");
      }
    } catch (_) {}

    // Extract trace, endpoint
    const endpoint = extractEndpoint(block);
    const trace = extractStackTrace(block);

    // Match relevant sources
    //const codeSnippet = await findCodeForEndpoint(endpoint);
    const responseMatch = await findResponsePattern(block);
    const vectorCode = await findRelevantCodeViaVector(block);
    const vectorCommits = await findRelevantCommitsViaVector(block);

    // Extract commit info
    let commit_id = "Not found";
    let filename = [];
    let commit_line = [];

    if (vectorCommits?.length > 0) {
      const top = vectorCommits.find(c => c.commit_id);
      if (top) {
        commit_id = top.commit_id;
        filename = top.filenames || [];
        commit_line = top.commit_line || [];
      }
    }

    // Fallback filenames from stack trace
    if (filename.length === 0 && Array.isArray(trace)) {
      filename = trace.map(t => t?.file).filter(Boolean);
    }

    // Build GPT prompt
    const gptPrompt = `
        You're an expert software analyst. Analyze the following commit diff, error log, and stack trace to determine the root cause and suggest a fix.

        🧾 Error Log:
        ${block}

        Endpoint: ${endpoint || "❌ Not found"}

        Stack Trace:
        ${trace || "❌ No stack trace found"}

        PI Response Pattern:
        ${responseMatch || "❌ No relevant API response found"}

        Vector-Based Code Match:
        ${vectorCode || "❌ No relevant code found"}

        Matched Commit History:
        ${JSON.stringify(vectorCommits, null, 2)}

        What is the most likely root cause of this issue? Suggest a fix.
        `;

    // GPT response
    let log_summary = "No summary available";
    try {
      const gpt = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a helpful AI software engineer. Your job is to analyze and explain code, logs, and commit diffs."
          },
          {
            role: "user",
            content: gptPrompt
          }
        ],
        temperature: 0.5,
      });

      log_summary = gpt.choices?.[0]?.message?.content?.trim() || log_summary;
    } 
    catch (gptErr) {
      console.error("⚠️ GPT failed:", gptErr.message);
    }

    // Build insight object
    const insightData = {
      date: new Date().toISOString(),
      logText,
      log_summary,
      commit_id,
      filename: [...new Set(filename)],
      commit_line
    };

    // Append to insight.json
    const insightPath = path.join(logsDir, "insight.json");
    let existing = [];
    try {
      const raw = await fs.readFile(insightPath, "utf-8");
      existing = JSON.parse(raw);
      if (!Array.isArray(existing)) existing = [];
    } catch (_) {
      existing = [];
    }

    existing.push(insightData);
    await fs.writeFile(insightPath, JSON.stringify(existing, null, 2));

    console.log("✅ insight.json updated with:");
    console.log(JSON.stringify(insightData, null, 2));

    res.json({
      status: "Log received and analyzed",
      ...insightData
    });

  } catch (err) {
    console.error("❌ Internal error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
