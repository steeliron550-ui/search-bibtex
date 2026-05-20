/**
 * Custom HTTP-JSON search source adapter.
 *
 * Builds a {@link SearchSource} from a {@link CustomSourceConfig} by
 * translating user-provided URL templates and JSON-path field mappings into
 * the internal {@link BibliographicCandidate} format used by the ranking and
 * BibTeX resolution pipelines.
 *
 * @module custom-source
 */

import {
  fetchDoiBibtex,
  generateBibtex,
  normalizeBibtex,
  type BibtexRecord
} from "./bibtex.js";
import type { CustomSourceConfig, CustomSourceFieldMap } from "./config.js";
import { fetchJson, fetchText } from "./http.js";
import { normalizeWhitespace } from "./metadata.js";
import type { BibliographicCandidate } from "./ranking.js";
import type { SearchSource, SourceSearchContext } from "./source.js";

/**
 * Creates a {@link SearchSource} from a {@link CustomSourceConfig}.
 *
 * The returned source handles both searching (via an HTTP JSON API with
 * configurable URL templates and JSON-path field extraction) and BibTeX
 * retrieval (doi, url, or locally-generated strategies).
 */
export function createCustomSearchSource(config: CustomSourceConfig): SearchSource {
  return {
    name: config.name,
    search: async (context) => searchCustomHttpJsonSource(config, context),
    fetchBibtex: async (record, context) => {
      switch (config.bibtex.strategy) {
        case "doi":
          if (!record.doi) {
            throw new Error(`Custom source ${config.name} requires DOI for BibTeX strategy "doi".`);
          }
          return fetchDoiBibtex(record.doi, context.fetcher, { signal: context.signal });
        case "url": {
          const url = renderRecordTemplate(config.bibtex.urlTemplate, record, config.name);
          return normalizeBibtex(await fetchText(context.fetcher, url, config.bibtex.accept, { signal: context.signal }));
        }
        case "generate":
          return generateBibtex(record);
      }
    }
  };
}

async function searchCustomHttpJsonSource(
  config: CustomSourceConfig,
  context: SourceSearchContext
): Promise<BibliographicCandidate[]> {
  const url = renderSearchTemplate(config.search.url, context, config.name);
  const response = await fetchJson<unknown>(context.fetcher, url, { signal: context.signal });
  const items = readPath(response, config.response.itemsPath, `${config.name}.response.items_path`);

  if (!Array.isArray(items)) {
    throw new Error(`Custom source ${config.name} response path ${config.response.itemsPath} did not resolve to an array.`);
  }

  return items
    .map((item, index) => candidateFromItem(config, item, index))
    .filter((candidate): candidate is BibliographicCandidate => candidate !== undefined);
}

function candidateFromItem(config: CustomSourceConfig, item: unknown, index: number): BibliographicCandidate | undefined {
  if (!isRecord(item)) {
    throw new Error(`Custom source ${config.name} response item ${index} is not an object.`);
  }

  const fields = config.response.fields;
  const title = stringField(item, fields.title, config.name);
  if (!title) {
    return undefined;
  }

  return {
    source: config.name,
    sourceId: optionalStringField(item, fields.sourceId, config.name),
    title,
    authors: authorsField(item, fields, config.name),
    year: optionalYearField(item, fields.year, config.name),
    doi: optionalStringField(item, fields.doi, config.name),
    arxivId: optionalStringField(item, fields.arxivId, config.name),
    venue: optionalStringField(item, fields.venue, config.name),
    url: optionalStringField(item, fields.url, config.name)
  };
}

function authorsField(item: Record<string, unknown>, fields: CustomSourceFieldMap, sourceName: string): string[] {
  if (!fields.authors) {
    return [];
  }
  const value = readPath(item, fields.authors, `${sourceName}.response.fields.authors`);
  return scalarStrings(value).map(normalizeWhitespace).filter(Boolean);
}

