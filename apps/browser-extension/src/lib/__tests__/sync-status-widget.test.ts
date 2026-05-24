// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSyncStatusWidget } from "../sync-status-widget";

function createMockDeps() {
  return {
    win: window,
    doc: document,
    chrome: { runtime: { sendMessage: vi.fn(() => Promise.resolve()) } },
    onCancel: vi.fn(),
  };
}

describe("sync-status-widget", () => {
  let widget: ReturnType<typeof createSyncStatusWidget>;

  beforeEach(() => {
    widget = createSyncStatusWidget(createMockDeps());
    vi.useFakeTimers();
  });

  afterEach(() => {
    widget.hide();
    vi.useRealTimers();
    document.getElementById("tr-sync-status-widget")?.remove();
  });

  describe("show", () => {
    it("creates widget element in DOM", () => {
      widget.show({ state: "progress", message: "Syncing..." });
      const el = document.getElementById("tr-sync-status-widget");
      expect(el).not.toBeNull();
      expect(el!.className).toContain("tr-sync-widget--progress");
    });

    it("renders success state", () => {
      widget.show({ state: "success", message: "Done!" });
      const el = document.getElementById("tr-sync-status-widget");
      expect(el!.className).toContain("tr-sync-widget--success");
    });

    it("renders error state", () => {
      widget.show({ state: "error", message: "Failed!" });
      const el = document.getElementById("tr-sync-status-widget");
      expect(el!.className).toContain("tr-sync-widget--error");
    });

    it("defaults to progress for unknown state", () => {
      widget.show({ state: "unknown" as "progress", message: "..." });
      const el = document.getElementById("tr-sync-status-widget");
      expect(el!.className).toContain("tr-sync-widget--progress");
    });

    it("escapes HTML in message", () => {
      widget.show({ state: "progress", message: "<script>alert('xss')</script>" });
      const el = document.getElementById("tr-sync-status-widget");
      expect(el!.innerHTML).not.toContain("<script>");
      expect(el!.innerHTML).toContain("&lt;script&gt;");
    });

    it("escapes HTML in hint", () => {
      widget.show({
        state: "progress",
        message: "test",
        hint: "<img src=x onerror=alert(1)>",
      });
      const el = document.getElementById("tr-sync-status-widget");
      expect(el!.innerHTML).not.toContain("<img");
      expect(el!.innerHTML).toContain("&lt;img");
    });

    it("shows cancel button for progress state", () => {
      widget.show({ state: "progress", message: "Syncing..." });
      const el = document.getElementById("tr-sync-status-widget");
      const cancelBtn = el!.querySelector(".tr-sync-widget__cancel");
      expect(cancelBtn).not.toBeNull();
    });

    it("shows close button for error state", () => {
      widget.show({ state: "error", message: "Error!" });
      const el = document.getElementById("tr-sync-status-widget");
      const closeBtn = el!.querySelector(".tr-sync-widget__close");
      expect(closeBtn).not.toBeNull();
    });

    it("does not show cancel button for success state", () => {
      widget.show({ state: "success", message: "Done!" });
      const el = document.getElementById("tr-sync-status-widget");
      const cancelBtn = el!.querySelector(".tr-sync-widget__cancel");
      expect(cancelBtn).toBeNull();
    });

    it("auto-dismisses after specified milliseconds", () => {
      widget.show({
        state: "success",
        message: "Done!",
        autoDismiss: 3000 as unknown as boolean,
      });
      expect(document.getElementById("tr-sync-status-widget")).not.toBeNull();

      vi.advanceTimersByTime(3000);
      // After dismiss timer, hide() is called which adds hidden class and schedules removal
      const el = document.getElementById("tr-sync-status-widget");
      expect(el?.classList.contains("tr-sync-widget--hidden")).toBe(true);
    });

    it("auto-dismisses with DEFAULT_AUTO_DISMISS_MS when autoDismiss is true", () => {
      widget.show({
        state: "success",
        message: "Done!",
        autoDismiss: true,
      });
      expect(document.getElementById("tr-sync-status-widget")).not.toBeNull();

      vi.advanceTimersByTime(5000);
      const el = document.getElementById("tr-sync-status-widget");
      expect(el?.classList.contains("tr-sync-widget--hidden")).toBe(true);
    });

    it("does not auto-dismiss when autoDismiss is false", () => {
      widget.show({
        state: "progress",
        message: "Syncing...",
        autoDismiss: false,
      });
      vi.advanceTimersByTime(10000);
      const el = document.getElementById("tr-sync-status-widget");
      expect(el?.classList.contains("tr-sync-widget--hidden")).toBe(false);
    });

    it("reuses existing widget on subsequent show calls", () => {
      widget.show({ state: "progress", message: "First" });
      const el1 = document.getElementById("tr-sync-status-widget");
      widget.show({ state: "success", message: "Second" });
      const el2 = document.getElementById("tr-sync-status-widget");
      expect(el1).toBe(el2);
    });
  });

  describe("hide", () => {
    it("adds hidden class", () => {
      widget.show({ state: "progress", message: "Syncing..." });
      widget.hide();
      const el = document.getElementById("tr-sync-status-widget");
      expect(el?.classList.contains("tr-sync-widget--hidden")).toBe(true);
    });

    it("does nothing if widget not shown", () => {
      expect(() => widget.hide()).not.toThrow();
    });

    it("removes element after HIDE_DELAY_MS", () => {
      widget.show({ state: "progress", message: "Syncing..." });
      widget.hide();
      expect(document.getElementById("tr-sync-status-widget")).not.toBeNull();

      vi.advanceTimersByTime(220);
      expect(document.getElementById("tr-sync-status-widget")).toBeNull();
    });
  });

  describe("cancel button", () => {
    it("calls onCancel when clicked", () => {
      const onCancel = vi.fn();
      const w = createSyncStatusWidget({
        win: window,
        doc: document,
        chrome: { runtime: { sendMessage: vi.fn() } },
        onCancel,
      });
      w.show({ state: "progress", message: "Syncing..." });
      const cancelBtn = document.querySelector(
        ".tr-sync-widget__cancel",
      ) as HTMLElement;
      cancelBtn.click();
      expect(onCancel).toHaveBeenCalled();
    });
  });
});
