export class S3teError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "S3teError";
    this.code = code;
    this.details = details;
  }
}

export function assert(condition, code, message, details = undefined) {
  if (!condition) {
    throw new S3teError(code, message, details);
  }
}