function optionalYearField(item: Record<string, unknown>, path: string | undefined, sourceName: string): number | undefined {
  if (!path) {
    return undefined;
  }
  const value = readPath(item, path, `${sourceName}.response.fields.year`);
  const scalar = firstScalar(value);
  if (typeof scalar === "number" && Number.isFinite(scalar)) {
    return Math.trunc(scalar);
  }
  if (typeof scalar === "string") {
    const parsed = Number.parseInt(scalar, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalStringField(item: Record<string, unknown>, path: string | undefined, sourceName: string): string | undefined {
  if (!path) {
    return undefined;
  }
  return stringField(item, path, sourceName);
}

function stringField(item: Record<string, unknown>, path: string, sourceName: string): string | undefined {
  const value = readPath(item, path, `${sourceName}.response.fields.${path}`);
  const scalar = firstScalar(value);
  if (typeof scalar === "string") {
    const normalized = normalizeWhitespace(scalar);
    return normalized || undefined;
  }
  if (typeof scalar === "number" && Number.isFinite(scalar)) {
    return String(scalar);
  }
  return undefined;
}

function renderSearchTemplate(template: string, context: SourceSearchContext, sourceName: string): string {
  return renderTemplate(template, (name) => {
    switch (name) {
      case "title":
        return requiredTemplateValue(context.metadata.title, sourceName, name);
      case "doi":
        return requiredTemplateValue(context.metadata.doi, sourceName, name);
      case "arxiv":
        return requiredTemplateValue(context.metadata.arxivId, sourceName, name);
      case "year":
        return requiredTemplateValue(context.metadata.year?.toString(), sourceName, name);
      case "limit":
        return String(context.limit);
      case "query":
        return requiredTemplateValue(context.queries[0]?.value, sourceName, name);
      default:
        throw new Error(`Custom source ${sourceName} uses unknown template variable: ${name}.`);
    }
  });
}

function renderRecordTemplate(template: string, record: BibtexRecord, sourceName: string): string {
  return renderTemplate(template, (name) => {
    switch (name) {
      case "sourceId":
        return requiredTemplateValue(record.sourceId, sourceName, name);
      case "title":
        return requiredTemplateValue(record.title, sourceName, name);
      case "doi":
        return requiredTemplateValue(record.doi, sourceName, name);
      case "arxiv":
        return requiredTemplateValue(record.arxivId, sourceName, name);
      case "year":
        return requiredTemplateValue(record.year?.toString(), sourceName, name);
      case "venue":
        return requiredTemplateValue(record.venue, sourceName, name);
      case "url":
        return requiredTemplateValue(record.url, sourceName, name);
      default:
        throw new Error(`Custom source ${sourceName} uses unknown BibTeX template variable: ${name}.`);
    }
  });
}

function renderTemplate(template: string, valueForName: (name: string) => string): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    return encodeURIComponent(valueForName(name));
  });
}

function requiredTemplateValue(value: string | undefined, sourceName: string, variableName: string): string {
  if (!value) {
    throw new Error(`Custom source ${sourceName} cannot render template variable ${variableName}.`);
  }
  return value;
}

function readPath(value: unknown, path: string, fieldPath: string): unknown {
  const segments = path === "." || path === "$"
    ? []
    : path.split(".");

  if (segments.some((segment) => segment.trim() === "")) {
    throw new Error(`Invalid custom source path ${fieldPath}: ${path}.`);
  }

  let values = [value];
  for (const segment of segments) {
    values = values.flatMap((current) => valuesAtSegment(current, segment));
  }

  if (values.length === 0) {
    return undefined;
  }
  return values.length === 1 ? values[0] : values;
}

function valuesAtSegment(value: unknown, segment: string): unknown[] {
  if (Array.isArray(value)) {
    const index = parseArrayIndex(segment);
    if (index !== undefined) {
      return value[index] === undefined ? [] : [value[index]];
    }
    return value.flatMap((item) => valuesAtSegment(item, segment));
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.hasOwn(value, segment) ? [value[segment]] : [];
}

function parseArrayIndex(value: string): number | undefined {
  if (!/^[0-9]+$/.test(value)) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

function scalarStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(scalarStrings);
  }
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [String(value)];
  }
  return [];
}

function firstScalar(value: unknown): string | number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const scalar = firstScalar(item);
      if (scalar !== undefined) {
        return scalar;
      }
    }
    return undefined;
  }
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
    return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
