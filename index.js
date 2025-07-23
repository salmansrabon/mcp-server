const express = require('express');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const bodyParser = require('body-parser');
const simpleGit = require('simple-git');
const glob = require('glob');
require('dotenv').config();

const app = express();
const PORT = 8000;
app.use(bodyParser.json());

const LOG_PATH = process.env.LOG_PATH || path.join(__dirname, 'logs/runtime.log');
const CODEBASE_PATH = process.env.CODEBASE_PATH || path.join(__dirname, '../api');
const insightPath = path.join(__dirname, 'insight.txt');
const commitDiffPath = path.join(__dirname, 'commit-diff.txt');
const git = simpleGit(CODEBASE_PATH);

app.use('/webhook/github', bodyParser.json());
app.use('/logs/stream', bodyParser.text({ type: 'text/plain' }));

// ========= Webhook: Save Commit Info =========
// Replace commit message only with full diff
const lastCommitFile = path.join(__dirname, 'last-commit.txt');
app.post('/webhook/github', async (req, res) => {
  try {
    const latestCommitHash = req.body?.commits?.slice(-1)[0]?.id;
    if (!latestCommitHash) throw new Error("No commit hash found in payload");
    console.log(`🔗 New commit detected: ${latestCommitHash}`);

    // Always capture full git show output
    const diff = await git.show([latestCommitHash]);

    await fs.promises.writeFile(commitDiffPath, diff);
    await fs.promises.writeFile(lastCommitFile, latestCommitHash);
    console.log("✅ Full commit diff (via git show) captured");
    res.json({ status: 'Full commit diff saved' });
  } catch (err) {
    console.error("❌ Webhook processing failed:", err.message);
    res.status(500).json({ error: 'Git show failed' });
  }
});


// ========= Manual Log Push =========
app.post('/logs/stream', async (req, res) => {
    const logText = req.body;
    try {
        await fs.promises.writeFile(LOG_PATH, logText);
        console.log("📩 Log received via CI. Analyzing...");
        await analyzeLogAndCode(logText);
        res.json({ status: 'Log received and analyzed' });
    } catch (err) {
        console.error("❌ Log write error:", err.message);
        res.status(500).json({ error: 'Log write failed' });
    }
});

// ========= Log Tailer =========
function tailLogAndAnalyze() {
    if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '');
    fs.watchFile(LOG_PATH, { interval: 2000 }, (curr, prev) => {
        if (curr.size > prev.size) {
            const stream = fs.createReadStream(LOG_PATH, { start: prev.size, end: curr.size });
            let newLog = '';
            stream.on('data', chunk => newLog += chunk.toString());
            stream.on('end', async () => {
                console.log('📡 New runtime log detected. Sending to AI...');
                await analyzeLogAndCode(newLog);
            });
        }
    });
}

// ========= Core Analyzer =========
async function analyzeLogAndCode(logText) {
    const diff = fs.existsSync(commitDiffPath) ? await fs.promises.readFile(commitDiffPath, 'utf-8') : 'No diff available';
    const endpoint = extractEndpoint(logText);
    const codeSnippet = await findCodeForEndpoint(endpoint);

    const prompt = `Analyze the following error log and suggest the root cause and fix based on the recent code commit and related API code.\n
                If code is partially matched, still infer business logic.
                Latest Commit:
                ${diff}

                Log:
                ${logText}

                Code Snippet:
                ${codeSnippet}

                Question: What's likely causing this issue and how to hotfix it? Please be specific.`;

    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const res = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: prompt }]
        });
        const output = res.choices[0].message.content;
        console.log('🧠 AI Insight:\n', output);
        await fs.promises.appendFile(insightPath, `\n\n[${new Date().toISOString()}]\n${output}`);
    } catch (err) {
        console.error('❌ AI Analysis failed:', err.message);
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ========= Extract API Endpoint =========
function extractEndpoint(logText) {
  const match = logText.match(/"(GET|POST|PUT|DELETE|PATCH)\s+([^"]+?)\s+HTTP/);
  return match ? `${match[1]} ${match[2].split('?')[0]}` : 'Unknown';
}

// ========= Match Routes from app.use + router files =========
async function findCodeForEndpoint(endpoint) {
  const [method, fullRoute] = endpoint.split(' ');
  const routeFiles = glob.sync(path.join(CODEBASE_PATH, '**/*.js'));
  const controllerFiles = glob.sync(path.join(CODEBASE_PATH, '**/{controller,controllers}/**/*.js'));
  let routeMatches = [];
  const basePathMap = new Map();
  const controllerFunctions = new Set();

  // Map router variables to base paths
  for (const file of routeFiles) {
    const content = await fs.promises.readFile(file, 'utf-8');
    const matches = content.matchAll(/app\.use\(['"`]([^'"`]+)['"`],\s*(\w+)/g);
    for (const match of matches) {
      basePathMap.set(match[2], match[1]); // routerVar => /user
    }
  }

  // Find route matches and controller references
  for (const file of routeFiles) {
    const content = await fs.promises.readFile(file, 'utf-8');
    for (const [routerVar, basePath] of basePathMap.entries()) {
      const pattern = new RegExp(`${escapeRegExp(routerVar)}\\.${method.toLowerCase()}\\(['"\`]([^'"\`]+)['"\`],\\s*(.*?)\\)`, 'g');
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const subRoute = match[1];
        const fullMatch = match[0];
        const combinedRoute = `${basePath}${subRoute.startsWith('/') ? '' : '/'}${subRoute}`;
        if (fullRoute === combinedRoute || fullRoute.startsWith(combinedRoute) || combinedRoute.startsWith(fullRoute)) {
          const lines = content.split('\n');
          const matchedLineIndex = lines.findIndex(line => line.includes(fullMatch));
          const snippet = lines.slice(Math.max(0, matchedLineIndex - 5), matchedLineIndex + 10).join('\n');
          routeMatches.push(`📁 File: ${file}\n➡ Route: ${combinedRoute}\n${snippet}`);

          // Extract controller function names
          const controllerCalls = match[2].split(',').map(c => c.trim()).filter(c => /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z0-9_]+$/.test(c));
          for (const call of controllerCalls) {
            const [, fn] = call.split('.');
            if (fn) controllerFunctions.add(fn);
          }
        }
      }
    }
  }

  // Find controller definitions
  let controllerSnippets = '';
  for (const file of controllerFiles) {
    const content = await fs.promises.readFile(file, 'utf-8');
    for (const fnName of controllerFunctions) {
      const regex = new RegExp(`(async\\s+)?function\\s+${fnName}\\s*\\(|const\\s+${fnName}\\s*=\\s*async\\s*\\(|exports\\.${fnName}\\s*=\\s*async\\s*\\(`, 'g');

      let match;
      while ((match = regex.exec(content)) !== null) {
        const lines = content.split('\n');
        const start = lines.findIndex(line => line.includes(match[0]));
        const snippet = lines.slice(start, start + 20).join('\n');
        controllerSnippets += `\n📁 Controller: ${file}\n➡ Function: ${fnName}\n${snippet}\n---\n`;
      }
    }
  }

  if (routeMatches.length === 0 && !controllerSnippets) {
    return '❗ No matching code found for this endpoint.';
  }

  return [...routeMatches, controllerSnippets].join('\n\n---\n\n');
}


// ========= Start Server =========
app.listen(PORT, () => {
    console.log(`🚀 MCP Server running at http://localhost:${PORT}`);
    tailLogAndAnalyze();
});