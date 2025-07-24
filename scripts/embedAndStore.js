const { OpenAI } = require("openai");
const { ChromaClient } = require("chromadb");
const fs = require("fs/promises");
const path = require("path");
require("dotenv").config();

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Define embedding function wrapper for Chroma
class OpenAIEmbedder {
  async generate(texts) {
    const res = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: texts,
    });
    return res.data.map((item) => item.embedding);
  }
}

// Directories to exclude
const EXCLUDED_DIRS = ["node_modules", "logs", "swagger"];

// Utility to check if file path includes any excluded folders
function isExcluded(filePath) {
  return EXCLUDED_DIRS.some(
    (dir) => filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`)
  );
}

// Main execution
(async () => {
  const client = new ChromaClient({
    host: "localhost",
    port: process.env.CHROMA_DB_PORT || 8001,
    ssl: false,
  });

  const collection = await client.getOrCreateCollection({
    name: "codebase",
    embeddingFunction: new OpenAIEmbedder(),
  });

  // 👉 Embed commit history
  const commitHistoryPath = path.resolve("commit-history");
  const hasCommitHistory = await fs.stat(commitHistoryPath).then(() => true).catch(() => false);

  if (hasCommitHistory) {
    const commitFiles = await fs.readdir(commitHistoryPath);
    for (const file of commitFiles) {
      if (!file.endsWith(".txt")) {
        console.log(`⏭️ Skipping non-text file in commit-history: ${file}`);
        continue;
      }

      const content = await fs.readFile(path.join(commitHistoryPath, file), "utf-8");
      await collection.add({
        ids: [`commit-history/${file}`],
        documents: [content],
        metadatas: [{ type: "commit", filename: file }],
      });
      console.log(`📄 Embedded commit diff: ${file}`);
    }
  } else {
    console.log("⚠️ No commit-history directory found. Skipping commit embedding.");
  }

  // 👉 Read chunks.json file
  const chunkPath = path.resolve("./chunks.json");
  const chunksRaw = await fs.readFile(chunkPath, "utf-8");
  const chunks = JSON.parse(chunksRaw);

  let skipped = 0;
  let embedded = 0;

  for (const chunk of chunks) {
    const { id, text, metadata } = chunk;

    if (isExcluded(id)) {
      console.log(`⏭️ Skipping chunk from excluded path: ${id}`);
      skipped++;
      continue;
    }

    if (!text || typeof text !== "string") {
      console.warn(`⚠️ Skipping invalid chunk ${id} (text missing or not a string)`);
      skipped++;
      continue;
    }

    await collection.add({
      ids: [id],
      documents: [text],
      metadatas: [metadata],
    });

    console.log(`✅ Embedded chunk: ${id}`);
    embedded++;
  }

  console.log(`🎉 Done! Embedded: ${embedded}, Skipped: ${skipped}`);
})();
