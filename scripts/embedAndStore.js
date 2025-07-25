const { OpenAI } = require("openai");
const { ChromaClient } = require("chromadb");
const fs = require("fs/promises");
const path = require("path");
require("dotenv").config();

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Embedding wrapper for Chroma
class OpenAIEmbedder {
  async generate(texts) {
    const res = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: texts,
    });
    return res.data.map((item) => item.embedding);
  }
}

// Exclude these directories
const EXCLUDED_DIRS = ["node_modules", "logs", "swagger"];

// Check if path is excluded
function isExcluded(filePath) {
  return EXCLUDED_DIRS.some(
    (dir) => filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`)
  );
}

// Generate enriched commit content
async function generateEnrichedCommitContent(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  const commit_id = path.basename(filePath, ".txt");

  const messageMatch = raw.match(/^\s{4}(.*)$/m); // commit message (usually indented)
  const message = messageMatch ? messageMatch[1].trim() : "No commit message found";

  const fileMatches = [...raw.matchAll(/diff --git a\/([^\s]+) b\//g)];
  const filenames = [...new Set(fileMatches.map((m) => m[1]))];

  const summary = [
    `commit ${commit_id}`,
    `message: ${message}`,
    `affected files: ${filenames.join(", ")}`,
    `summary:`,
    `- Likely changes in: ${filenames.map(f => f.split("/").pop().replace(".js", "")).join(", ")}`,
    `- Based on diff, changes involve HTTP status codes, error handling, or logging`,
    ``,
    raw
  ];

  return summary.join("\n");
}

// Main function
(async () => {
  const client = new ChromaClient({
    host: "localhost",
    port: parseInt(process.env.CHROMA_DB_PORT || "8001"),
    ssl: false,
  });

  const collection = await client.getOrCreateCollection({
    name: "codebase",
    embeddingFunction: new OpenAIEmbedder(),
  });

  // 👉 Embed commit history with enriched context
  const commitHistoryPath = path.resolve("commit-history");
  const hasCommitHistory = await fs.stat(commitHistoryPath).then(() => true).catch(() => false);

  if (hasCommitHistory) {
    const commitFiles = await fs.readdir(commitHistoryPath);
    for (const file of commitFiles) {
      if (!file.endsWith(".txt")) {
        console.log(`⏭️ Skipping non-text file in commit-history: ${file}`);
        continue;
      }

      const enrichedContent = await generateEnrichedCommitContent(path.join(commitHistoryPath, file));

      await collection.add({
        ids: [`commit-history/${file}`],
        documents: [enrichedContent],
        metadatas: [{ type: "commit", filename: file }],
      });

      console.log(`📄 Embedded enriched commit: ${file}`);
    }
  } else {
    console.log("⚠️ No commit-history directory found. Skipping commit embedding.");
  }

  // 👉 Embed code chunks from chunks.json
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
