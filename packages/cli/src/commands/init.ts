import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { saveConfig, saveToken, loadConfig } from "../config";

interface InitOptions {
  token: string;
  repo: string;
  branch: string;
}

export async function initCommand(
  dir: string,
  options: InitOptions,
): Promise<void> {
  try {
    await loadConfig(dir);
    console.error("Already initialized. Run `pylon sync` to sync.");
    process.exit(1);
  } catch {
    // Not initialized yet — continue
  }

  await saveToken(options.token);
  await saveConfig(dir, {
    provider: "github",
    repo: options.repo,
    branch: options.branch,
  });

  const gitignorePath = join(dir, ".gitignore");
  try {
    const content = await readFile(gitignorePath, "utf-8");
    if (!content.includes(".pylon")) {
      await writeFile(gitignorePath, content + "\n.pylon/\n");
    }
  } catch {
    await writeFile(gitignorePath, ".pylon/\n");
  }

  console.log(`Initialized pylon for ${options.repo}`);
}
