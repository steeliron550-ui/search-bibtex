import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatSelectedResult,
  searchBibtexFromPdf,
  selectedResultByIndex
} from "../src/index.js";
import type { PaperSource } from "../src/index.js";

interface SampleExpectation {
  fileName: string;
  expectedTitleFragment: string;
}

interface SampleReport {
  fileName: string;
  selectedSource: PaperSource;
  selectedTitle: string;
  selectedScore: number;
  bibtexFirstLine: string;
}

const samples: SampleExpectation[] = [
  {
    fileName: "2023.acl-long.754.pdf",
    expectedTitleFragment: "Self-Instruct"
  },
  {
    fileName: "3676642.3736114.pdf",
    expectedTitleFragment: "Neuralink"
  },
  {
    fileName: "Ascend_a_Scalable_and_Unified_Architecture_for_Ubiquitous_Deep_Neural_Network_Computing__Industry_Track_Paper.pdf",
    expectedTitleFragment: "Ascend"
  }
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const pdfDir = path.join(projectDir, "pdfs");
const sourcePriority: PaperSource[] = ["dblp", "crossref", "openalex", "doi"];

async function main(): Promise<void> {
  const reports: SampleReport[] = [];

  for (const sample of samples) {
    const pdfPath = path.join(pdfDir, sample.fileName);
    const response = await searchBibtexFromPdf(pdfPath, {
      pages: 2,
      preferences: {
        limit: 3,
        sourcePriority
      }
    });

    if (response.sourceErrors.length > 0) {
      throw new Error(`${sample.fileName} source errors: ${JSON.stringify(response.sourceErrors)}`);
    }

    if (response.results.length === 0) {
      throw new Error(`${sample.fileName} returned no BibTeX candidates.`);
    }

    const selected = selectedResultByIndex(response.results, 0);
    if (!selected.title.toLowerCase().includes(sample.expectedTitleFragment.toLowerCase())) {
      throw new Error(`${sample.fileName} selected unexpected title: ${selected.title}`);
    }

    const bibtex = formatSelectedResult(selected, "bibtex").trim();
    if (!bibtex.startsWith("@")) {
      throw new Error(`${sample.fileName} selected result does not contain a BibTeX entry.`);
    }

    reports.push({
      fileName: sample.fileName,
      selectedSource: selected.source,
      selectedTitle: selected.title,
      selectedScore: Number(selected.score.toFixed(3)),
      bibtexFirstLine: bibtex.split(/\r?\n/, 1)[0] ?? ""
    });
  }

  process.stdout.write(`${JSON.stringify({ samples: reports }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
