import type { PaperSource, SearchSourceError } from "./types.js";

export type FetchLike = typeof fetch;

export interface FetchRequestOptions {
  signal?: AbortSignal;
}

const USER_AGENT = "search-bibtex/0.1 (mailto:codex@local)";

export class HttpRequestError extends Error {
  readonly status?: number;
  readonly url: string;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = "HttpRequestError";
    this.url = url;
    this.status = status;
  }
}

export async function fetchJson<T>(fetcher: FetchLike, url: string, options: FetchRequestOptions = {}): Promise<T> {
  const response = await fetcher(url, {
    signal: options.signal,
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new HttpRequestError(`HTTP ${response.status} from ${url}`, url, response.status);
  }

  return (await response.json()) as T;
}

export async function fetchText(
  fetcher: FetchLike,
  url: string,
  accept: string,
  options: FetchRequestOptions = {}
): Promise<string> {
  const response = await fetcher(url, {
    signal: options.signal,
    headers: {
      Accept: accept,
      "User-Agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new HttpRequestError(`HTTP ${response.status} from ${url}`, url, response.status);
  }

  return response.text();
}

export function toSourceError(source: PaperSource, query: string, error: unknown): SearchSourceError {
  if (error instanceof HttpRequestError) {
    return {
      source,
      query,
      message: error.message,
      status: error.status
    };
  }

  return {
    source,
    query,
    message: error instanceof Error ? error.message : String(error)
  };
}
