module.exports = function extractStackTrace(logText) {
  const lines = logText.split("\n");
  const stackLines = lines.filter((line) => /\.js:\d+:\d+/.test(line));
  return stackLines.slice(0, 5).join("\n");
};
