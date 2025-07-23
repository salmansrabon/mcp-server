const app = require("./app");
const { PORT } = require("./config/env");
const { tailLogAndAnalyze } = require("./watchers/tailWatcher");

app.listen(PORT, () => {
  console.log(`🚀 MCP Server running at http://localhost:${PORT}`);
  tailLogAndAnalyze();
});
