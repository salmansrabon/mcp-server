const simpleGit = require("simple-git");
const fs = require("fs/promises");
const { CODEBASE_PATH, COMMIT_DIFF_PATH, LAST_COMMIT_PATH } = require("../config/env");

const git = simpleGit(CODEBASE_PATH);

async function getLatestCommitDiff(commitHash) {
  const diff = await git.show([commitHash]);
  await fs.writeFile(COMMIT_DIFF_PATH, diff);
  await fs.writeFile(LAST_COMMIT_PATH, commitHash);
  return diff;
}

module.exports = { getLatestCommitDiff };
