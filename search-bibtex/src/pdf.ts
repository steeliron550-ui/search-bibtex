import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFParse } from "pdf-parse";

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
  const parser = new PDFParse({ data });

  try {
    const pages = options.pages ?? 2;
    const info = await parser.getInfo({ parsePageInfo: false });
    const textResult = await parser.getText({ first: pages });
    const text = textResult.text;

    return {
      filePath: resolvedPath,
      pageCount: info.total,
      info: {
        title: optionalString(info.info?.Title),
        author: optionalString(info.info?.Author),
        subject: optionalString(info.info?.Subject),
        keywords: optionalString(info.info?.Keywords)
      },
      text,
      lines: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    };
  } finally {
    await parser.destroy();
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
