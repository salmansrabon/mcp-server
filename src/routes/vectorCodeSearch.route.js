const express = require("express");
const router = express.Router();
const findRelevantCodeViaVector = require("../analyzers/findRelevantCodeViaVector");

router.post("/search/code", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'prompt' in request body" });
    }

    const result = await findRelevantCodeViaVector(prompt);
    res.status(200).json({ result });
  } catch (err) {
    console.error("🔴 Error in /search/code:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
