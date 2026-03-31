#!/usr/bin/env node
import { resolve } from "node:path";
import { cac } from "cac";
import { promptToken } from "./prompt";
import { EXIT_AUTH, EXIT_SYNC_ERROR } from "./exit-codes";

const cli = cac("pylon");

cli
  .command("init", "Initialize sync in current directory")
  .option("-r, --repo <repo>", "GitHub repository (owner/repo)")
  .option("-b, --branch <branch>", "Branch to sync with", { default: "main" })
  .action(async (options: { repo?: string; branch: string }) => {
    if (!options.repo) {
      process.stderr.write(
        "Error: --repo is required. Usage: pylon init --repo owner/repo\n",
      );
      process.exit(EXIT_AUTH);
    }
    const token = process.env.GITHUB_TOKEN || (await promptToken());
    const { initCommand } = await import("./commands/init");
    await initCommand(resolve(process.cwd()), {
      token,
      repo: options.repo,
      branch: options.branch,
    });
  });

cli
  .command("sync", "Run one sync cycle")
  .option("--full-scan", "Force full hash scan ignoring mtime")
  .option("-o, --output <format>", "Output format: text or json", {
    default: "text",
  })
  .action(async (options: { fullScan?: boolean; output: string }) => {
    const { syncCommand } = await import("./commands/sync");
    await syncCommand(resolve(process.cwd()), {
      forceFullScan: options.fullScan,
      outputJson: options.output === "json",
    });
  });

cli
  .command("status", "Show local changes since last sync")
  .option("-o, --output <format>", "Output format: text or json", {
    default: "text",
  })
  .action(async (options: { output: string }) => {
    const { statusCommand } = await import("./commands/status");
    await statusCommand(resolve(process.cwd()), {
      outputJson: options.output === "json",
    });
  });

cli.help();
cli.version("0.1.0");

process.on("SIGINT", () => {
  process.stderr.write("\nInterrupted\n");
  process.exit(130);
});

process.on("SIGTERM", () => {
  process.exit(143);
});

try {
  cli.parse();
} catch (err) {
  if (err instanceof Error) {
    process.stderr.write(`${err.message}\n`);
  }
  process.exit(EXIT_SYNC_ERROR);
}
