import { Environment, RequestItem } from '../types';
import { encodeQueryPartPreservingVars, resolveEnvTemplate } from './envVars';

const shellQuote = (str: string): string => {
  return `'${str.replace(/'/g, `'\\''`)}'`;
};

export const buildCurlCommand = (request: RequestItem, activeEnv?: Environment): string => {
  const vars = activeEnv?.variables || {};
  let resolvedUrl = resolveEnvTemplate(request.url || 'http://localhost', vars);

  // Merge any enabled structured query parameters not already reflected in resolvedUrl
  const extraPairs: string[] = [];
  const qIndex = resolvedUrl.indexOf('?');
  const existingQs = qIndex >= 0 ? resolvedUrl.slice(qIndex + 1) : '';
  const existingPairs = new Set(
    existingQs
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq < 0) return `${decodeURIComponentSafe(pair)}=`;
        return `${decodeURIComponentSafe(pair.slice(0, eq))}=${decodeURIComponentSafe(pair.slice(eq + 1))}`;
      })
  );

  for (const p of request.queryParams || []) {
    if (!p.enabled || !p.key.trim()) continue;
    const rk = resolveEnvTemplate(p.key, vars);
    const rv = resolveEnvTemplate(p.value, vars);
    if (!existingPairs.has(`${rk}=${rv}`)) {
      extraPairs.push(`${encodeQueryPartPreservingVars(rk)}=${encodeQueryPartPreservingVars(rv)}`);
    }
  }
  if (extraPairs.length > 0) {
    resolvedUrl += (qIndex >= 0 ? '&' : '?') + extraPairs.join('&');
  }

  const parts: string[] = ['curl'];

  if (request.method && request.method !== 'GET') {
    parts.push('-X', request.method);
  }
  parts.push(shellQuote(resolvedUrl));

  for (const h of request.headers || []) {
    if (h.enabled && h.key.trim()) {
      const key = resolveEnvTemplate(h.key, vars);
      const val = resolveEnvTemplate(h.value, vars);
      parts.push('-H', shellQuote(`${key}: ${val}`));
    }
  }

  let bodyStr = '';
  if (request.body.type === 'graphql') {
    const query = resolveEnvTemplate(request.body.graphqlQuery || request.body.raw || '', vars);
    let variables: unknown = {};
    if (request.body.graphqlVariables?.trim()) {
      try {
        variables = JSON.parse(resolveEnvTemplate(request.body.graphqlVariables, vars));
      } catch {
        variables = resolveEnvTemplate(request.body.graphqlVariables, vars);
      }
    }
    bodyStr = JSON.stringify({ query, variables });
  } else if (request.body.type !== 'none' && request.body.raw) {
    bodyStr = resolveEnvTemplate(request.body.raw, vars);
  }

  if (bodyStr && request.method !== 'GET' && request.method !== 'HEAD') {
    parts.push('-d', shellQuote(bodyStr));
  }

  return parts.join(' ');
};

const decodeURIComponentSafe = (val: string): string => {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
};

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback for restricted WebView contexts
  }

  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
};
