const express = require("express");
const bodyParser = require("body-parser");
const routes = require("./routes");

const app = express();

app.use(bodyParser.json());
app.use("/webhook/github", routes.webhook);
app.use("/logs/stream", routes.logs);

module.exports = app;
