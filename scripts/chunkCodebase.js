const fs = require("fs/promises");
const glob = require("glob");
const path = require("path");
const { CODEBASE_PATH } = require("../src/config/env");

const EXCLUDED_DIRS = ["node_modules", "logs", "swagger"];

// Check if a path includes any excluded folders
function isExcluded(filePath) {
  return EXCLUDED_DIRS.some(
    (dir) =>
      filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`)
  );
}

async function chunkCodebase(codebaseDir = CODEBASE_PATH) {
  const allFiles = glob.sync(path.join(codebaseDir, "**/*.js"), { nodir: true });
  const excluded = allFiles.filter(isExcluded);
  const files = allFiles.filter((f) => !isExcluded(f));

  console.log("🔍 Total JS files found:", allFiles.length);
  console.log("📤 After exclusion:", files.length);
  if (excluded.length > 0) {
    console.log("🛑 Excluded files:");
    excluded.forEach((f) => console.log("   ", f));
  }

  const chunks = [];

  for (const file of files) {
    console.log("📄 Processing:", file);
    try {
      const content = await fs.readFile(file, "utf-8");
      const lines = content.split("\n");

      let chunk = "";
      let startLine = 0;
      let insideFn = false;

      const fnRegex =
        /(async\s*)?function\s+\w+\s*\(|const\s+\w+\s*=\s*(async\s*)?\(?[^\)]*\)?\s*=>/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (fnRegex.test(line)) {
          if (insideFn && chunk) {
            chunks.push({
              id: `${file}::${startLine}`,
              text: chunk.trim(),
              metadata: {
                file,
                start_line: startLine,
                type: "function",
              },
            });
          }

          chunk = line + "\n";
          startLine = i + 1;
          insideFn = true;
        } else if (insideFn) {
          chunk += line + "\n";
          if (line.trim() === "}" || i === lines.length - 1) {
            chunks.push({
              id: `${file}::${startLine}`,
              text: chunk.trim(),
              metadata: {
                file,
                start_line: startLine,
                type: "function",
              },
            });
            chunk = "";
            insideFn = false;
          }
        }
      }

      // Fallback: if no functions found in file
      const hasChunks = chunks.some((c) => c.metadata.file === file);
      if (!hasChunks && content.trim().length > 0) {
        console.log("📎 Fallback full file chunk:", file);
        chunks.push({
          id: `${file}::0`,
          text: content.trim(),
          metadata: {
            file,
            start_line: 0,
            type: "file",
          },
        });
      }
    } catch (err) {
      console.error("❌ Failed to read file:", file, err.message);
    }
  }

  return chunks;
}

// Run the chunking and write to file
chunkCodebase()
  .then((chunks) =>
    fs
      .writeFile("./chunks.json", JSON.stringify(chunks, null, 2))
      .then(() =>
        console.log(`✅ Total chunks saved: ${chunks.length} → chunks.json`)
      )
      .catch((err) => console.error("❌ Failed to write chunks.json:", err))
  )
  .catch((err) => {
    console.error("❌ Chunking failed:", err);
  });
