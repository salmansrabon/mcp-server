// MCP Server with GitHub/Local Code Understanding
const express = require('express');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const bodyParser = require('body-parser');
const simpleGit = require('simple-git');
const glob = require('glob');
const readline = require('readline');
require('dotenv').config();

const app = express();
const PORT = 8000;

const LOG_PATH = process.env.LOG_PATH || path.join(__dirname, 'logs/runtime.log');
const CODEBASE_PATH = process.env.CODEBASE_PATH || path.join(__dirname, '../api');
const insightPath = path.join(__dirname, 'insight.txt');
const commitDiffPath = path.join(__dirname, 'commit-diff.txt');
const git = simpleGit(CODEBASE_PATH);

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY not set in environment!');
}

app.use(bodyParser.text({ type: '*/*' }));

// ========= Webhook: Save Commit Info =========
app.post('/webhook/github', async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const latestCommit = payload.commits?.slice(-1)[0];
    const diff = latestCommit?.message || "No commit message found";
    await fs.promises.writeFile(commitDiffPath, diff);
    console.log("✅ Commit message captured");
    res.json({ status: 'Commit diff saved' });
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.status(500).json({ error: 'Invalid payload' });
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
  let diff = 'No diff available';
  try {
    if (fs.existsSync(commitDiffPath)) {
      diff = await fs.promises.readFile(commitDiffPath, 'utf-8');
    }
  } catch (err) {
    console.error('❌ Commit diff read failed:', err.message);
  }

  const endpoint = extractEndpoint(logText);
  const codeSnippet = await findCodeForEndpoint(endpoint);

  const prompt = `Analyze the following log with the context of code and recent commit:\n\nCommit:\n${diff}\n\nLog:\n${logText}\n\nRelevant Code:\n${codeSnippet}\n\nWhat's the root cause and how to fix it?`;

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

// ========= Extract API Endpoint =========
function extractEndpoint(logText) {
  const match = logText.match(/"(GET|POST|PUT|DELETE) (.*?) HTTP/);
  return match ? `${match[1]} ${match[2]}` : 'Unknown';
}
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// ========= Search for Endpoint in Code =========
async function findCodeForEndpoint(endpoint) {
  const [method, route] = endpoint.split(' ');
  const escapedRoute = escapeRegExp(route);
  const files = glob.sync(path.join(CODEBASE_PATH, '**', '*.js'));

  const patterns = [
    new RegExp(`app\\.${method?.toLowerCase()}\\(\\s*['\`]${escapedRoute}['\`]`, 'i'),
    new RegExp(`router\\.${method?.toLowerCase()}\\(\\s*['\`]${escapedRoute}['\`]`, 'i')
  ];

  for (const file of files) {
    let content;
    try {
      content = await fs.promises.readFile(file, 'utf-8');
    } catch {
      continue;
    }

    for (const regex of patterns) {
      if (regex.test(content)) {
        const lines = content.split('\n');
        const matchedLineIndex = lines.findIndex(line => regex.test(line));
        const snippet = lines.slice(Math.max(0, matchedLineIndex - 5), matchedLineIndex + 10).join('\n');
        return `File: ${file}\n\n${snippet}`;
      }
    }
  }

  return '❗ No matching code found for this endpoint.';
}

// ========= Start Server =========
app.listen(PORT, () => {
  console.log(`🚀 MCP Server running at http://localhost:${PORT}`);
  tailLogAndAnalyze();
});
