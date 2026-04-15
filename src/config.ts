/**
 * Configuration module for search-bibtex.
 *
 * Handles loading, parsing, and resolving of TOML configuration files
 * that control paper source searching behavior, including:
 * - Source priority ordering
 * - Search weights for relevance scoring
 * - Search parallelization and timeout settings
 * - Custom HTTP-JSON paper source definitions
 *
 * @module config
 */

import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import { parse as parseToml, type TomlTable } from "smol-toml";

import { builtinPaperSources, type PaperSource, type SearchPreferences, type SortWeights } from "./types.js";

/** Default search preferences used when no configuration file is provided. */
export const defaultSearchPreferences: SearchPreferences = {
  sourcePriority: [...builtinPaperSources],
  weights: {
    title: 0.45,
    author: 0.2,
    year: 0.1,
    identifier: 0.2,
    source: 0.05
  },
  limit: 10
};

/** Default value for parallel search execution. When `true`, paper sources are queried concurrently. */
export const defaultSearchParallel = true;
/** Default per-source request timeout in seconds. */
export const defaultSearchTimeoutSeconds = 30;
/** Default per-source request timeout in milliseconds (derived from {@link defaultSearchTimeoutSeconds}). */
export const defaultSearchTimeoutMs = defaultSearchTimeoutSeconds * 1000;

/**
 * User-facing search configuration section within the TOML config file.
 * All fields are optional; missing values fall back to defaults.
 */
export interface SearchConfigInput {
  sourcePriority?: PaperSource[];
  weights?: Partial<SortWeights>;
  limit?: number;
  parallel?: boolean;
  timeoutSeconds?: number;
}

/** Top-level shape of the TOML configuration file. */
export interface AppConfig {
  search?: SearchConfigInput;
  sources?: CustomSourceConfig[];
}

export interface ResolvedSearchConfig extends SearchPreferences {
  parallel: boolean;
  timeoutSeconds: number;
  timeoutMs: number;
}

export interface ResolvedAppConfig {
  configPath: string;
  configLoaded: boolean;
  search: ResolvedSearchConfig;
  sources: CustomSourceConfig[];
}

export interface LoadedAppConfig {
  configPath: string;
  configLoaded: boolean;
  config: AppConfig;
}

export interface LoadConfigOptions {
  configPath?: string;
  cwd?: string;
}

export interface ResolveAppConfigOptions {
  configPath?: string;
  configLoaded?: boolean;
}

export interface CustomSourceConfig {
  name: PaperSource;
  kind: "http-json";
  enabled: boolean;
  search: CustomSourceSearchConfig;
  response: CustomSourceResponseConfig;
  bibtex: CustomSourceBibtexConfig;
}

export interface CustomSourceSearchConfig {
  url: string;
}

export interface CustomSourceResponseConfig {
  itemsPath: string;
  fields: CustomSourceFieldMap;
}

export interface CustomSourceFieldMap {
  sourceId?: string;
  title: string;
  authors?: string;
  year?: string;
  doi?: string;
  arxivId?: string;
  venue?: string;
  url?: string;
}

export type CustomSourceBibtexConfig =
  | { strategy: "doi" }
  | { strategy: "url"; urlTemplate: string; accept: string }
  | { strategy: "generate" };

export class ConfigError extends Error {
  readonly configPath?: string;

  constructor(message: string, configPath?: string) {
    super(configPath ? `${configPath}: ${message}` : message);
    this.name = "ConfigError";
    this.configPath = configPath;
  }
}

export const defaultConfigToml = `[search]
limit = 10
timeout_seconds = 30
parallel = true
source_priority = ["dblp", "arxiv", "crossref", "openalex", "doi", "semantic-scholar"]

[search.weights]
title = 0.45
author = 0.20
year = 0.10
identifier = 0.20
source = 0.05
`;

