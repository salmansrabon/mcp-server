const express = require("express");
const fs = require("fs/promises");
const { INSIGHT_PATH } = require("../config/env");
console.log("🔗 INSIGHT_PATH:", INSIGHT_PATH);

const router = express.Router();

// POST /insights/filter
router.post("/", async (req, res) => {
  const {
    date,
    keyword,
    offset = 0,
    limit = 10
  } = req.body || {};

  try {
    const rawData = await fs.readFile(INSIGHT_PATH, "utf-8");
    let insights = JSON.parse(rawData);

    // ✅ Normalize and filter by date
    const normalizedDate = date?.trim();
    if (normalizedDate) {
      insights = insights.filter(entry => {
        const entryDate = new Date(entry.date || entry.timestamp || entry.createdAt).toISOString().slice(0, 10);
        return entryDate === normalizedDate;
      });
    }

    // ✅ Keyword search (across all relevant fields)
    const search = keyword?.trim().toLowerCase();
    if (search) {
      insights = insights.filter(entry => {
        return (
          (entry.commit_id && entry.commit_id.toLowerCase().includes(search)) ||
          (entry.logText && entry.logText.toLowerCase().includes(search)) ||
          (entry.log_summary && entry.log_summary.toLowerCase().includes(search)) ||
          (entry.stackTrace && entry.stackTrace.toLowerCase().includes(search))
        );
      });
    }

    // ✅ Sort by most recent (descending)
    insights.sort((a, b) => {
      const dateA = new Date(a.date || a.timestamp || a.createdAt);
      const dateB = new Date(b.date || b.timestamp || b.createdAt);
      return dateB - dateA;
    });

    // ✅ Apply pagination
    const total = insights.length;
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
