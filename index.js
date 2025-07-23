const express = require("express");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const bodyParser = require("body-parser");
const simpleGit = require("simple-git");
const glob = require("glob");
const { log } = require("console");
require("dotenv").config();

const app = express();
const PORT = 8000;
app.use(bodyParser.json());

const LOG_PATH =
  process.env.LOG_PATH || path.join(__dirname, "logs/runtime.log");
const CODEBASE_PATH =
  process.env.CODEBASE_PATH || path.join(__dirname, "../api");
const insightPath = path.join(__dirname, "insight.txt");
const commitDiffPath = path.join(__dirname, "commit-diff.txt");
const git = simpleGit(CODEBASE_PATH);

app.use("/webhook/github", bodyParser.json());
app.use("/logs/stream", bodyParser.text({ type: "text/plain" }));

// ========= Webhook: Save Commit Info =========
// Replace commit message only with full diff
const lastCommitFile = path.join(__dirname, "last-commit.txt");
app.post("/webhook/github", async (req, res) => {
  try {
    const latestCommitHash = req.body?.commits?.slice(-1)[0]?.id;
    if (!latestCommitHash) throw new Error("No commit hash found in payload");
    console.log(`🔗 New commit detected: ${latestCommitHash}`);

    // Always capture full git show output
    const diff = await git.show([latestCommitHash]);

    await fs.promises.writeFile(commitDiffPath, diff);
    await fs.promises.writeFile(lastCommitFile, latestCommitHash);
    console.log("✅ Full commit diff (via git show) captured");
    res.json({ status: "Full commit diff saved" });
  } catch (err) {
    console.error("❌ Webhook processing failed:", err.message);
    res.status(500).json({ error: "Git show failed" });
  }
});

// ========= Manual Log Push =========
app.post("/logs/stream", async (req, res) => {
  const logText = req.body;
  try {
    await fs.promises.writeFile(LOG_PATH, logText);
    console.log("📩 Log received via CI. Analyzing...");
    await analyzeLogAndCode(logText);
    res.json({ status: "Log received and analyzed" });
  } catch (err) {
    console.error("❌ Log write error:", err.message);
    res.status(500).json({ error: "Log write failed" });
  }
});

function extractLastLogBlock(logText) {
  const lines = logText.trim().split("\n");
  let startIndex = -1;

  // Look for the last "::1 - - [" (start of the most recent access log entry)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("::1 - - [")) {
      startIndex = i;
      break;
    }
  }

  // Return log block from that access log line to end
  if (startIndex !== -1) {
    return lines.slice(startIndex).join("\n");
  }

  return logText; // fallback if marker not found
}

// ========= Log Tailer =========
function tailLogAndAnalyze() {
  if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, "");
  fs.watchFile(LOG_PATH, { interval: 2000 }, (curr, prev) => {
    if (curr.size > prev.size) {
      const stream = fs.createReadStream(LOG_PATH, {
        start: 0,
        end: curr.size,
      }); // read full
      let fullLog = "";
      stream.on("data", (chunk) => (fullLog += chunk.toString()));
      stream.on("end", async () => {
        const lastLogBlock = extractLastLogBlock(fullLog);
        console.log("📡 New runtime log detected. Sending to AI...");
        await analyzeLogAndCode(lastLogBlock);
      });
    }
  });
}

function extractStackTraceMatches(logText) {
  const lines = logText.split("\n");
  const stackLines = lines.filter((line) => /\.js:\d+:\d+/.test(line));
  return stackLines.slice(0, 5).join("\n");
}

async function findResponsePatternInCode(logText) {
  const codeFiles = glob.sync(path.join(CODEBASE_PATH, "**/*.js"));
  const responseLines = new Set();

  // Attempt to extract likely response content (status code, error message)
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
    const content = await fs.promises.readFile(file, "utf-8");
    for (const errLine of errorLines) {
      if (errLine.length < 20) continue;
      const pattern = errLine.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape
      const regex = new RegExp(pattern, "i");
      if (regex.test(content)) {
        const lines = content.split("\n");
        const idx = lines.findIndex((line) => regex.test(line));
        const snippet = lines.slice(Math.max(0, idx - 5), idx + 10).join("\n");
        responseLines.add(`📁 File: ${file}\n🔍 Match:\n${snippet}`);
      }
    }
  }

  return [...responseLines].join("\n\n---\n\n");
}

