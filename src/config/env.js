require("dotenv").config();
const path = require("path");

module.exports = {
  PORT: process.env.PORT || 8000,
  LOG_PATH: process.env.LOG_PATH || path.join(__dirname, "../../logs/runtime.log"),
  CODEBASE_PATH: process.env.CODEBASE_PATH || path.join(__dirname, "../../../api"),
  COMMIT_DIFF_PATH: path.join(__dirname, "../../commit-diff.txt"),
  LAST_COMMIT_PATH: path.join(__dirname, "../../last-commit.txt"),
  INSIGHT_PATH: path.join(__dirname, "../../insight.json"),
  OPENAI_KEY: process.env.OPENAI_API_KEY
};
