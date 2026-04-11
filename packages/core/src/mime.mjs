const MIME_BY_EXTENSION = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".part", "text/plain; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

export function getContentTypeForPath(filePath) {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) {
    return "application/octet-stream";
  }

  return MIME_BY_EXTENSION.get(filePath.slice(dotIndex).toLowerCase()) ?? "application/octet-stream";
}