export function resolveConfigPath(configPath?: string, cwd = process.cwd()): string {
  if (configPath) {
    return nodePath.resolve(cwd, expandHome(configPath));
  }
  return nodePath.join(os.homedir(), ".config", "search-bibtex", "config.toml");
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedAppConfig> {
  const configPath = resolveConfigPath(options.configPath, options.cwd);
  const explicitPath = options.configPath !== undefined;

  try {
    await access(configPath, fsConstants.R_OK);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT" && !explicitPath) {
      return {
        configPath,
        configLoaded: false,
        config: {}
      };
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ConfigError("config file does not exist", configPath);
    }
    throw new ConfigError("config file is not readable", configPath);
  }

  const text = await readFile(configPath, "utf8");
  return {
    configPath,
    configLoaded: true,
    config: parseConfigToml(text, configPath)
  };
}

export async function loadResolvedAppConfig(options: LoadConfigOptions = {}): Promise<ResolvedAppConfig> {
  const loaded = await loadConfig(options);
  return resolveAppConfig(loaded.config, {
    configPath: loaded.configPath,
    configLoaded: loaded.configLoaded
  });
}

export function resolveAppConfig(config: AppConfig = {}, options: ResolveAppConfigOptions = {}): ResolvedAppConfig {
  const sources = config.sources?.filter((source) => source.enabled) ?? [];
  const availableSources = new Set<PaperSource>([
    ...builtinPaperSources,
    ...sources.map((source) => source.name)
  ]);
  const sourcePriority = config.search?.sourcePriority ?? defaultSearchPreferences.sourcePriority;
  validateSourcePriority(sourcePriority, availableSources, options.configPath);

  const timeoutSeconds = config.search?.timeoutSeconds ?? defaultSearchTimeoutSeconds;
  return {
    configPath: options.configPath ?? resolveConfigPath(),
    configLoaded: options.configLoaded ?? false,
    search: {
      sourcePriority,
      limit: config.search?.limit ?? defaultSearchPreferences.limit,
      weights: {
        ...defaultSearchPreferences.weights,
        ...config.search?.weights
      },
      parallel: config.search?.parallel ?? defaultSearchParallel,
      timeoutSeconds,
      timeoutMs: timeoutSeconds * 1000
    },
    sources
  };
}

export function parseConfigToml(text: string, configPath?: string): AppConfig {
  let document: TomlTable;
  try {
    document = parseToml(text);
  } catch (error) {
    throw new ConfigError(`invalid TOML: ${error instanceof Error ? error.message : String(error)}`, configPath);
  }

  const root = requireRecord(document, "config", configPath);
  assertKnownKeys(root, ["search", "sources"], "config", configPath);

  return {
    search: parseSearchConfig(optionalRecord(root.search, "search", configPath), configPath),
    sources: parseSources(root.sources, configPath)
  };
}

export function validateSourcePriority(
  sourcePriority: PaperSource[],
  availableSources: ReadonlySet<PaperSource>,
  configPath?: string
): void {
  const unknown = sourcePriority.filter((source) => !availableSources.has(source));
  if (unknown.length > 0) {
    throw new ConfigError(`search.source_priority references unknown source(s): ${unknown.join(", ")}`, configPath);
  }
}

function parseSearchConfig(rawSearch: Record<string, unknown> | undefined, configPath?: string): SearchConfigInput | undefined {
  if (!rawSearch) {
    return undefined;
  }
  assertKnownKeys(rawSearch, ["limit", "timeout_seconds", "parallel", "source_priority", "weights"], "search", configPath);

  return {
    limit: optionalPositiveInteger(rawSearch.limit, "search.limit", configPath),
    timeoutSeconds: optionalPositiveInteger(rawSearch.timeout_seconds, "search.timeout_seconds", configPath),
    parallel: optionalBoolean(rawSearch.parallel, "search.parallel", configPath),
    sourcePriority: optionalStringArray(rawSearch.source_priority, "search.source_priority", configPath),
    weights: parseWeightsConfig(optionalRecord(rawSearch.weights, "search.weights", configPath), configPath)
  };
}

