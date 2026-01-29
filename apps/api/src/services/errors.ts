export class DataNotFoundError extends Error {
  suggestion?: string;

  constructor(message: string, options?: { suggestion?: string }) {
    super(message);
    this.name = "DataNotFoundError";
    this.suggestion = options?.suggestion;
  }
}

export class FileParseError extends Error {
  filepath: string;

  constructor(filepath: string, message: string) {
    super(message);
    this.name = "FileParseError";
    this.filepath = filepath;
  }
}

