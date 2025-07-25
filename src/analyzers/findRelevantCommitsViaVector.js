// src/analyzers/findRelevantCommitsViaVector.js
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

function extractRelevantDiffLines(content, logText, topN = 5) {
  if (!content || !logText) return [];

  const logWords = new Set(logText.toLowerCase().split(/[^a-zA-Z0-9_]+/).filter(Boolean));

  const diffLines = content
    .split("\n")
    .filter(line =>
      (line.startsWith("+") || line.startsWith("-")) &&
      !line.startsWith("+++") && !line.startsWith("---")
    );

  const scored = diffLines.map(line => {
    const tokens = line.replace(/^[-+]/, "").toLowerCase().split(/\W+/);
    const matchScore = tokens.filter(token => logWords.has(token)).length;
    return { line, score: matchScore };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(item => item.line);
}

async function findRelevantCommitsViaVector(logText, topK = 3) {
  try {
    const collection = await client.getCollection({
      name: "codebase",
      embeddingFunction: new OpenAIEmbedder(),
    });

    const result = await collection.query({
      queryTexts: [logText],
      nResults: topK,
      where: { type: "commit" },
      include: ["documents", "distances"]
    });

    const documents = result.documents?.[0] || [];
    const ids = result.ids?.[0] || [];

    const simplified = documents.map((doc, i) => {
      const rawId = typeof ids[i] === "string" ? ids[i] : "";
      const content = typeof doc === "string" ? doc : "";
    
      const commit_id_match = content.match(/commit\s+([a-f0-9]{40})/i);
      const commit_id = commit_id_match?.[1] || rawId.replace("commit-history/", "").replace(".txt", "unknown");
    
      const commit_line = extractRelevantDiffLines(content, logText);
    
      // ✅ Track which file each relevant line came from
      const fileLineMap = {};
      let currentFile = null;
    
      const lines = content.split("\n");
      for (let line of lines) {
        const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+)/);
        if (fileMatch) {
          currentFile = fileMatch[1]; // Start tracking new file
          continue;
        }
    
        if (!currentFile) continue;
    
        if ((line.startsWith("+") || line.startsWith("-")) &&
            !line.startsWith("+++") && !line.startsWith("---")) {
    
          if (!fileLineMap[currentFile]) fileLineMap[currentFile] = [];
    
          fileLineMap[currentFile].push(line);
        }
      }
    
      // ✅ Only include filenames that have at least 1 matched line
      const relevantFiles = Object.entries(fileLineMap)
        .filter(([filename, lines]) =>
          lines.some(line =>
            commit_line.includes(line)
          )
        )
        .map(([filename]) => filename);
    
      return {
        commit_id,
        filenames: relevantFiles,
        commit_line
      };
    });
    

    return simplified;
  } catch (err) {
    console.error("❌ Error in findRelevantCommitsViaVector:", err);
    return [];
  }
}

module.exports = { findRelevantCommitsViaVector };
