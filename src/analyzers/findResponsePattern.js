const fs = require("fs/promises");
const path = require("path");
const glob = require("glob");
const { CODEBASE_PATH } = require("../config/env");

async function findResponsePattern(logText) {
  const codeFiles = glob.sync(path.join(CODEBASE_PATH, "**/*.js"));
  const responseLines = new Set();

  // crude extraction of meaningful error fragments
  const errorLines = logText
    .split("\n")
    .filter(
      (line) =>
        line.includes("Error") ||
        /res\.(status|json)/.test(line) ||
        line.includes("SELECT") ||
        line.includes("LIMIT")
    )
    .slice(0, 10);

  for (const file of codeFiles) {
    const content = await fs.readFile(file, "utf-8");
    for (const errLine of errorLines) {
      if (errLine.length < 20) continue;
      const pattern = escapeRegExp(errLine.trim());
      const regex = new RegExp(pattern, "i");
      if (regex.test(content)) {
        const lines = content.split("\n");
        const idx = lines.findIndex((l) => regex.test(l));
        const snippet = lines.slice(Math.max(0, idx - 5), idx + 10).join("\n");
        responseLines.add(`📁 File: ${file}\n🔍 Match:\n${snippet}`);
      }
    }
  }

  return [...responseLines].join("\n\n---\n\n");
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = findResponsePattern;
