const fs = require("fs/promises");
const { COMMIT_DIFF_PATH, INSIGHT_PATH } = require("../config/env");
const { getInsightFromAI } = require("../services/openaiService");
const extractEndpoint = require("../utils/extractEndpoint");
const extractStackTrace = require("./extractStackTrace");
const findCodeForEndpoint = require("./findCodeForEndpoint");
const findResponsePattern = require("./findResponsePattern");
const findRelevantCodeViaVector = require("./findRelevantCodeViaVector");
const findRelevantCommitsViaVector = require("./findRelevantCommitsViaVector");

const wrap = async (step, fn) => {
  try {
    return await fn();
  } catch (e) {
    e.step = step;
    throw e;
  }
};

async function analyzeLogAndCode(logText) {
  const diff = await wrap("read diff", () =>
    safeRead(COMMIT_DIFF_PATH, "utf-8", "No diff available")
  );
  const endpoint = wrap("extract endpoint", () => extractEndpoint(logText));
  const traceMatches = wrap("stack trace", () => extractStackTrace(logText));
  const codeSnippet = await wrap("find code", () =>
    findCodeForEndpoint(endpoint)
  );
  const vectorMatches = await wrap("semantic search", () =>
    findRelevantCodeViaVector(logText)
  );
  const responseMatches = await wrap("find response pattern", () =>
    findResponsePattern(logText)
  );
  const commitMatches = await wrap("semantic commit match", () =>
    findRelevantCommitsViaVector(logText)
  );

  const prompt = `
            You're an expert software analyst. Analyze the following commit diff, error log, and available stack trace to determine the root cause of the issue and recommend a fix.

            If a stack trace is available, list:
            - The relevant file(s), function(s), and line number(s) from the trace.

            If no stack trace is found, infer the likely cause based on:
            - The API endpoint in the log
            - Related code snippets from the codebase
            - The relevant file(s), function(s), and line number(s) if you find them by scanning the codebase.

            Also:
            - Match any API responses found in the codebase to understand the business logic
            - Use that to support your reasoning

            ---

            📝 Latest Commit Diff:
            ${diff}

            🧾 Error Log:
            ${logText}

            🧵 Stack Trace:
            ${traceMatches || "❌ No stack trace found"}

            🧩 Matched Code Snippet:
            ${codeSnippet}

            🔁 API Response Match:
            ${responseMatches || "❌ No relevant API response found"}

            🔍 Vector-Based Code Match:
            ${vectorMatches || "❌ No relevant code chunks found"}

            🔂 Matched Commit(s) History:
            ${commitMatches || "❌ No relevant commit diffs found"}


            ---

            ❓ Question: What is the most likely root cause of this issue?
            Please explain clearly and provide a specific hotfix or workaround. Use bullet points if helpful.
            `;

  try {
    const hasCommitMatch = commitMatches && !commitMatches.includes("❌");
    console.log(
      hasCommitMatch
        ? "🧠 Commit-related cause detected!"
        : "✅ Error unrelated to any recent commit."
    );

    const output = await getInsightFromAI(prompt);
    console.log("🧠 AI Insight:\n", output);

    const insightEntry = {
      date: new Date().toISOString(),
      stackTrace: logText,
      AIinsight: output,
    };

    const existing = await safeRead(INSIGHT_PATH, "utf-8", "[]");
    const arr = JSON.parse(existing);
    arr.push(insightEntry);
    await fs.writeFile(INSIGHT_PATH, JSON.stringify(arr, null, 2));
    return output;
  } catch (err) {
    console.error("❌ AI Analysis failed:", err.message);
  }
}

// helper
async function safeRead(file, enc, fallback) {
  try {
    if (!file) return fallback; // undefined/null
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) return fallback; // avoid EISDIR
    return await fs.readFile(file, enc);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "EISDIR") return fallback;
    throw e;
  }
}

module.exports = { analyzeLogAndCode };
