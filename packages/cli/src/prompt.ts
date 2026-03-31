import { createInterface } from "node:readline";
import { EXIT_AUTH } from "./exit-codes";

export async function promptToken(): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "Error: No token provided. Set GITHUB_TOKEN environment variable or run interactively.\n",
    );
    process.exit(EXIT_AUTH);
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question("GitHub Token: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
