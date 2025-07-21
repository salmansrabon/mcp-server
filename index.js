const express = require('express');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = 8000;

app.use(bodyParser.text({ type: '*/*' }));

const logPath = process.env.LOG_PATH;
const insightPath = path.join(__dirname, 'insight.txt');

// ========================
// 1. GitHub Webhook Route
// ========================
app.post('/webhook/github', async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const latestCommit = payload.commits?.slice(-1)[0];
    const diff = latestCommit?.message || "No commit message found";
    fs.writeFileSync(path.join(__dirname, 'commit-diff.txt'), diff);
    console.log("✅ Commit message captured");
    res.json({ status: 'Commit diff saved' });
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.status(500).json({ error: 'Invalid payload' });
  }
});

// ========================
// 2. Manual Log Push Route
// ========================
app.post('/logs/stream', async (req, res) => {
  const logText = req.body;
  fs.writeFileSync(logPath, logText); // overwrites
  console.log("📩 Log received via CI. Analyzing...");
  await analyzeWithAI(logText);
  res.json({ status: 'Log received and analyzed' });
});

// ========================
// 3. AI Analyzer Function
// ========================
async function analyzeWithAI(logText) {
  const diff = fs.existsSync('commit-diff.txt')
    ? fs.readFileSync('commit-diff.txt', 'utf-8')
    : 'No diff available';

  const prompt = `Analyze the following log in context of recent changes:\n\nCommit:\n${diff}\n\nLog:\n${logText}\n\nWhat's the issue and how to fix it?`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }]
    });

    const output = res.choices[0].message.content;
    console.log('🧠 AI Insight:\n', output);
    fs.appendFileSync(insightPath, `\n\n[${new Date().toISOString()}]\n${output}`);
  } catch (err) {
    console.error('❌ AI Analysis failed:', err.message);
  }
}

// ========================
// 4. Runtime Log Watcher
// ========================
function tailLogAndAnalyze() {
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, '');
  }

  fs.watchFile(logPath, { interval: 2000 }, (curr, prev) => {
    if (curr.size > prev.size) {
      const stream = fs.createReadStream(logPath, {
        start: prev.size,
        end: curr.size
      });

      let newLog = '';
      stream.on('data', chunk => {
        newLog += chunk.toString();
      });

      stream.on('end', async () => {
        console.log('📡 New runtime log detected. Sending to AI...');
        await analyzeWithAI(newLog);
      });
    }
  });
}

// ✅ Start both server + watcher
app.listen(PORT, () => {
  console.log(`🚀 MCP Server running at http://localhost:${PORT}`);
  tailLogAndAnalyze();
});
