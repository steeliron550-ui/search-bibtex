import { readFile } from "node:fs/promises";
import path from "node:path";

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
  const result = await pdfParse(data, { max: pages });

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