function parseWeightsConfig(rawWeights: Record<string, unknown> | undefined, configPath?: string): Partial<SortWeights> | undefined {
  if (!rawWeights) {
    return undefined;
  }
  assertKnownKeys(rawWeights, ["title", "author", "year", "identifier", "source"], "search.weights", configPath);

  const weights: Partial<SortWeights> = {};
  for (const key of Object.keys(rawWeights) as Array<keyof SortWeights>) {
    weights[key] = nonNegativeNumber(rawWeights[key], `search.weights.${key}`, configPath);
  }
  return weights;
}

function parseSources(rawSources: unknown, configPath?: string): CustomSourceConfig[] | undefined {
  if (rawSources === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawSources)) {
    throw configFieldError("sources", "expected an array of tables", configPath);
  }

  const names = new Set<string>();
  return rawSources.map((rawSource, index) => {
    const source = parseCustomSource(requireRecord(rawSource, `sources[${index}]`, configPath), index, configPath);
    if (names.has(source.name)) {
      throw configFieldError(`sources[${index}].name`, `duplicate source name: ${source.name}`, configPath);
    }
    names.add(source.name);
    if ((builtinPaperSources as readonly string[]).includes(source.name)) {
      throw configFieldError(`sources[${index}].name`, `custom source cannot reuse built-in source name: ${source.name}`, configPath);
    }
    return source;
  });
}

function parseCustomSource(rawSource: Record<string, unknown>, index: number, configPath?: string): CustomSourceConfig {
  const sourcePath = `sources[${index}]`;
  assertKnownKeys(rawSource, ["name", "kind", "enabled", "search", "response", "bibtex"], sourcePath, configPath);

  const name = requiredString(rawSource.name, `${sourcePath}.name`, configPath);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw configFieldError(`${sourcePath}.name`, "expected letters, numbers, dots, underscores, or dashes", configPath);
  }

  const kind = requiredString(rawSource.kind, `${sourcePath}.kind`, configPath);
  if (kind !== "http-json") {
    throw configFieldError(`${sourcePath}.kind`, "expected \"http-json\"", configPath);
  }

  return {
    name,
    kind,
    enabled: optionalBoolean(rawSource.enabled, `${sourcePath}.enabled`, configPath) ?? true,
    search: parseCustomSourceSearch(requiredRecord(rawSource.search, `${sourcePath}.search`, configPath), sourcePath, configPath),
    response: parseCustomSourceResponse(requiredRecord(rawSource.response, `${sourcePath}.response`, configPath), sourcePath, configPath),
    bibtex: parseCustomSourceBibtex(requiredRecord(rawSource.bibtex, `${sourcePath}.bibtex`, configPath), sourcePath, configPath)
  };
}

function parseCustomSourceSearch(rawSearch: Record<string, unknown>, sourcePath: string, configPath?: string): CustomSourceSearchConfig {
  assertKnownKeys(rawSearch, ["url"], `${sourcePath}.search`, configPath);
  return {
    url: requiredString(rawSearch.url, `${sourcePath}.search.url`, configPath)
  };
}

function parseCustomSourceResponse(rawResponse: Record<string, unknown>, sourcePath: string, configPath?: string): CustomSourceResponseConfig {
  assertKnownKeys(rawResponse, ["items_path", "fields"], `${sourcePath}.response`, configPath);
  const rawFields = requiredRecord(rawResponse.fields, `${sourcePath}.response.fields`, configPath);
  assertKnownKeys(rawFields, ["source_id", "title", "authors", "year", "doi", "arxiv_id", "venue", "url"], `${sourcePath}.response.fields`, configPath);

  return {
    itemsPath: requiredString(rawResponse.items_path, `${sourcePath}.response.items_path`, configPath),
    fields: {
      sourceId: optionalString(rawFields.source_id, `${sourcePath}.response.fields.source_id`, configPath),
      title: requiredString(rawFields.title, `${sourcePath}.response.fields.title`, configPath),
      authors: optionalString(rawFields.authors, `${sourcePath}.response.fields.authors`, configPath),
      year: optionalString(rawFields.year, `${sourcePath}.response.fields.year`, configPath),
      doi: optionalString(rawFields.doi, `${sourcePath}.response.fields.doi`, configPath),
      arxivId: optionalString(rawFields.arxiv_id, `${sourcePath}.response.fields.arxiv_id`, configPath),
      venue: optionalString(rawFields.venue, `${sourcePath}.response.fields.venue`, configPath),
      url: optionalString(rawFields.url, `${sourcePath}.response.fields.url`, configPath)
    }
  };
}

