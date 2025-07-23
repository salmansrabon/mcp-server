const fs = require("fs/promises");
const path = require("path");
const glob = require("glob");
const { CODEBASE_PATH } = require("../config/env");

async function findCodeForEndpoint(endpoint) {
  const [method, fullRoute] = endpoint.split(" ");
  if (!method || !fullRoute) return "❗ Could not parse endpoint.";

  const routeFiles = glob.sync(path.join(CODEBASE_PATH, "**/*.js"));
  const controllerFiles = glob.sync(
    path.join(CODEBASE_PATH, "**/{controller,controllers}/**/*.js")
  );

  const basePathMap = new Map();     // routerVar => '/user'
  const controllerFunctions = new Set();
  const routeMatches = [];

  // 1) Build map of app.use('/base', routerVar)
  for (const file of routeFiles) {
    const content = await fs.readFile(file, "utf-8");
    for (const m of content.matchAll(/app\.use\(['"`]([^'"`]+)['"`],\s*(\w+)/g)) {
      basePathMap.set(m[2], m[1]);
    }
  }

  // 2) Scan each router file for routerVar.get/post(...)
  for (const file of routeFiles) {
    const content = await fs.readFile(file, "utf-8");
    for (const [routerVar, basePath] of basePathMap.entries()) {
      const pattern = new RegExp(
        `${escapeRegExp(routerVar)}\\.${method.toLowerCase()}\\(['"\`]([^'"\`]+)['"\`],\\s*(.*?)\\)`,
        "g"
      );
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const subRoute = match[1];
        const fullMatch = match[0];
        const combinedRoute = `${basePath}${subRoute.startsWith("/") ? "" : "/"}${subRoute}`;

        if (
          fullRoute === combinedRoute ||
          fullRoute.startsWith(combinedRoute) ||
          combinedRoute.startsWith(fullRoute)
        ) {
          const lines = content.split("\n");
          const idx = lines.findIndex((l) => l.includes(fullMatch));
          const snippet = lines.slice(Math.max(0, idx - 5), idx + 10).join("\n");

          routeMatches.push(`📁 File: ${file}\n➡ Route: ${combinedRoute}\n${snippet}`);

          // controller calls inside match[2]
          const controllerCalls = match[2]
            .split(",")
            .map((c) => c.trim())
            .filter((c) => /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z0-9_]+$/.test(c));

          for (const call of controllerCalls) {
            const [, fn] = call.split(".");
            if (fn) controllerFunctions.add(fn);
          }
        }
      }
    }
  }

  // 3) Find controller definitions
  let controllerSnippets = "";
  for (const file of controllerFiles) {
    const content = await fs.readFile(file, "utf-8");
    for (const fnName of controllerFunctions) {
      const regex = new RegExp(
        `(async\\s+)?function\\s+${fnName}\\s*\\(|const\\s+${fnName}\\s*=\\s*async\\s*\\(|exports\\.${fnName}\\s*=\\s*async\\s*\\(`,
        "g"
      );
      let match;
      while ((match = regex.exec(content)) !== null) {
        const lines = content.split("\n");
        const start = lines.findIndex((l) => l.includes(match[0]));
        const snippet = lines.slice(start, start + 20).join("\n");
        controllerSnippets += `\n📁 Controller: ${file}\n➡ Function: ${fnName}\n${snippet}\n---\n`;
      }
    }
  }

  if (routeMatches.length === 0 && !controllerSnippets) {
    return "❗ No matching code found for this endpoint.";
  }

  return [...routeMatches, controllerSnippets].join("\n\n---\n\n");
}

module.exports = findCodeForEndpoint;
