import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MINIMUM_TOTAL_COVERAGE = 75;
const COVERAGE_DIR = "/tmp/pi-web-sidebar-coverage";

const run = spawnSync("bun", ["test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", "--coverage-dir", COVERAGE_DIR], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
});

process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");

if (run.status !== 0) {
  process.exit(run.status ?? 1);
}

const plainOutput = `${run.stdout || ""}\n${run.stderr || ""}`.replace(/\u001b\[[0-9;]*m/g, "");
const summary = plainOutput.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m);

if (!summary) {
  console.error("coverage summary not found");
  process.exit(1);
}

const functionCoverage = Number(summary[1]);
const lineCoverage = Number(summary[2]);

if (functionCoverage < MINIMUM_TOTAL_COVERAGE || lineCoverage < MINIMUM_TOTAL_COVERAGE) {
  console.error(
    `total coverage below ${MINIMUM_TOTAL_COVERAGE}%: functions ${functionCoverage.toFixed(2)}%, lines ${lineCoverage.toFixed(2)}%`,
  );
  process.exit(1);
}

const changedLines = changedExecutableSourceLines();
addUntrackedSourceLines(changedLines);
const coverage = lcovLineCoverage(`${COVERAGE_DIR}/lcov.info`);
const misses = [];

for (const [file, lines] of changedLines) {
  const fileCoverage = coverage.get(file) || coverage.get(`./${file}`);

  if (!fileCoverage) {
    misses.push(`${file}: no coverage data`);
    continue;
  }

  for (const line of lines) {
    const hits = fileCoverage.get(line);

    if (hits !== undefined && hits < 1) {
      misses.push(`${file}:${line}`);
    }
  }
}

if (misses.length > 0) {
  console.error(`changed executable lines lack coverage:\n${misses.join("\n")}`);
  process.exit(1);
}

console.log(
  `coverage gate passed: total functions ${functionCoverage.toFixed(2)}%, total lines ${lineCoverage.toFixed(2)}%, changed executable lines 100%`,
);

function changedExecutableSourceLines() {
  const diff = spawnSync("git", ["diff", "--unified=0", "HEAD", "--", "src/**/*.ts"], { encoding: "utf8" });

  if (diff.status !== 0) {
    throw new Error(diff.stderr || "failed to read git diff");
  }

  const result = new Map();
  let file = "";
  let nextLine = 0;

  for (const line of diff.stdout.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);

    if (fileMatch) {
      file = fileMatch[1];
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);

    if (hunkMatch) {
      nextLine = Number(hunkMatch[1]);
      continue;
    }

    if (!file || nextLine === 0 || line.startsWith("+++")) {
      continue;
    }

    if (line.startsWith("+")) {
      const source = line.slice(1).trim();

      if (source && !source.startsWith("type ") && !source.startsWith("import ")) {
        if (!result.has(file)) {
          result.set(file, new Set());
        }

        result.get(file).add(nextLine);
      }

      nextLine += 1;
      continue;
    }

    if (!line.startsWith("-")) {
      nextLine += 1;
    }
  }

  return result;
}

function addUntrackedSourceLines(result) {
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "--", "src/**/*.ts"], {
    encoding: "utf8",
  });

  if (untracked.status !== 0) {
    throw new Error(untracked.stderr || "failed to read untracked source files");
  }

  for (const file of untracked.stdout.split("\n").filter(Boolean)) {
    const lines = readFileSync(file, "utf8").split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      const source = lines[index].trim();

      if (source && !source.startsWith("type ") && !source.startsWith("import ")) {
        if (!result.has(file)) {
          result.set(file, new Set());
        }

        result.get(file).add(index + 1);
      }
    }
  }
}

function lcovLineCoverage(path) {
  const lcov = readFileSync(path, "utf8");
  const result = new Map();
  let file = "";

  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) {
      file = line.slice(3);
      result.set(file, new Map());
      continue;
    }

    if (file && line.startsWith("DA:")) {
      const [lineNumber, hits] = line.slice(3).split(",").map(Number);
      result.get(file).set(lineNumber, hits);
    }
  }

  return result;
}
