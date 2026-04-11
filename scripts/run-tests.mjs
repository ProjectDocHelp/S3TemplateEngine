import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function listTestFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTestFiles(rootDir, fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

const rootDir = path.resolve("packages");
const testFiles = await listTestFiles(rootDir);

if (testFiles.length === 0) {
  process.stdout.write("No test files found.\n");
  process.exit(0);
}

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit"
  });
  child.on("error", reject);
  child.on("close", (code) => resolve(code ?? 1));
});

process.exit(exitCode);
