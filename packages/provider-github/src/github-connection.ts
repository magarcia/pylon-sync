import { GitHubApi } from "./github-api";
import type { HttpClient } from "@pylon-sync/core";
import type { TokenProvider } from "@pylon-sync/auth-github";

export interface GitHubUser {
  readonly login: string;
  readonly avatar_url: string;
}

export interface GitHubRepo {
  readonly full_name: string;
  readonly private: boolean;
  // Whether the *user* (per GitHub's permissions.push) has push access.
  // Note: this does NOT reflect token scope for fine-grained PATs; repo owners
  // always see `push: true` regardless of token restrictions.
  readonly can_push: boolean;
}

export interface GitHubInstallation {
  readonly id: number;
  readonly account_login: string;
  readonly target_type: "User" | "Organization";
  // "all" = app installed on every repo the user can access within this account
  // "selected" = app installed on a specific subset of repos
  readonly repository_selection: "all" | "selected";
}

interface RawUser {
  readonly login: string;
  readonly avatar_url: string;
}

interface RawRepo {
  readonly full_name: string;
  readonly private: boolean;
  readonly permissions?: { push?: boolean };
}

interface RawInstallation {
  readonly id: number;
  readonly account: { login: string };
  readonly target_type: string;
  readonly repository_selection: string;
}

interface RawInstallationsResponse {
  readonly installations: RawInstallation[];
}

interface RawInstallationReposResponse {
  readonly repositories: RawRepo[];
}

export class GitHubConnection {
  private api: GitHubApi;

  constructor(
    http: HttpClient,
    private auth: TokenProvider,
    host: string = "github.com",
  ) {
    this.api = new GitHubApi(http, host);
  }

  async getUser(): Promise<GitHubUser> {
    const res = await this.api.rest("GET", "/user", this.auth);
    const raw = res.json as RawUser;
    return { login: raw.login, avatar_url: raw.avatar_url };
  }

  async listRepos(page = 1, perPage = 100): Promise<GitHubRepo[]> {
    const res = await this.api.rest(
      "GET",
      `/user/repos?sort=updated&per_page=${perPage}&page=${page}&type=all`,
      this.auth,
    );
    const raw = res.json as RawRepo[];
    return raw.map(toGitHubRepo);
  }

  async listBranches(repo: string): Promise<string[]> {
    const [owner, name] = repo.split("/");
    const res = await this.api.rest(
      "GET",
      `/repos/${owner}/${name}/branches?per_page=100`,
      this.auth,
    );
    return (res.json as Array<{ name: string }>).map((b) => b.name);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getUser();
      return true;
    } catch {
      return false;
    }
  }

  // List installations of the current GitHub App for the authenticated user.
  // Only meaningful with a GitHub App user token — PATs return empty or error.
  async listInstallations(): Promise<GitHubInstallation[]> {
    const res = await this.api.rest("GET", "/user/installations", this.auth);
    const raw = res.json as RawInstallationsResponse;
    if (!Array.isArray(raw.installations)) return [];
    return raw.installations.map((inst) => ({
      id: inst.id,
      account_login: inst.account.login,
      target_type: inst.target_type === "Organization" ? "Organization" : "User",
      repository_selection:
        inst.repository_selection === "selected" ? "selected" : "all",
    }));
  }

  // List repositories within a specific installation. This is the *correct*
  // repo picker source for GitHub App flows — it returns only repos the user
  // explicitly granted the app access to.
  async listInstallationRepos(
    installationId: number,
    page = 1,
    perPage = 100,
  ): Promise<GitHubRepo[]> {
    const res = await this.api.rest(
      "GET",
      `/user/installations/${installationId}/repositories?per_page=${perPage}&page=${page}`,
      this.auth,
    );
    const raw = res.json as RawInstallationReposResponse;
    if (!Array.isArray(raw.repositories)) return [];
    return raw.repositories.map(toGitHubRepo);
  }
}

function toGitHubRepo(r: RawRepo): GitHubRepo {
  return {
    full_name: r.full_name,
    private: r.private,
    can_push: r.permissions?.push === true,
  };
}
