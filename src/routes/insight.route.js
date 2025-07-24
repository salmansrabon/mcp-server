const express = require("express");
const fs = require("fs/promises");
const { INSIGHT_PATH } = require("../config/env");

const router = express.Router();

// POST /insights/filter
router.post("/", async (req, res) => {
  const {
    date,          // e.g., "2025-07-24"
    keyword,       // e.g., "Sequelize" or any phrase
    offset = 0,    // pagination start
    limit = 10     // pagination size
  } = req.body || {};

  try {
    const data = await fs.readFile(INSIGHT_PATH, "utf-8");
    let insights = JSON.parse(data);

    // ✅ Filter by date prefix match (YYYY-MM-DD)
    const normalizedDate = date?.trim();
    if (normalizedDate) {
      insights = insights.filter(entry => {
        const entryDate = new Date(entry.date).toISOString().slice(0, 10); // "YYYY-MM-DD"
        return entryDate === normalizedDate;
      });
    }

    // ✅ Search keyword in stackTrace or AIinsight
    if (keyword) {
      const lower = keyword.toLowerCase();
      insights = insights.filter(
        entry =>
          entry.stackTrace?.toLowerCase().includes(lower) ||
          entry.AIinsight?.toLowerCase().includes(lower)
      );
    }

    // ✅ Sort by date (newest first)
    insights.sort((a, b) => new Date(b.date) - new Date(a.date));

    const total = insights.length;

    // ✅ Apply pagination
    const paginated = insights.slice(Number(offset), Number(offset) + Number(limit));

    res.json({
      total,
      count: paginated.length,
      results: paginated
    });

  } catch (err) {
    console.error("❌ Failed to filter insights:", err.message);
    res.status(500).json({ error: "Failed to load insights" });
  }
});

module.exports = router;
