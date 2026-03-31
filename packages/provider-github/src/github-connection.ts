import { GitHubApi } from "./github-api";
import type { HttpClient } from "@pylon-sync/core";

export interface GitHubUser {
  login: string;
  avatar_url: string;
}

export interface GitHubRepo {
  full_name: string;
  private: boolean;
}

export class GitHubConnection {
  private api: GitHubApi;

  constructor(
    http: HttpClient,
    private token: string,
  ) {
    this.api = new GitHubApi(http);
  }

  async getUser(): Promise<GitHubUser> {
    const res = await this.api.rest("GET", "/user", this.token);
    return res.json as GitHubUser;
  }

  async listRepos(page = 1, perPage = 100): Promise<GitHubRepo[]> {
    const res = await this.api.rest(
      "GET",
      `/user/repos?sort=updated&per_page=${perPage}&page=${page}&type=all`,
      this.token,
    );
    return (res.json as GitHubRepo[]).map((r) => ({
      full_name: r.full_name,
      private: r.private,
    }));
  }

  async listBranches(repo: string): Promise<string[]> {
    const [owner, name] = repo.split("/");
    const res = await this.api.rest(
      "GET",
      `/repos/${owner}/${name}/branches?per_page=100`,
      this.token,
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
}
