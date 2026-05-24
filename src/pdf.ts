import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import pdfParse from "pdf-parse/lib/pdf-parse.js";

import type { PdfDocumentSnapshot } from "./types.js";

export interface PdfExtractionOptions {
  pages?: number;
}

export async function extractPdfDocumentSnapshot(
  filePath: string,
  options: PdfExtractionOptions = {}
): Promise<PdfDocumentSnapshot> {
  const resolvedPath = path.resolve(filePath);
  const data = await readFile(resolvedPath);
  const pages = options.pages ?? 2;
  const restoreLoader = installPdfParseLoaderPatch();
  const result = await pdfParse(data, { max: pages }).finally(restoreLoader);

  return {
    filePath: resolvedPath,
    pageCount: result.numpages,
    info: {
      title: optionalString(result.info?.Title),
      author: optionalString(result.info?.Author),
      subject: optionalString(result.info?.Subject),
      keywords: optionalString(result.info?.Keywords)
    },
    text: result.text,
    lines: result.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function installPdfParseLoaderPatch(): () => void {
  const require = createRequire(path.resolve(process.cwd(), ".search-bibtex-require.cjs"));
  const moduleLoader = require("module") as {
    _extensions: Record<string, (module: { _compile(source: string, filename: string): void }, filename: string) => void>;
  };
  const originalLoader = moduleLoader._extensions[".js"];

  moduleLoader._extensions[".js"] = function patchedLoader(
    module: { _compile(source: string, filename: string): void },
    filename: string
  ) {
    if (isPdfParseBundle(filename)) {
      const source = readFileSync(filename, "utf8")
        .replace(
          /result = new value\.constructor\(buffer, value\.byteOffset, value\.byteLength\);/g,
          "result = value.constructor.from ? value.constructor.from(buffer, value.byteOffset, value.byteLength) : new value.constructor(buffer, value.byteOffset, value.byteLength);"
        )
        .replace(
          /result = new value\.constructor\(value\);/g,
          "result = value.constructor.from ? value.constructor.from(value) : new value.constructor(value);"
        )
        .replace(/new Buffer\(literals\)/g, "Buffer.from(literals)");
      module._compile(source, filename);
      return;
    }

    originalLoader(module, filename);
  };

  return () => {
    moduleLoader._extensions[".js"] = originalLoader;
  };
}

function isPdfParseBundle(filename: string): boolean {
  return /(?:^|[\\/])pdf\.js[\\/][^\\/]+[\\/]build[\\/]pdf\.js$/.test(filename);
}
