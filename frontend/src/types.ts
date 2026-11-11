export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface KeyValueItem {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: Record<string, string>;
}

export interface RequestItem {
  id: string;
  name: string;
  collection: string;
  method: HttpMethod;
  url: string;
  headers: KeyValueItem[];
  queryParams: KeyValueItem[];
  body: {
    type: 'none' | 'json' | 'xml' | 'raw' | 'x-www-form-urlencoded' | 'graphql';
    raw: string;
    jsonBody?: string;
    xmlBody?: string;
    rawBody?: string;
    formBody?: string;
    graphqlQuery?: string;
    graphqlVariables?: string;
  };
  preRequestScript?: string;
  postResponseScript?: string;
  lastModifiedAt?: number;
}

export interface CollectionItem {
  id: string;
  name: string;
  path?: string;
  requests: RequestItem[];
  folders?: CollectionItem[];
}

export interface LiveStats {
  elapsedTimeSec: number;
  currentRps: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  statusCounts: Record<number, number>;
  isRunning: boolean;
}

export interface CookieItem {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}
