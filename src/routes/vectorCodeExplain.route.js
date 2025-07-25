// src/routes/vectorCodeExplain.route.js

const express = require("express");
const router = express.Router();

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const findRelevantCodeViaVector = require("../analyzers/findRelevantCodeViaVector");
const { findRelevantCommitsViaVector } = require("../analyzers/findRelevantCommitsViaVector");
const extractStackTrace = require("../utils/extractStackTrace");

router.post("/explain/code", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'prompt' in request body" });
    }

    // Step 1: Search code and commits via vector
    const codeMatches = await findRelevantCodeViaVector(prompt);
    const commitMatches = await findRelevantCommitsViaVector(prompt);

    // Step 2: Extract filenames from stack trace
    const trace = extractStackTrace(prompt);
    const filenamesFromStack = Array.isArray(trace)
      ? trace.map((t) => t?.file).filter(Boolean)
      : [];

    // Step 3: Extract commit-related info
    let commit_id = "Not found";
    let filenamesFromCommit = [];
    let commit_line = [];

    if (Array.isArray(commitMatches) && commitMatches.length > 0) {
      const firstValid = commitMatches.find(
        (c) => c.commit_id && c.filenames?.length > 0
      );

      if (firstValid) {
        commit_id = firstValid.commit_id;
        filenamesFromCommit = firstValid.filenames;
        commit_line = firstValid.commit_line || [];
      } else {
        const match = prompt.match(/commit\s+([a-f0-9]{40})/i);
        if (match) {
          commit_id = match[1];
        }
      }
    }

    // Step 4: Merge and deduplicate filenames
    const filename = [...new Set([...filenamesFromStack, ...filenamesFromCommit])];

    // Step 5: GPT summarization of result
    let log_summary = "Summary unavailable";
    if (codeMatches && codeMatches.length > 0) {
      const gptPrompt = `Below is a set of code snippets relevant to the user's query:\n\n${codeMatches}\n\nExplain what this code does and how it's related to the query: "${prompt}"`;

      const gptResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a helpful AI software engineer. Your job is to analyze and explain code and its context.",
          },
          {
            role: "user",
            content: gptPrompt,
          },
        ],
        temperature: 0.5,
      });

      log_summary = gptResponse.choices?.[0]?.message?.content || "Summary unavailable";
    }

    // Step 6: Return final response
    res.status(200).json({
      result: codeMatches,
      commit_id,
      filename,
      commit_line,
      log_summary,
    });

  } catch (err) {
    console.error("🔴 Error in /search/code:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
