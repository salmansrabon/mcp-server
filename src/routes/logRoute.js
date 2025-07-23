const express = require("express");
const fs = require("fs/promises");
const { LOG_PATH } = require("../config/env");
const { analyzeLogAndCode } = require("../analyzers/analyzeLogAndCode");
const { extractLastLogBlock } = require("../watchers/tailWatcher"); // reuse util if exported

const router = express.Router();

router.post("/", async (req, res) => {
  const logText = req.body;
  try {
    await fs.writeFile(LOG_PATH, logText);
    console.log("📩 Log received via CI. Analyzing...");

    // If you want to send only block, extract here:
    const block = extractLastLogBlock ? extractLastLogBlock(logText) : logText;
    await analyzeLogAndCode(block);

    res.json({ status: "Log received and analyzed" });
  } catch (err) {
    console.error("❌ Log write error:", err.message);
    res.status(500).json({ error: "Log write failed" });
  }
});

module.exports = router;
