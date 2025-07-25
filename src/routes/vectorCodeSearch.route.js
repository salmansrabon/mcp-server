// src/routes/vectorCodeSearch.route.js
const express = require("express");
const router = express.Router();

const findRelevantCodeViaVector = require("../analyzers/findRelevantCodeViaVector");
const { findRelevantCommitsViaVector } = require("../analyzers/findRelevantCommitsViaVector");
const extractStackTrace = require("../utils/extractStackTrace");

router.post("/search/code", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'prompt' in request body" });
    }

    // Step 1: Vector search
    const codeMatches = await findRelevantCodeViaVector(prompt);
    const commitMatches = await findRelevantCommitsViaVector(prompt);

    // Step 2: Extract filenames from stack trace
    const trace = extractStackTrace(prompt);
    const filenamesFromStack = Array.isArray(trace)
      ? trace.map((t) => t?.file).filter(Boolean)
      : [];

    // Step 3: Extract commit info
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

    // Step 5: Return final response
    res.status(200).json({
      result: codeMatches,
      commit_id,
      filename,
      commit_line,
    });

  } catch (err) {
    console.error("🔴 Error in /search/code:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
