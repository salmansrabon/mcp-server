const fs = require("fs/promises");
const { COMMIT_DIFF_PATH, INSIGHT_PATH } = require("../config/env");
const { getInsightFromAI } = require("../services/openaiService");
const extractEndpoint = require("../utils/extractEndpoint");
const extractStackTrace = require("./extractStackTrace");
const findCodeForEndpoint = require("./findCodeForEndpoint");
const findResponsePattern = require("./findResponsePattern");

async function analyzeLogAndCode(logText) {
  const diff = await safeRead(COMMIT_DIFF_PATH, "utf-8", "No diff available");

  const endpoint = extractEndpoint(logText);
  const traceMatches = extractStackTrace(logText);
  const codeSnippet = await findCodeForEndpoint(endpoint);
  const responseMatches = await findResponsePattern(logText);

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

---

❓ Question: What is the most likely root cause of this issue?
Please explain clearly and provide a specific hotfix or workaround. Use bullet points if helpful.
`;

  try {
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
  } catch (err) {
    console.error("❌ AI Analysis failed:", err.message);
  }
}

// helper
async function safeRead(file, enc, fallback) {
  try {
    return await fs.readFile(file, enc);
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

module.exports = { analyzeLogAndCode };
