module.exports = function extractEndpoint(logText) {
  const match = logText.match(/"(GET|POST|PUT|DELETE|PATCH)\s+([^"]+?)\s+HTTP/);
  return match ? `${match[1]} ${match[2].split("?")[0]}` : "Unknown";
};
