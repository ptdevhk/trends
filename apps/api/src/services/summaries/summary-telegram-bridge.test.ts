import { describe, expect, it } from "vitest";

import { parseSummaryTelegramBridgeOutput } from "./summary-telegram-bridge";

describe("parseSummaryTelegramBridgeOutput", () => {
  it("parses clean JSON output", () => {
    expect(
      parseSummaryTelegramBridgeOutput('{"ok":true,"accountsSent":1}')
    ).toEqual({ ok: true, accountsSent: 1 });
  });

  it("parses the last JSON line when stdout includes leading logs", () => {
    expect(
      parseSummaryTelegramBridgeOutput(
        [
          "配置文件加载成功: config/config.yaml",
          "通知渠道配置来源: Telegram(环境变量, 1个账号)",
          '{"ok":true,"accountsSent":1}',
        ].join("\n")
      )
    ).toEqual({ ok: true, accountsSent: 1 });
  });

  it("throws when stdout contains no JSON payload", () => {
    expect(() => parseSummaryTelegramBridgeOutput("only logs")).toThrow("no JSON object found in stdout");
  });
});
