import { execSync } from "node:child_process";
import { SyncEngine, DEFAULT_SYNC_SETTINGS } from "@pylon-sync/core";
import type { SyncSettings } from "@pylon-sync/core";
import { GitHubProvider } from "@pylon-sync/provider-github";
import { NodeFileSystem } from "../node-fs";
import { NodeHttpClient } from "../node-http";
import { loadConfig, loadToken, loadData, saveData } from "../config";
import { EXIT_AUTH, EXIT_SYNC_ERROR } from "../exit-codes";

export interface SyncCommandOptions {
  forceFullScan?: boolean;
  outputJson?: boolean;
}

export async function syncCommand(
  dir: string,
  options: SyncCommandOptions,
): Promise<void> {
  const config = await loadConfig(dir);
  const token = process.env.GITHUB_TOKEN || (await loadToken(dir));
  if (!token) {
    process.stderr.write(
      "Error: No token found. Run 'pylon init' or set GITHUB_TOKEN env var.\n",
    );
    process.exit(EXIT_AUTH);
  }
  const data = await loadData(dir);

  const fs = new NodeFileSystem(dir);
  const http = new NodeHttpClient();

  let commitMessage = config.commitMessage ?? "pylon: sync";
  if (config.commitMessageCommand) {
    try {
      commitMessage = execSync(config.commitMessageCommand, {
        cwd: dir,
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();
    } catch {
      process.stderr.write(
        `Warning: commitMessageCommand failed, using template: ${commitMessage}\n`,
      );
    }
  }

  const settings: SyncSettings = {
    ...DEFAULT_SYNC_SETTINGS,
    githubRepo: config.repo,
    branch: config.branch,
    autoSync: false,
    commitMessage,
  };

  const provider = new GitHubProvider(
    {
      token,
      repo: config.repo,
      branch: config.branch,
      commitMessage,
    },
    http,
  );

  if (options.forceFullScan) {
    data.syncCount = 0;
  }

  if (!options.outputJson && process.stdout.isTTY) {
    process.stderr.write("Scanning...\r");
  }

  const engine = new SyncEngine(fs, provider, settings, data, {
    onSaveData: async (newData) => {
      await saveData(dir, newData);
    },
  });

  const result = await engine.sync();

  if (result.status === "success") {
    const changes = result.mutations.filter(
      (m) => m.disk !== "skip" || m.remote !== "skip",
    );
    if (options.outputJson) {
      console.log(
        JSON.stringify({
          status: result.status,
          changes: changes.length,
          mutations: result.mutations.map((m) => ({
            path: m.path,
            disk: m.disk,
            remote: m.remote,
          })),
        }),
      );
    } else {
      console.log(`Synced: ${changes.length} change(s)`);
    }
  } else if (result.status === "no-changes") {
    if (options.outputJson) {
      console.log(JSON.stringify({ status: "no-changes", changes: 0, mutations: [] }));
    } else {
      console.log("Already up to date");
    }
  } else {
    if (options.outputJson) {
      console.log(
        JSON.stringify({ status: "error", error: result.error?.message }),
      );
    } else {
      process.stderr.write(`Sync failed: ${result.error?.message}\n`);
    }
    process.exit(EXIT_SYNC_ERROR);
  }
}
