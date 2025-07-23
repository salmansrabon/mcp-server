const express = require("express");
const router = express.Router();
const { getLatestCommitDiff } = require("../services/gitService");

router.post("/", async (req, res) => {
  try {
    const latestCommitHash = req.body?.commits?.slice(-1)[0]?.id;
    if (!latestCommitHash) throw new Error("No commit hash found in payload");
    console.log(`🔗 New commit detected: ${latestCommitHash}`);

    await getLatestCommitDiff(latestCommitHash);

    res.json({ status: "Full commit diff saved" });
  } catch (err) {
    console.error("❌ Webhook processing failed:", err.message);
    res.status(500).json({ error: "Git show failed" });
  }
});

module.exports = router;
