// src/analyzers/findResponsePattern.js
const path = require("path");
const glob = require("glob");
const { promises: fs } = require("fs");
const { CODEBASE_PATH } = require("../config/env");

async function readIfFile(p) {
  const st = await fs.lstat(p);
  if (st.isDirectory()) return null;
  return fs.readFile(p, "utf-8");
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = async function findResponsePattern(logText) {
  const codeFiles = glob.sync("**/*.{js,ts}", {
    cwd: CODEBASE_PATH,
    absolute: true,
    nodir: true, // << important
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
  });

  const responseLines = new Set();

  const errorLines = logText
    .split("\n")
    .filter(
      (line) =>
        line.includes("Error") ||
        /res\.(status|json)/i.test(line) ||
        line.includes("SELECT") ||
        line.includes("LIMIT")
    )
    .slice(0, 10);

  if (!errorLines.length) return "❌ No relevant API response found";

  for (const file of codeFiles) {
    const content = await readIfFile(file);
    if (!content) continue;

    for (const errLine of errorLines) {
      if (errLine.length < 20) continue;
      const regex = new RegExp(escapeRegExp(errLine.trim()), "i");

      if (regex.test(content)) {
        const lines = content.split("\n");
        const idx = lines.findIndex((l) => regex.test(l));
        const snippet = lines.slice(Math.max(0, idx - 5), idx + 10).join("\n");
        responseLines.add(`📁 File: ${file}\n🔍 Match:\n${snippet}`);
      }
    }
  }

  return responseLines.size
    ? [...responseLines].join("\n\n---\n\n")
    : "❌ No relevant API response found";
};
