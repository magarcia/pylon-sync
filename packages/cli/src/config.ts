import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getPassword, setPassword } from "cross-keychain";
import type { PluginData } from "@pylon-sync/core";

const SERVICE_NAME = "pylon-sync";
const ACCOUNT_NAME = "github-token";

export interface CliConfig {
  provider: "github";
  repo: string;
  branch: string;
  commitMessage?: string;
  commitMessageCommand?: string;
}

const CONFIG_DIR = ".pylon";
const CONFIG_FILE = "config.json";
const DATA_FILE = "data.json";

function defaultPluginData(): PluginData {
  return {
    snapshot: {},
    lastSyncTime: 0,
    syncCount: 0,
    cursor: null,
  };
}

export async function loadConfig(dir: string): Promise<CliConfig> {
  try {
    const content = await readFile(join(dir, CONFIG_DIR, CONFIG_FILE), "utf-8");
    return JSON.parse(content) as CliConfig;
  } catch {
    throw new Error(
      'Not initialized. Run "pylon init --repo owner/repo" first.',
    );
  }
}

export async function saveConfig(
  dir: string,
  config: CliConfig,
): Promise<void> {
  await mkdir(join(dir, CONFIG_DIR), { recursive: true });
  await writeFile(
    join(dir, CONFIG_DIR, CONFIG_FILE),
    JSON.stringify(config, null, 2),
  );
}

export async function loadToken(dir: string): Promise<string> {
  try {
    const token = await getPassword(SERVICE_NAME, ACCOUNT_NAME);
    return token ?? "";
  } catch {
    // Keychain not available — fall back to config file
    try {
      const content = await readFile(
        join(dir, CONFIG_DIR, CONFIG_FILE),
        "utf-8",
      );
      const raw = JSON.parse(content) as Record<string, unknown>;
      return (raw.token as string) ?? "";
    } catch {
      return "";
    }
  }
}

export async function saveToken(token: string): Promise<void> {
  try {
    await setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
  } catch {
    console.warn(
      "Warning: Could not save token to keychain. Token will not persist.",
    );
  }
}

export async function loadData(dir: string): Promise<PluginData> {
  try {
    const dataPath = join(dir, CONFIG_DIR, DATA_FILE);
    const content = await readFile(dataPath, "utf-8");
    return JSON.parse(content) as PluginData;
  } catch {
    return defaultPluginData();
  }
}

export async function saveData(
  dir: string,
  data: PluginData,
): Promise<void> {
  await mkdir(join(dir, CONFIG_DIR), { recursive: true });
  await writeFile(
    join(dir, CONFIG_DIR, DATA_FILE),
    JSON.stringify(data, null, 2),
  );
}
