const express = require("express");
const router = express.Router();
const { getLatestCommitDiff } = require("../services/gitService");
const fs = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");

const COMMIT_HISTORY_DIR = path.resolve(process.cwd(), "commit-history");

router.post("/", async (req, res) => {
  try {
    const latestCommitHash = req.body?.commits?.slice(-1)[0]?.id;
    if (!latestCommitHash) throw new Error("No commit hash found in payload");

    console.log(`🔗 New commit detected: ${latestCommitHash}`);

    // Save commit diff
    const diffText = await getLatestCommitDiff(latestCommitHash);

    // Ensure history folder exists
    await fs.mkdir(COMMIT_HISTORY_DIR, { recursive: true });

    const filePath = path.join(COMMIT_HISTORY_DIR, `${latestCommitHash}.txt`);
    await fs.writeFile(filePath, diffText);

    console.log(`📄 Commit diff saved: ${filePath}`);

    // 🔁 Immediately re-embed everything (including this commit) to ChromaDB
    exec("node scripts/embedAndStore.js", (err, stdout, stderr) => {
      if (err) {
        console.error("❌ Failed to run embedAndStore.js:", err.message);
      } else {
        console.log("✅ embedAndStore.js executed successfully");
        console.log(stdout);
      }

      if (stderr) console.error(stderr);
    });

    res.json({ status: "Commit saved and embedding started" });
  } catch (err) {
    console.error("❌ Webhook processing failed:", err.message);
    res.status(500).json({ error: "Webhook failed" });
  }
});

module.exports = router;
