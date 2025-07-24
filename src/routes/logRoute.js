const express = require("express");
const fs = require("fs/promises");
const { LOG_PATH } = require("../config/env");
const { analyzeLogAndCode } = require("../analyzers/analyzeLogAndCode.js");
const { extractLastLogBlock } = require("../watchers/tailWatcher");

const router = express.Router();

// Apply express.text() middleware to ALL routes in this router
router.use(express.text({ type: "*/*" }));

router.post("/", express.text({ type: "*/*" }), async (req, res) => {
  const logText = req.body;

  if (typeof logText !== "string" || !logText.trim()) {
    return res.status(400).json({ error: "Empty or invalid log body" });
  }

  try {
    await fs.writeFile("./logs/runtime.log", logText);
    console.log("📩 Log received via CI. Analyzing...");

    const block = extractLastLogBlock ? extractLastLogBlock(logText) : logText;
    try {
      await analyzeLogAndCode(block);
    } catch (err) {
      console.error('🔥 analyzeLogAndCode failed:', err);
      return res.status(500).json({ error: 'Analyze failed', code: err.code, path: err.path, step: err.step });
    }
    res.json({ status: "Log received and analyzed" });
  } catch (err) {
    console.error("❌ Log write error:", err.message);
    res.status(500).json({ error: "Log write failed" });
  }
});

module.exports = router;