function parseCustomSourceBibtex(rawBibtex: Record<string, unknown>, sourcePath: string, configPath?: string): CustomSourceBibtexConfig {
  assertKnownKeys(rawBibtex, ["strategy", "url_template", "accept"], `${sourcePath}.bibtex`, configPath);
  const strategy = requiredString(rawBibtex.strategy, `${sourcePath}.bibtex.strategy`, configPath);

  if (strategy === "doi") {
    rejectBibtexUrlFields(rawBibtex, sourcePath, strategy, configPath);
    return { strategy };
  }
  if (strategy === "generate") {
    rejectBibtexUrlFields(rawBibtex, sourcePath, strategy, configPath);
    return { strategy };
  }
  if (strategy === "url") {
    return {
      strategy,
      urlTemplate: requiredString(rawBibtex.url_template, `${sourcePath}.bibtex.url_template`, configPath),
      accept: optionalString(rawBibtex.accept, `${sourcePath}.bibtex.accept`, configPath) ?? "application/x-bibtex"
    };
  }

  throw configFieldError(`${sourcePath}.bibtex.strategy`, "expected \"doi\", \"url\", or \"generate\"", configPath);
}

function rejectBibtexUrlFields(rawBibtex: Record<string, unknown>, sourcePath: string, strategy: string, configPath?: string): void {
  if (rawBibtex.url_template !== undefined || rawBibtex.accept !== undefined) {
    throw configFieldError(`${sourcePath}.bibtex`, `url_template and accept are only valid when strategy is "url", got "${strategy}"`, configPath);
  }
}

function optionalString(value: unknown, fieldPath: string, configPath?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, fieldPath, configPath);
}

function requiredString(value: unknown, fieldPath: string, configPath?: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw configFieldError(fieldPath, "expected a non-empty string", configPath);
  }
  return value.trim();
}

function optionalBoolean(value: unknown, fieldPath: string, configPath?: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw configFieldError(fieldPath, "expected a boolean", configPath);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, fieldPath: string, configPath?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw configFieldError(fieldPath, "expected a positive integer", configPath);
  }
  return value;
}

function nonNegativeNumber(value: unknown, fieldPath: string, configPath?: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw configFieldError(fieldPath, "expected a non-negative number", configPath);
  }
  return value;
}

function optionalStringArray(value: unknown, fieldPath: string, configPath?: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw configFieldError(fieldPath, "expected an array of non-empty strings", configPath);
  }
  return value.map((item) => item.trim());
}

function optionalRecord(value: unknown, fieldPath: string, configPath?: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredRecord(value, fieldPath, configPath);
}

function requiredRecord(value: unknown, fieldPath: string, configPath?: string): Record<string, unknown> {
  const record = requireRecord(value, fieldPath, configPath);
  return record;
}

function requireRecord(value: unknown, fieldPath: string, configPath?: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw configFieldError(fieldPath, "expected a table", configPath);
  }
  return value;
}

function assertKnownKeys(value: Record<string, unknown>, keys: string[], fieldPath: string, configPath?: string): void {
  const known = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw configFieldError(fieldPath, `unknown key(s): ${unknown.join(", ")}`, configPath);
  }
}

function configFieldError(fieldPath: string, message: string, configPath?: string): ConfigError {
  return new ConfigError(`${fieldPath}: ${message}`, configPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return nodePath.join(os.homedir(), value.slice(2));
  }
  return value;
}
