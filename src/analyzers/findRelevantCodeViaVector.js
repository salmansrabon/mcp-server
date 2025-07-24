// analyzers/findRelevantCodeViaVector.js

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

const embedder = new OpenAIEmbedder();

async function findRelevantCodeViaVector(logText) {
  const client = new ChromaClient({
    host: "localhost",
    port: process.env.CHROMA_DB_PORT || 8001,
    ssl: false,
  });

  const collection = await client.getCollection({
    name: "codebase",
    embeddingFunction: embedder,
  });

  const result = await collection.query({
    queryTexts: [logText],
    nResults: 3,
  });

  const docs = result.documents?.[0] || [];
  const ids = result.ids?.[0] || [];

  return docs.map((doc, i) => `📄 ${ids[i]}\n${doc}`).join("\n\n");
}

module.exports = findRelevantCodeViaVector;
