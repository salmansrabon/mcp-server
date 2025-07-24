// analyzers/findRelevantCommitsViaVector.js
const { OpenAI } = require("openai");
const { ChromaClient } = require("chromadb");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

class OpenAIEmbedder {
  async generate(texts) {
    const res = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: texts,
    });
    return res.data.map((item) => item.embedding);
  }
}

const client = new ChromaClient({
  host: "localhost",
  port: parseInt(process.env.CHROMA_DB_PORT || "8001"),
  ssl: false,
});

async function findRelevantCommitsViaVector(logText, topK = 3) {
  const collection = await client.getCollection({
    name: "codebase",
    embeddingFunction: new OpenAIEmbedder(),
  });

  const all = await collection.get();
  const commitIds = all.ids?.filter((id) => id.startsWith("commit-history/")) || [];

  if (!commitIds.length) {
    return "❌ No commit diffs embedded in vector DB";
  }

  const result = await collection.query({
    queryTexts: [logText],
    nResults: topK,
    where: { id: { "$in": commitIds } },
    include: ["documents", "distances"] // ✅ removed 'ids'
  });

  const topMatches = result.documents?.[0] || [];
  const scores = result.distances?.[0] || [];

  if (!topMatches.length) {
    return "❌ No relevant commit diffs found";
  }

  return topMatches.map((doc, i) =>
    `🧾 Commit #${i + 1} (score: ${scores[i].toFixed(4)})\n${doc.slice(0, 300)}...`
  ).join("\n\n");
}

module.exports = findRelevantCommitsViaVector;
