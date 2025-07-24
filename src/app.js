const express = require("express");
const bodyParser = require("body-parser");
const routes = require("./routes");
const insightRoutes = require("./routes/insight.route");

const app = express();

app.use(bodyParser.json());
app.use("/webhook/github", routes.webhook);
app.use("/logs/stream", routes.logs);
app.use("/insights", insightRoutes);


module.exports = app;
