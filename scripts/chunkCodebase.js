const fs = require("fs/promises");
const glob = require("glob");
const path = require("path");
const { CODEBASE_PATH } = require("../src/config/env");

const EXCLUDED_DIRS = ["node_modules", "logs", "swagger"];

// Check if a path includes any excluded folders
function isExcluded(filePath) {
  return EXCLUDED_DIRS.some(dir =>
    filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`)
  );
}

async function chunkCodebase(codebaseDir = CODEBASE_PATH) {
  const allFiles = glob.sync(path.join(codebaseDir, "**/*.js"), { nodir: true });
  const files = allFiles.filter(f => !isExcluded(f));

  const chunks = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf-8");
    const lines = content.split("\n");

    let chunk = "";
    let startLine = 0;
    let insideFn = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const fnRegex =
        /(async\s*)?function\s+\w+\s*\(|const\s+\w+\s*=\s*(async\s*)?\(.*?\)\s*=>/;

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

    // Fallback: if file has no functions, add whole file
    if (chunks.filter(c => c.metadata.file === file).length === 0 && content.trim().length > 0) {
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
  }

  return chunks;
}

// Execute and write result
chunkCodebase().then((chunks) => {
  fs.writeFile("./chunks.json", JSON.stringify(chunks, null, 2)).then(() =>
    console.log(`✅ Total chunks saved: ${chunks.length}`)
  );
});
