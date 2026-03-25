import { describe, expect, it } from "vitest";

import { parseSummaryTelegramBridgeOutput } from "./summary-telegram-bridge";

describe("parseSummaryTelegramBridgeOutput", () => {
  it("parses clean JSON output", () => {
    const payload = {
      ok: true,
      channel: "telegram" as const,
      accountsConfigured: 1,
      accountsSelected: 1,
      accountsAttempted: 1,
      accountsSent: 1,
      batchCountPerAccount: 1,
      totalBatches: 1,
      batchSizes: [128],
      maxBytesPerBatch: 4000,
      usedOverrideBotToken: false,
      usedOverrideChatId: false,
      accounts: [
        {
          index: 1,
          chatIdHint: "***1234",
          attempted: true,
          sent: true,
          batchesPlanned: 1,
        },
      ],
    };
    expect(
      parseSummaryTelegramBridgeOutput(JSON.stringify(payload))
    ).toEqual(payload);
  });

  it("parses the last JSON line when stdout includes leading logs", () => {
    const payload = {
      ok: true,
      channel: "telegram" as const,
      accountsConfigured: 1,
      accountsSelected: 1,
      accountsAttempted: 1,
      accountsSent: 1,
      batchCountPerAccount: 2,
      totalBatches: 2,
      batchSizes: [3920, 410],
      maxBytesPerBatch: 4000,
      usedOverrideBotToken: true,
      usedOverrideChatId: true,
      accounts: [
        {
          index: 1,
          chatIdHint: "***5678",
          attempted: true,
          sent: true,
          batchesPlanned: 2,
        },
      ],
    };
    expect(
      parseSummaryTelegramBridgeOutput(
        [
          "配置文件加载成功: config/config.yaml",
          "通知渠道配置来源: Telegram(环境变量, 1个账号)",
          JSON.stringify(payload),
        ].join("\n")
      )
    ).toEqual(payload);
  });

  it("throws when stdout contains no JSON payload", () => {
    expect(() => parseSummaryTelegramBridgeOutput("only logs")).toThrow("no JSON object found in stdout");
  });
});
