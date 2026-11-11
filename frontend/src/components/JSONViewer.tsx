import React, { useMemo } from 'react';

interface Props {
  rawJson: string;
  searchTerm?: string;
  isDark?: boolean;
}

export const JSONViewer: React.FC<Props> = ({ rawJson, searchTerm = '', isDark = true }) => {
  // Format and tokenize JSON with line numbers
  const lines = useMemo(() => {
    let formatted = rawJson;
    try {
      const parsed = JSON.parse(rawJson);
      formatted = JSON.stringify(parsed, null, 2);
    } catch {
      // not valid JSON, use raw string
    }

    return formatted.split('\n');
  }, [rawJson]);

  // Syntax highlighter for a single line of JSON
  const renderHighlightedLine = (line: string) => {
    // Quick regex tokenizer for JSON tokens
    const tokenRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|[{}\[\],:])/g;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(line)) !== null) {
      // Push any preceding whitespace or text
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }

      const token = match[0];
      let className = isDark ? 'text-neutral-300' : 'text-neutral-700';

      if (/^"/.test(token)) {
        if (/:$/.test(token)) {
          // Key
          className = 'json-key';
        } else {
          // String value
          className = 'json-string';
        }
      } else if (/true|false/.test(token)) {
        className = 'json-boolean';
      } else if (/null/.test(token)) {
        className = 'json-null';
      } else if (!isNaN(Number(token))) {
        className = 'json-number';
      } else {
        className = 'json-punct';
      }

      // If searchTerm exists, highlight within this token
      if (searchTerm && token.toLowerCase().includes(searchTerm.toLowerCase())) {
        const lowerToken = token.toLowerCase();
        const lowerSearch = searchTerm.toLowerCase();
        const subParts: React.ReactNode[] = [];
        let subIndex = 0;
        let searchIndex = lowerToken.indexOf(lowerSearch, subIndex);

        while (searchIndex !== -1) {
          if (searchIndex > subIndex) {
            subParts.push(token.substring(subIndex, searchIndex));
          }
          subParts.push(
            <mark key={`mark-${searchIndex}`} className="search-highlight font-semibold">
              {token.substring(searchIndex, searchIndex + searchTerm.length)}
            </mark>
          );
          subIndex = searchIndex + searchTerm.length;
          searchIndex = lowerToken.indexOf(lowerSearch, subIndex);
        }
        if (subIndex < token.length) {
          subParts.push(token.substring(subIndex));
        }

        parts.push(
          <span key={match.index} className={className}>
            {subParts}
          </span>
        );
      } else {
        parts.push(
          <span key={match.index} className={className}>
            {token}
          </span>
        );
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < line.length) {
      parts.push(line.substring(lastIndex));
    }

    return parts;
  };

  return (
    <div className={`flex font-mono text-xs leading-relaxed select-text overflow-x-auto ${
      isDark ? 'text-neutral-200' : 'text-neutral-800'
    }`}>
      {/* Line Numbers Gutter */}
      <div className={`select-none pr-3 text-right shrink-0 border-r ${
        isDark ? 'border-neutral-800/80 text-neutral-600' : 'border-neutral-200 text-neutral-400'
      }`}>
        {lines.map((_, i) => (
          <div key={i} className="h-5 px-1 leading-5 text-[11px]">
            {i + 1}
          </div>
        ))}
      </div>

      {/* Code Area */}
      <div className="pl-3.5 flex-1 overflow-x-auto">
        {lines.map((line, i) => (
          <div key={i} className="h-5 leading-5 whitespace-pre hover:bg-white/5 rounded-xs transition-colors">
            {renderHighlightedLine(line)}
          </div>
        ))}
      </div>
    </div>
  );
};
