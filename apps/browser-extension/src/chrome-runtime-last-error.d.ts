declare namespace chrome.runtime {
  let lastError:
    | {
        message?: string;
      }
    | undefined;
}
