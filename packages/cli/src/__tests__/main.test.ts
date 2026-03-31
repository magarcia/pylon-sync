import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cac } from "cac";

describe("CLI (cac-based)", () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("should parse init command with --repo and --branch flags", () => {
    const cli = cac("pylon");
    let capturedOptions: Record<string, unknown> = {};

    cli
      .command("init", "Initialize sync")
      .option("-r, --repo <repo>", "GitHub repository")
      .option("-b, --branch <branch>", "Branch", { default: "main" })
      .action((options: Record<string, unknown>) => {
        capturedOptions = options;
      });

    cli.parse(["", "", "init", "--repo", "owner/repo", "--branch", "develop"]);

    expect(capturedOptions.repo).toBe("owner/repo");
    expect(capturedOptions.branch).toBe("develop");
  });

  it("should parse short flags -r and -b for init", () => {
    const cli = cac("pylon");
    let capturedOptions: Record<string, unknown> = {};

    cli
      .command("init", "Initialize sync")
      .option("-r, --repo <repo>", "GitHub repository")
      .option("-b, --branch <branch>", "Branch", { default: "main" })
      .action((options: Record<string, unknown>) => {
        capturedOptions = options;
      });

    cli.parse(["", "", "init", "-r", "owner/repo", "-b", "develop"]);

    expect(capturedOptions.repo).toBe("owner/repo");
    expect(capturedOptions.branch).toBe("develop");
  });

  it("should parse sync command with --full-scan and --output flags", () => {
    const cli = cac("pylon");
    let capturedOptions: Record<string, unknown> = {};

    cli
      .command("sync", "Run one sync cycle")
      .option("--full-scan", "Force full hash scan")
      .option("-o, --output <format>", "Output format", { default: "text" })
      .action((options: Record<string, unknown>) => {
        capturedOptions = options;
      });

    cli.parse(["", "", "sync", "--full-scan", "--output", "json"]);

    expect(capturedOptions.fullScan).toBe(true);
    expect(capturedOptions.output).toBe("json");
  });

  it("should parse status command with --output json via short flag", () => {
    const cli = cac("pylon");
    let capturedOptions: Record<string, unknown> = {};

    cli
      .command("status", "Show local changes")
      .option("-o, --output <format>", "Output format", { default: "text" })
      .action((options: Record<string, unknown>) => {
        capturedOptions = options;
      });

    cli.parse(["", "", "status", "-o", "json"]);

    expect(capturedOptions.output).toBe("json");
  });

  it("should default --output to text for sync", () => {
    const cli = cac("pylon");
    let capturedOptions: Record<string, unknown> = {};

    cli
      .command("sync", "Run one sync cycle")
      .option("--full-scan", "Force full hash scan")
      .option("-o, --output <format>", "Output format", { default: "text" })
      .action((options: Record<string, unknown>) => {
        capturedOptions = options;
      });

    cli.parse(["", "", "sync"]);

    expect(capturedOptions.output).toBe("text");
    expect(capturedOptions.fullScan).toBeUndefined();
  });

  it("should default --branch to main for init", () => {
    const cli = cac("pylon");
    let capturedOptions: Record<string, unknown> = {};

    cli
      .command("init", "Initialize sync")
      .option("-r, --repo <repo>", "GitHub repository")
      .option("-b, --branch <branch>", "Branch", { default: "main" })
      .action((options: Record<string, unknown>) => {
        capturedOptions = options;
      });

    cli.parse(["", "", "init", "--repo", "owner/repo"]);

    expect(capturedOptions.branch).toBe("main");
  });
});
