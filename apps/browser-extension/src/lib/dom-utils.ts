/**
 * DOM utility functions for browser extension content scripts.
 * All dependencies injected from content.ts via DI factory.
 */

export interface DomUtilsDeps {
  win: Window;
  doc: Document;
  getPaginationInfo: () => { currentPage: number };
}

export function createDomUtils(deps: DomUtilsDeps) {
  const { win, doc, getPaginationInfo } = deps;

  function waitForPageTransition(options: { expectedPage?: number; timeoutMs?: number } = {}): Promise<number> {
    const { expectedPage, timeoutMs = 15000 } = options;
    return new Promise((resolve, reject) => {
      if (!Number.isFinite(expectedPage) || expectedPage < 1) {
        reject(new Error("Invalid expected page"));
        return;
      }

      let done = false;
      const deadline = Date.now() + timeoutMs;

      const check = () => {
        if (done) return;
        const pagination = getPaginationInfo();
        if (pagination.currentPage === expectedPage) {
          done = true;
          cleanup();
          resolve(pagination.currentPage);
        } else if (Date.now() > deadline) {
          done = true;
          cleanup();
          reject(new Error(`Timed out waiting for page ${expectedPage}`));
        }
      };

      const cleanup = () => {
        clearInterval(intervalId);
        observer.disconnect();
      };

      const intervalId = setInterval(check, 300);
      const observer = new MutationObserver(check);
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      check();
    });
  }

  function isElementVisible(element: Element | null | undefined): boolean {
    if (!element) return false;
    const style = win.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function asHTMLElement(element: Element | null | undefined): HTMLElement | null {
    return element instanceof HTMLElement ? element : null;
  }

  function setInputValue(input: HTMLInputElement, value: string): void {
    const inputWindow =
      (input?.ownerDocument?.defaultView as any) || win;
    const inputCtor =
      inputWindow.HTMLInputElement ||
      (globalThis as any).HTMLInputElement;
    const descriptor = inputCtor
      ? Object.getOwnPropertyDescriptor(inputCtor.prototype, "value")
      : null;
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new inputWindow.Event("input", { bubbles: true }));
    input.dispatchEvent(new inputWindow.Event("change", { bubbles: true }));
  }

  function fireMouseEvent(target: EventTarget, type: string): void {
    try {
      const targetWindow =
        (target as any)?.ownerDocument?.defaultView || win;
      target.dispatchEvent(
        new targetWindow.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: targetWindow,
        }),
      );
    } catch {
      // ignore
    }
  }

  function activateElement(target: Element | null | undefined): void {
    if (!target) {
      return;
    }
    ["mouseenter", "mouseover", "mousedown", "mouseup"].forEach((type) =>
      fireMouseEvent(target, type),
    );
    (target as HTMLElement).click?.();
  }

  function findVueParentByName(
    node: any,
    componentName: string,
    { maxDepth = 8 }: { maxDepth?: number } = {},
  ): any {
    let vm = node?.__vue__ || null;
    for (let depth = 0; vm && depth < maxDepth; depth += 1) {
      if (vm?.$options?.name === componentName) {
        return vm;
      }
      vm = vm?.$parent || null;
    }
    return null;
  }

  return {
    waitForPageTransition,
    isElementVisible,
    asHTMLElement,
    setInputValue,
    fireMouseEvent,
    activateElement,
    findVueParentByName,
  };
}

/**
 * Simple delay utility for async timing.
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
