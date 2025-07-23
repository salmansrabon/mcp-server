// src/watchers/tailWatcher.js
const fs = require("fs");
const { LOG_PATH } = require("../config/env");
const { analyzeLogAndCode } = require("../analyzers/analyzeLogAndCode");

function extractLastLogBlock(logText) {
  const lines = logText.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("::1 - - [")) return lines.slice(i).join("\n");
  }
  return logText;
}

function tailLogAndAnalyze() {
  if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, "");
  fs.watchFile(LOG_PATH, { interval: 2000 }, (curr, prev) => {
    if (curr.size > prev.size) {
      const stream = fs.createReadStream(LOG_PATH, { start: 0, end: curr.size });
      let fullLog = "";
      stream.on("data", (chunk) => (fullLog += chunk.toString()));
      stream.on("end", async () => {
        const lastBlock = extractLastLogBlock(fullLog);
        console.log("📡 New runtime log detected. Sending to AI...");
        await analyzeLogAndCode(lastBlock);
      });
    }
  });
}

module.exports = { tailLogAndAnalyze, extractLastLogBlock };
