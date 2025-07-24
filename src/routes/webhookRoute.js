const express = require("express");
const router = express.Router();
const { getLatestCommitDiff } = require("../services/gitService");
const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const COMMIT_HISTORY_DIR = path.resolve(process.cwd(), "commit-history");

router.post("/", async (req, res) => {
  try {
    const latestCommitHash = req.body?.commits?.slice(-1)[0]?.id;
    if (!latestCommitHash) throw new Error("No commit hash found in payload");

    console.log(`🔗 New commit detected: ${latestCommitHash}`);

    // Save commit diff
    const diffText = await getLatestCommitDiff(latestCommitHash);

    await fs.mkdir(COMMIT_HISTORY_DIR, { recursive: true });

    const filePath = path.join(COMMIT_HISTORY_DIR, `${latestCommitHash}.txt`);
    await fs.writeFile(filePath, diffText);
    console.log(`📄 Commit diff saved: ${filePath}`);

    // Absolute paths to scripts
    const scriptsDir = path.resolve(process.cwd(), "scripts");
    const chunkPath = path.join(scriptsDir, "chunkCodebase.js");
    const embedPath = path.join(scriptsDir, "embedAndStore.js");

    // Spawn a subprocess to run chunkCodebase first
    const chunkProcess = spawn("node", [chunkPath], { stdio: "inherit" });

    chunkProcess.on("exit", (code) => {
      if (code !== 0) {
        console.error(`❌ chunkCodebase.js exited with code ${code}`);
        return;
      }

      // Then run embedAndStore.js
      const embedProcess = spawn("node", [embedPath], { stdio: "inherit" });

      embedProcess.on("exit", (code2) => {
        if (code2 !== 0) {
          console.error(`❌ embedAndStore.js exited with code ${code2}`);
        } else {
          console.log("✅ Both chunking and embedding completed successfully");
        }
      });
    });

    // Immediate webhook response — async background execution
    res.json({ status: "✅ Commit saved, background chunk/embed started" });
  } catch (err) {
    console.error("❌ Webhook processing failed:", err.message);
    res.status(500).json({ error: "Webhook failed" });
  }
});

module.exports = router;
