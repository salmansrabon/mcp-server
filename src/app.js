const express = require("express");
const bodyParser = require("body-parser");
const githubWebhook = require("./routes/webhookRoute");
const logStreamRoutes = require("./routes/logStream.route");
const insightRoutes = require("./routes/insight.route");
const vectorCodeSearchRoutes = require("./routes/vectorCodeSearch.route");
const vectorCodeExplainRoutes = require("./routes/vectorCodeExplain.route");



const app = express();

app.use(bodyParser.json());
app.use("/webhook/github", githubWebhook);
app.use("/logs/stream", logStreamRoutes);
app.use("/insights", insightRoutes);
app.use("/", vectorCodeSearchRoutes);
app.use("/", vectorCodeExplainRoutes);





module.exports = app;
