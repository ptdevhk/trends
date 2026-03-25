import { spawn } from "node:child_process";
import path from "node:path";

import { config } from "../config.js";

export type SummaryTelegramBridgeRequest = {
  content: string;
  botToken?: string;
  chatId?: string;
};

export type SummaryTelegramBridgeResult = {
  ok: boolean;
  accountsSent: number;
};

type SummaryTelegramBridgeDependencies = {
  runner?: (payload: SummaryTelegramBridgeRequest) => Promise<SummaryTelegramBridgeResult>;
};

export class SummaryTelegramBridge {
  private readonly projectRoot: string;
  private readonly runner?: (payload: SummaryTelegramBridgeRequest) => Promise<SummaryTelegramBridgeResult>;

  constructor(projectRoot = config.projectRoot, dependencies: SummaryTelegramBridgeDependencies = {}) {
    this.projectRoot = projectRoot;
    this.runner = dependencies.runner;
  }

  async send(payload: SummaryTelegramBridgeRequest): Promise<SummaryTelegramBridgeResult> {
    if (this.runner) {
      return await this.runner(payload);
    }

    const scriptPath = path.join(this.projectRoot, "scripts", "summaries", "send_telegram_summary.py");

    return await new Promise<SummaryTelegramBridgeResult>((resolve, reject) => {
      const child = spawn("uv", ["run", "python", scriptPath], {
        cwd: this.projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        reject(new Error(`Failed to start Telegram summary bridge: ${error.message}`));
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Telegram summary bridge failed with exit code ${code}`));
          return;
        }

        try {
          resolve(parseSummaryTelegramBridgeOutput(stdout));
        } catch (error) {
          reject(new Error(`Invalid Telegram summary bridge output: ${String(error)}`));
        }
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }
}

export function parseSummaryTelegramBridgeOutput(stdout: string): SummaryTelegramBridgeResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("empty stdout");
  }

  try {
    return JSON.parse(trimmed) as SummaryTelegramBridgeResult;
  } catch {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]!) as SummaryTelegramBridgeResult;
      } catch {
        continue;
      }
    }
    throw new Error("no JSON object found in stdout");
  }
}

export const summaryTelegramBridge = new SummaryTelegramBridge();
