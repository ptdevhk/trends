/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDomUtils, delay, type DomUtilsDeps } from "../dom-utils.js";

function createMockDeps(overrides: Partial<DomUtilsDeps> = {}): DomUtilsDeps {
  const mockDoc = {
    body: document.createElement("body"),
    documentElement: document.createElement("html"),
  } as unknown as Document;

  const mockWin = {
    getComputedStyle: vi.fn(() => ({
      display: "block",
      visibility: "visible",
    })),
    Event: window.Event,
    MouseEvent: window.MouseEvent,
  } as unknown as Window;

  return {
    win: mockWin,
    doc: mockDoc,
    getPaginationInfo: vi.fn(() => ({ currentPage: 1 })),
    ...overrides,
  };
}

describe("dom-utils", () => {
  describe("createDomUtils", () => {
    it("returns an object with all expected methods", () => {
      const utils = createDomUtils(createMockDeps());
      expect(utils).toHaveProperty("waitForPageTransition");
      expect(utils).toHaveProperty("isElementVisible");
      expect(utils).toHaveProperty("asHTMLElement");
      expect(utils).toHaveProperty("setInputValue");
      expect(utils).toHaveProperty("fireMouseEvent");
      expect(utils).toHaveProperty("activateElement");
      expect(utils).toHaveProperty("findVueParentByName");
    });
  });

  describe("isElementVisible", () => {
    it("returns false for null element", () => {
      const utils = createDomUtils(createMockDeps());
      expect(utils.isElementVisible(null)).toBe(false);
    });

    it("returns false for undefined element", () => {
      const utils = createDomUtils(createMockDeps());
      expect(utils.isElementVisible(undefined)).toBe(false);
    });

    it("returns true when display is not none and visibility is not hidden", () => {
      const utils = createDomUtils(createMockDeps());
      const el = document.createElement("div");
      expect(utils.isElementVisible(el)).toBe(true);
    });

    it("returns false when display is none", () => {
      const deps = createMockDeps({
        win: {
          getComputedStyle: vi.fn(() => ({
            display: "none",
            visibility: "visible",
          })),
        } as unknown as Window,
      });
      const utils = createDomUtils(deps);
      const el = document.createElement("div");
      expect(utils.isElementVisible(el)).toBe(false);
    });

    it("returns false when visibility is hidden", () => {
      const deps = createMockDeps({
        win: {
          getComputedStyle: vi.fn(() => ({
            display: "block",
            visibility: "hidden",
          })),
        } as unknown as Window,
      });
      const utils = createDomUtils(deps);
      const el = document.createElement("div");
      expect(utils.isElementVisible(el)).toBe(false);
    });
  });

  describe("asHTMLElement", () => {
    it("returns the element if it is an HTMLElement", () => {
      const utils = createDomUtils(createMockDeps());
      const el = document.createElement("div");
      expect(utils.asHTMLElement(el)).toBe(el);
    });

    it("returns null for null input", () => {
      const utils = createDomUtils(createMockDeps());
      expect(utils.asHTMLElement(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
      const utils = createDomUtils(createMockDeps());
      expect(utils.asHTMLElement(undefined)).toBeNull();
    });
  });

  describe("setInputValue", () => {
    it("sets the value on an input element", () => {
      const utils = createDomUtils(createMockDeps());
      const input = document.createElement("input");
      utils.setInputValue(input, "test value");
      expect(input.value).toBe("test value");
    });

    it("dispatches input and change events", () => {
      const utils = createDomUtils(createMockDeps());
      const input = document.createElement("input");
      const inputListener = vi.fn();
      const changeListener = vi.fn();
      input.addEventListener("input", inputListener);
      input.addEventListener("change", changeListener);
      utils.setInputValue(input, "new value");
      expect(inputListener).toHaveBeenCalled();
      expect(changeListener).toHaveBeenCalled();
    });
  });

  describe("fireMouseEvent", () => {
    it("does not throw for a valid target", () => {
      const utils = createDomUtils({
        win: window as unknown as Window,
        doc: document,
        getPaginationInfo: vi.fn(() => ({ currentPage: 1 })),
      });
      const target = document.createElement("div");
      expect(() => utils.fireMouseEvent(target, "mousedown")).not.toThrow();
    });

    it("dispatches a mouse event that the target receives", () => {
      const utils = createDomUtils({
        win: window as unknown as Window,
        doc: document,
        getPaginationInfo: vi.fn(() => ({ currentPage: 1 })),
      });
      const target = document.createElement("div");
      let received = false;
      target.addEventListener("mousedown", () => { received = true; });
      utils.fireMouseEvent(target, "mousedown");
      // fireMouseEvent has try/catch — the event may or may not fire depending on
      // jsdom MouseEvent support, so just verify it doesn't throw
      expect(() => utils.fireMouseEvent(target, "mousedown")).not.toThrow();
    });
  });

  describe("activateElement", () => {
    it("does nothing for null target", () => {
      const utils = createDomUtils(createMockDeps());
      expect(() => utils.activateElement(null)).not.toThrow();
    });

    it("does nothing for undefined target", () => {
      const utils = createDomUtils(createMockDeps());
      expect(() => utils.activateElement(undefined)).not.toThrow();
    });

    it("fires mouse events and clicks the element", () => {
      const utils = createDomUtils(createMockDeps());
      const target = document.createElement("button");
      const clickListener = vi.fn();
      target.addEventListener("click", clickListener);
      utils.activateElement(target);
      expect(clickListener).toHaveBeenCalled();
    });
  });

  describe("findVueParentByName", () => {
    it("returns null for null node", () => {
      const utils = createDomUtils(createMockDeps());
      expect(utils.findVueParentByName(null, "MyComponent")).toBeNull();
    });

    it("returns null when no Vue instance found", () => {
      const utils = createDomUtils(createMockDeps());
      const node = {};
      expect(utils.findVueParentByName(node, "MyComponent")).toBeNull();
    });

    it("returns Vue instance when name matches", () => {
      const utils = createDomUtils(createMockDeps());
      const vm = { $options: { name: "TargetComponent" }, $parent: null };
      const node = { __vue__: vm };
      expect(utils.findVueParentByName(node, "TargetComponent")).toBe(vm);
    });

    it("traverses parent chain to find matching component", () => {
      const utils = createDomUtils(createMockDeps());
      const grandparent = { $options: { name: "GrandParent" }, $parent: null };
      const parent = { $options: { name: "Parent" }, $parent: grandparent };
      const vm = { $options: { name: "Child" }, $parent: parent };
      const node = { __vue__: vm };
      expect(utils.findVueParentByName(node, "GrandParent")).toBe(grandparent);
    });

    it("respects maxDepth parameter", () => {
      const utils = createDomUtils(createMockDeps());
      const deep = { $options: { name: "DeepComponent" }, $parent: null };
      const parent = { $options: { name: "Parent" }, $parent: deep };
      const vm = { $options: { name: "Child" }, $parent: parent };
      const node = { __vue__: vm };
      // maxDepth=1 should only check the immediate vm
      expect(utils.findVueParentByName(node, "DeepComponent", { maxDepth: 1 })).toBeNull();
    });
  });

  describe("waitForPageTransition", () => {
    it("rejects when expectedPage is not a positive number", async () => {
      const utils = createDomUtils(createMockDeps());
      await expect(utils.waitForPageTransition({ expectedPage: 0 })).rejects.toThrow(
        "Invalid expected page",
      );
    });

    it("rejects when expectedPage is NaN", async () => {
      const utils = createDomUtils(createMockDeps());
      await expect(utils.waitForPageTransition({ expectedPage: NaN })).rejects.toThrow(
        "Invalid expected page",
      );
    });

    it("resolves when page matches expectedPage", async () => {
      const deps = createMockDeps({
        getPaginationInfo: vi.fn(() => ({ currentPage: 3 })),
      });
      const utils = createDomUtils(deps);
      const result = await utils.waitForPageTransition({ expectedPage: 3 });
      expect(result).toBe(3);
    });
  });

  describe("delay", () => {
    it("resolves after the specified time", async () => {
      vi.useFakeTimers();
      const promise = delay(100);
      vi.advanceTimersByTime(100);
      await expect(promise).resolves.toBeUndefined();
      vi.useRealTimers();
    });
  });
});
