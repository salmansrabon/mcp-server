// scripts/testCodeSearch.js

const { OpenAI } = require("openai");
const { ChromaClient } = require("chromadb");
require("dotenv").config();

// Initialize OpenAI API
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Embedding function class for ChromaDB
class OpenAIEmbedder {
  async generate(texts) {
    const res = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: texts,
    });
    return res.data.map((item) => item.embedding);
  }
}

(async () => {
  const client = new ChromaClient({
    host: "localhost",
    port: process.env.CHROMA_DB_PORT || 8001,
    ssl: false,
  });

  // Attach the embedding function when loading the collection
  const collection = await client.getOrCreateCollection({
    name: "codebase",
    embeddingFunction: new OpenAIEmbedder(),
  });

  // Display all collections
  console.log("📦 Existing collections in ChromaDB:");
  const collections = await client.listCollections();
  for (const col of collections) {
    console.log(`➡️  ${col.name}`);
  }

  // Run a test semantic search
  const results = await collection.query({
    queryTexts: ["tell me about the latest commit"],
    nResults: 3,
  });

  console.log("🔍 Query result:", JSON.stringify(results, null, 2));
})();
