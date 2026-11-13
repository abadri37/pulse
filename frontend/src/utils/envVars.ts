export interface EnvVarTrigger {
  start: number;
  end: number;
  query: string;
  mode: 'template' | 'script-key';
  hasBraces: boolean;
  quoteChar?: string;
}

const JS_RESERVED = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'try',
  'catch',
  'new',
  'true',
  'false',
  'null',
  'undefined',
  'pulse',
  'response',
  'expect',
  'data',
]);

export const resolveEnvTemplate = (
  input: string,
  vars: Record<string, string>
): string => {
  if (!input) return '';
  return input.replace(/\{\{([^}]+)\}\}/g, (full, rawKey) => {
    const k = rawKey.trim();
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : full;
  });
};

export const encodeQueryPartPreservingVars = (part: string): string => {
  if (!part) return '';
  return part
    .split(/(\{\{[^}]+\}\})/g)
    .map((seg) => (/^\{\{[^}]+\}\}$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('');
};

export const findEnvVarTrigger = (
  text: string,
  cursorPos: number,
  varEntries: [string, string][],
  options: { allowBarePrefix?: boolean; allowJsScriptKey?: boolean } = {}
): EnvVarTrigger | null => {
  if (varEntries.length === 0) return null;
  const { allowBarePrefix = true, allowJsScriptKey = false } = options;
  const before = text.slice(0, cursorPos);

  if (allowJsScriptKey) {
    const jsKeyMatch = before.match(
      /(?:pulse\.(?:getEnv|setEnv)|pulse\.(?:environment|variables)\.(?:get|set))\(\s*(['"])([a-zA-Z0-9_.-]*)$/
    );
    if (jsKeyMatch) {
      return {
        start: before.length - jsKeyMatch[2].length,
        end: cursorPos,
        query: jsKeyMatch[2],
        mode: 'script-key',
        hasBraces: false,
        quoteChar: jsKeyMatch[1],
      };
    }
  }

  const braceMatch = before.match(/\{\{([a-zA-Z0-9_$.-]*)$/);
  if (braceMatch) {
    return {
      start: before.length - braceMatch[0].length,
      end: cursorPos,
      query: braceMatch[1],
      mode: 'template',
      hasBraces: true,
    };
  }

  if (allowBarePrefix) {
    const tokenMatch = before.match(/(?:^|[/?&=:\s"'(\[,>])([a-zA-Z_][a-zA-Z0-9_.-]*)$/);
    if (tokenMatch) {
      const q = tokenMatch[1];
      const qLower = q.toLowerCase();
      if (allowJsScriptKey && JS_RESERVED.has(qLower)) {
        return null;
      }
      const hasPrefixHit = varEntries.some(([k]) =>
        k.toLowerCase().startsWith(qLower)
      );
      if (hasPrefixHit && !'https'.startsWith(qLower)) {
        return {
          start: before.length - q.length,
          end: cursorPos,
          query: q,
          mode: 'template',
          hasBraces: false,
        };
      }
    }
  }

  return null;
};

export const filterEnvVarSuggestions = (
  trigger: EnvVarTrigger | null,
  varEntries: [string, string][]
): [string, string][] => {
  if (!trigger) return [];
  const qLower = trigger.query.toLowerCase();
  if (!qLower) return varEntries;
  const starts = varEntries.filter(([k]) => k.toLowerCase().startsWith(qLower));
  if (trigger.hasBraces || trigger.mode === 'script-key') {
    const contains = varEntries.filter(
      ([k]) => !k.toLowerCase().startsWith(qLower) && k.toLowerCase().includes(qLower)
    );
    return [...starts, ...contains];
  }
  return starts;
};

export const applyEnvVarSuggestion = (
  text: string,
  trigger: EnvVarTrigger,
  varName: string
): { nextText: string; nextCursor: number } => {
  const after = text.slice(trigger.end);

  if (trigger.mode === 'script-key') {
    const quote = trigger.quoteChar || '"';
    const hasClosingQuote = after.startsWith(quote);
    const suffix = hasClosingQuote ? '' : quote;
    const nextText =
      text.slice(0, trigger.start) + varName + suffix + after;
    const nextCursor =
      trigger.start + varName.length + (hasClosingQuote ? 1 : suffix.length);
    return { nextText, nextCursor };
  }

  if(!trigger.hasBraces){
    const nextText=text.slice(0,trigger.start)+varName+after;
    const nextCursor=trigger.start+varName.length;
    return {nextText,nextCursor};
  }

  const consumeClosing = after.startsWith('}}') ? 2 : after.startsWith('}') ? 1 : 0;
  const insertion = `{{${varName}}}`;
  const nextText =
    text.slice(0, trigger.start) + insertion + after.slice(consumeClosing);
  const nextCursor = trigger.start + insertion.length;
  return { nextText, nextCursor };
};

/**
 * Masks unquoted {{var}} tokens in JSON with sentinel string literals so
 * JSON.parse / JSON.stringify can validate and beautify JSON templates cleanly.
 */
export const formatJsonPreservingEnvVars = (
  raw: string
): { valid: boolean; formatted: string; unquotedVars: string[] } => {
  const unquotedVars: string[] = [];
  let masked = '';
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    if (inString) {
      masked += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      masked += ch;
      i++;
      continue;
    }

    if (ch === '{' && raw[i + 1] === '{') {
      const closeIdx = raw.indexOf('}}', i + 2);
      if (closeIdx > i + 2) {
        const token = raw.slice(i, closeIdx + 2);
        const varName = raw.slice(i + 2, closeIdx).trim();
        const sentinelIdx = unquotedVars.length;
        unquotedVars.push(varName);
        masked += `"__PULSE_ENV_${sentinelIdx}__:${encodeURIComponent(token)}"`;
        i = closeIdx + 2;
        continue;
      }
    }

    masked += ch;
    i++;
  }

  try {
    const parsed = JSON.parse(masked);
    let formatted = JSON.stringify(parsed, null, 2);
    formatted = formatted.replace(/"__PULSE_ENV_(\d+)__:([^"]*)"/g, (_m, _idx, encoded) =>
      decodeURIComponent(encoded)
    );
    return { valid: true, formatted, unquotedVars };
  } catch {
    return { valid: false, formatted: raw, unquotedVars };
  }
};