// ========= Core Analyzer =========
async function analyzeLogAndCode(logText) {
  const diff = fs.existsSync(commitDiffPath)
    ? await fs.promises.readFile(commitDiffPath, "utf-8")
    : "No diff available";
  const endpoint = extractEndpoint(logText);
  const codeSnippet = await findCodeForEndpoint(endpoint);
  const traceMatches = extractStackTraceMatches(logText);

  const responseMatches = await findResponsePatternInCode(logText);

  const prompt = `
                You're an expert software analyst. Analyze the following commit diff, error log, and available stack trace to determine the root cause of the issue and recommend a fix.

                If a stack trace is available, list:
                - The relevant file(s), function(s), and line number(s) from the trace.

                If no stack trace is found, infer the likely cause based on:
                - The API endpoint in the log
                - Related code snippets from the codebase
                - The relevant file(s), function(s), and line number(s) if you find by searching on codebase.

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

                ❓ **Question**: What is the most likely root cause of this issue?  
                Please explain it clearly and provide a specific hotfix or workaround. Use bullet points if helpful.
                `;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
    });
    const output = res.choices[0].message.content;
    console.log("❌ Error Stack: " + logText);
    console.log("🧠 AI Insight:\n", output);
    await fs.promises.appendFile(
      insightPath,
      `\n\n[${new Date().toISOString()}]\n${output}`
    );
  } catch (err) {
    console.error("❌ AI Analysis failed:", err.message);
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ========= Extract API Endpoint =========
function extractEndpoint(logText) {
  const match = logText.match(/"(GET|POST|PUT|DELETE|PATCH)\s+([^"]+?)\s+HTTP/);
  return match ? `${match[1]} ${match[2].split("?")[0]}` : "Unknown";
}

// ========= Match Routes from app.use + router files =========
async function findCodeForEndpoint(endpoint) {
  const [method, fullRoute] = endpoint.split(" ");
  const routeFiles = glob.sync(path.join(CODEBASE_PATH, "**/*.js"));
  const controllerFiles = glob.sync(
    path.join(CODEBASE_PATH, "**/{controller,controllers}/**/*.js")
  );
  let routeMatches = [];
  const basePathMap = new Map();
  const controllerFunctions = new Set();

  // Map router variables to base paths
  for (const file of routeFiles) {
    const content = await fs.promises.readFile(file, "utf-8");
    const matches = content.matchAll(/app\.use\(['"`]([^'"`]+)['"`],\s*(\w+)/g);
    for (const match of matches) {
      basePathMap.set(match[2], match[1]); // routerVar => /user
    }
  }

  // Find route matches and controller references
  for (const file of routeFiles) {
    const content = await fs.promises.readFile(file, "utf-8");
    for (const [routerVar, basePath] of basePathMap.entries()) {
      const pattern = new RegExp(
        `${escapeRegExp(
          routerVar
        )}\\.${method.toLowerCase()}\\(['"\`]([^'"\`]+)['"\`],\\s*(.*?)\\)`,
        "g"
      );
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const subRoute = match[1];
        const fullMatch = match[0];
        const combinedRoute = `${basePath}${
          subRoute.startsWith("/") ? "" : "/"
        }${subRoute}`;
        if (
          fullRoute === combinedRoute ||
          fullRoute.startsWith(combinedRoute) ||
          combinedRoute.startsWith(fullRoute)
        ) {
          const lines = content.split("\n");
          const matchedLineIndex = lines.findIndex((line) =>
            line.includes(fullMatch)
          );
          const snippet = lines
            .slice(Math.max(0, matchedLineIndex - 5), matchedLineIndex + 10)
            .join("\n");
          routeMatches.push(
            `📁 File: ${file}\n➡ Route: ${combinedRoute}\n${snippet}`
          );

          // Extract controller function names
          const controllerCalls = match[2]
            .split(",")
            .map((c) => c.trim())
            .filter((c) => /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z0-9_]+$/.test(c));
          for (const call of controllerCalls) {
            const [, fn] = call.split(".");
            if (fn) controllerFunctions.add(fn);
          }
        }
      }
    }
  }

  // Find controller definitions
  let controllerSnippets = "";
  for (const file of controllerFiles) {
    const content = await fs.promises.readFile(file, "utf-8");
    for (const fnName of controllerFunctions) {
      const regex = new RegExp(
        `(async\\s+)?function\\s+${fnName}\\s*\\(|const\\s+${fnName}\\s*=\\s*async\\s*\\(|exports\\.${fnName}\\s*=\\s*async\\s*\\(`,
        "g"
      );

      let match;
      while ((match = regex.exec(content)) !== null) {
        const lines = content.split("\n");
        const start = lines.findIndex((line) => line.includes(match[0]));
        const snippet = lines.slice(start, start + 20).join("\n");
        controllerSnippets += `\n📁 Controller: ${file}\n➡ Function: ${fnName}\n${snippet}\n---\n`;
      }
    }
  }

  if (routeMatches.length === 0 && !controllerSnippets) {
    return "❗ No matching code found for this endpoint.";
  }

  return [...routeMatches, controllerSnippets].join("\n\n---\n\n");
}

// ========= Start Server =========
app.listen(PORT, () => {
  console.log(`🚀 MCP Server running at http://localhost:${PORT}`);
  tailLogAndAnalyze();
});
