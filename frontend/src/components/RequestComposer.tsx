import React, { useState, useRef, useEffect } from 'react';
import { KeyValueItem, RequestItem, Environment } from '../types';
import { KeyValueTable } from './KeyValueTable';
import { LoadTestPanel } from './loadtest/LoadTestPanel';
import { CodeInputEditor, CodeInputEditorHandle } from './CodeInputEditor';
import { useTheme } from '../context/ThemeContext';
import { encodeQueryPartPreservingVars, formatJsonPreservingEnvVars } from '../utils/envVars';
import {
  Zap,
  Wand2,
  Sliders,
  Layers,
  FileCode,
  Code2,
  ChevronDown,
  FileText,
  Hexagon,
  List,
  Ban,
  Sparkles,
  Plus,
  AlertCircle,
  Check,
} from 'lucide-react';

interface Props {
  request: RequestItem;
  onChange: (req: RequestItem) => void;
  isLoading: boolean;
  collectionNames: string[];
  activeEnv?: Environment;
  isCurlOpen: boolean;
  onCloseCurl: () => void;
  activeView?: 'client' | 'loadtest';
}

const BODY_OPTIONS = [
  { id: 'json', label: 'JSON', badge: 'application/json', icon: FileCode },
  { id: 'xml', label: 'XML / SOAP', badge: 'text/xml (SOAP 1.1/1.2)', icon: Code2 },
  { id: 'graphql', label: 'GraphQL', badge: 'Query & Variables', icon: Hexagon },
  { id: 'x-www-form-urlencoded', label: 'Form URL', badge: 'application/x-www-form-urlencoded', icon: List },
  { id: 'raw', label: 'Raw Text', badge: 'text/plain', icon: FileText },
  { id: 'none', label: 'No Body', badge: 'Empty payload', icon: Ban },
] as const;

const JSON_SAMPLE_TEMPLATE = `{\n  "name": "Sample Payload",\n  "status": "active",\n  "count": 10\n}`;
const JSON_EMPTY_TEMPLATE = `{\n  \n}`;
const JSON_ARRAY_TEMPLATE = `[\n  {\n    "id": 1,\n    "name": "Item 1"\n  }\n]`;

const SOAP_11_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <!-- Optional Authentication or Session Header -->
  </soap:Header>
  <soap:Body>
    <GetEndpointData xmlns="http://tempuri.org/">
      <ParameterName>SampleValue</ParameterName>
    </GetEndpointData>
  </soap:Body>
</soap:Envelope>`;

const SOAP_12_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header>
    <!-- Optional Authentication or Session Header -->
  </soap12:Header>
  <soap12:Body>
    <GetEndpointData xmlns="http://tempuri.org/">
      <ParameterName>SampleValue</ParameterName>
    </GetEndpointData>
  </soap12:Body>
</soap12:Envelope>`;

const REST_XML_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<request>
  <id>1001</id>
  <status>active</status>
</request>`;

const GRAPHQL_QUERY_TEMPLATE = `query GetUserData($userId: ID!) {
  user(id: $userId) {
    id
    name
    email
    role
  }
}`;

const GRAPHQL_VARS_TEMPLATE = `{\n  "userId": "1001"\n}`;

// Robust XML Beautifier
const formatXml = (xml: string): string => {
  if (!xml.trim()) return xml;
  let formatted = '';
  let pad = 0;
  const reg = /(>)(<)(\/*)/g;
  const lines = xml.replace(reg, '$1\r\n$2$3').split('\r\n');
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.match(/^<\/\w/)) {
      if (pad > 0) pad--;
    }
    formatted += '  '.repeat(pad) + trimmed + '\n';
    if (
      trimmed.match(/^<\w[^>]*[^\/]>.*$/) &&
      !trimmed.match(/<\/\w+>$/) &&
      !trimmed.startsWith('<?') &&
      !trimmed.startsWith('<!')
    ) {
      pad++;
    }
  });
  return formatted.trim();
};

export const RequestComposer: React.FC<Props> = ({
  request,
  onChange,
  isLoading,
  collectionNames,
  activeEnv,
  isCurlOpen,
  onCloseCurl,
  activeView,
}) => {
  const { isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<'body' | 'params' | 'headers' | 'scripts' | 'loadtest'>('body');
  const [isBodyDropdownOpen, setIsBodyDropdownOpen] = useState(false);
  const [graphqlSubTab, setGraphqlSubTab] = useState<'query' | 'variables'>('query');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const jsonEditorRef = useRef<CodeInputEditorHandle>(null);

  useEffect(() => {
    if (activeView === 'loadtest') {
      setActiveTab('loadtest');
    } else if (activeView === 'client' && activeTab === 'loadtest') {
      setActiveTab('body');
    }
  }, [activeView]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsBodyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateRequest = (field: keyof RequestItem, value: any) => {
    onChange({ ...request, [field]: value });
  };

  const handleParamsChange = (newParams: KeyValueItem[]) => {
    try {
      const baseUrl = request.url.split('?')[0];
      const qs = newParams
        .filter((p) => p.enabled && p.key)
        .map(
          (p) =>
            `${encodeQueryPartPreservingVars(p.key)}=${encodeQueryPartPreservingVars(p.value)}`
        )
        .join('&');
      const updatedUrl = qs ? `${baseUrl}?${qs}` : baseUrl;
      onChange({
        ...request,
        url: updatedUrl,
        queryParams: newParams,
      });
    } catch {
      updateRequest('queryParams', newParams);
    }
  };

  // Switch Body Type with dedicated retention per type & automatic header management
  const handleSelectBodyType = (newType: RequestItem['body']['type']) => {
    setIsBodyDropdownOpen(false);
    setActiveTab('body');

    const prevType = request.body.type;
    let updatedHeaders = [...(request.headers || [])];
    let updatedMethod = request.method;

    // 1. Snapshot previous content into dedicated slot
    let updatedJsonBody = request.body.jsonBody;
    let updatedXmlBody = request.body.xmlBody;
    let updatedRawBody = request.body.rawBody;
    let updatedFormBody = request.body.formBody;
    let updatedGraphqlQuery = request.body.graphqlQuery;
    let updatedGraphqlVariables = request.body.graphqlVariables;

    if (prevType === 'json') {
      const current = request.body.raw || request.body.jsonBody || '';
      // Only keep if not stray XML
      if (!current.trim().startsWith('<')) {
        updatedJsonBody = current;
      }
    } else if (prevType === 'xml') {
      const current = request.body.raw || request.body.xmlBody || '';
      if (current.trim().startsWith('<')) {
        updatedXmlBody = current;
      }
    } else if (prevType === 'raw') {
      updatedRawBody = request.body.raw || request.body.rawBody || '';
    } else if (prevType === 'x-www-form-urlencoded') {
      updatedFormBody = request.body.raw || request.body.formBody || '';
    }

    // 2. Prepare content for newType
    let newRaw = '';

    if (newType === 'json') {
      // Pick existing jsonBody or clean sample
      if (updatedJsonBody && !updatedJsonBody.trim().startsWith('<')) {
        newRaw = updatedJsonBody;
      } else if (request.body.raw && !request.body.raw.trim().startsWith('<') && prevType !== 'xml') {
        newRaw = request.body.raw;
      } else {
        newRaw = JSON_SAMPLE_TEMPLATE;
      }
      updatedJsonBody = newRaw;

      // Update or add Content-Type: application/json
      const ctIdx = updatedHeaders.findIndex((h) => h.key.toLowerCase() === 'content-type');
      if (ctIdx >= 0) {
        updatedHeaders[ctIdx] = { ...updatedHeaders[ctIdx], value: 'application/json', enabled: true };
      } else {
        updatedHeaders.push({ key: 'Content-Type', value: 'application/json', enabled: true });
      }

      // Disable SOAPAction header if present so it does not interfere
      updatedHeaders = updatedHeaders.map((h) =>
        h.key.toLowerCase() === 'soapaction' ? { ...h, enabled: false } : h
      );

    } else if (newType === 'xml') {
      if (updatedXmlBody && updatedXmlBody.trim().startsWith('<')) {
        newRaw = updatedXmlBody;
      } else if (request.body.raw && request.body.raw.trim().startsWith('<') && prevType !== 'json') {
        newRaw = request.body.raw;
      } else {
        newRaw = SOAP_11_TEMPLATE;
      }
      updatedXmlBody = newRaw;

      // SOAP/XML standard requires POST
      if (updatedMethod === 'GET') {
        updatedMethod = 'POST';
      }

      // Update or add Content-Type: text/xml; charset=utf-8
      const ctIdx = updatedHeaders.findIndex((h) => h.key.toLowerCase() === 'content-type');
      if (ctIdx >= 0) {
        updatedHeaders[ctIdx] = { ...updatedHeaders[ctIdx], value: 'text/xml; charset=utf-8', enabled: true };
      } else {
        updatedHeaders.push({ key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true });
      }

      // Re-enable SOAPAction header if present
      updatedHeaders = updatedHeaders.map((h) =>
        h.key.toLowerCase() === 'soapaction' ? { ...h, enabled: true } : h
      );

    } else if (newType === 'graphql') {
      if (!updatedGraphqlQuery?.trim()) {
        updatedGraphqlQuery = GRAPHQL_QUERY_TEMPLATE;
      }
      if (!updatedGraphqlVariables?.trim()) {
        updatedGraphqlVariables = GRAPHQL_VARS_TEMPLATE;
      }
      newRaw = JSON.stringify({ query: updatedGraphqlQuery, variables: updatedGraphqlVariables });

      if (updatedMethod === 'GET') {
        updatedMethod = 'POST';
      }

      const ctIdx = updatedHeaders.findIndex((h) => h.key.toLowerCase() === 'content-type');
      if (ctIdx >= 0) {
        updatedHeaders[ctIdx] = { ...updatedHeaders[ctIdx], value: 'application/json', enabled: true };
      } else {
        updatedHeaders.push({ key: 'Content-Type', value: 'application/json', enabled: true });
      }

    } else if (newType === 'x-www-form-urlencoded') {
      newRaw = updatedFormBody || 'key1=value1&key2=value2';
      updatedFormBody = newRaw;

      if (updatedMethod === 'GET') {
        updatedMethod = 'POST';
      }

      const ctIdx = updatedHeaders.findIndex((h) => h.key.toLowerCase() === 'content-type');
      if (ctIdx >= 0) {
        updatedHeaders[ctIdx] = { ...updatedHeaders[ctIdx], value: 'application/x-www-form-urlencoded', enabled: true };
      } else {
        updatedHeaders.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true });
      }

    } else if (newType === 'raw') {
      newRaw = updatedRawBody || '';
      updatedRawBody = newRaw;

      const ctIdx = updatedHeaders.findIndex((h) => h.key.toLowerCase() === 'content-type');
      if (ctIdx >= 0) {
        updatedHeaders[ctIdx] = { ...updatedHeaders[ctIdx], value: 'text/plain; charset=utf-8', enabled: true };
      } else {
        updatedHeaders.push({ key: 'Content-Type', value: 'text/plain; charset=utf-8', enabled: true });
      }

    } else if (newType === 'none') {
      newRaw = '';
      const ctIdx = updatedHeaders.findIndex((h) => h.key.toLowerCase() === 'content-type');
      if (ctIdx >= 0) {
        updatedHeaders[ctIdx] = { ...updatedHeaders[ctIdx], enabled: false };
      }
    }

    onChange({
      ...request,
      method: updatedMethod,
      headers: updatedHeaders,
      body: {
        ...request.body,
        type: newType,
        raw: newRaw,
        jsonBody: updatedJsonBody,
        xmlBody: updatedXmlBody,
        rawBody: updatedRawBody,
        formBody: updatedFormBody,
        graphqlQuery: updatedGraphqlQuery,
        graphqlVariables: updatedGraphqlVariables,
      },
    });
  };

  // Beautify functions
  const beautifyPayload = () => {
    if (request.body.type === 'json') {
      const current = request.body.jsonBody ?? (request.body.raw?.trim()?.startsWith('<') ? '' : request.body.raw);
      if (!current) return;
      const { valid, formatted } = formatJsonPreservingEnvVars(current);
      if (valid) {
        onChange({
          ...request,
          body: { ...request.body, raw: formatted, jsonBody: formatted },
        });
      }
    } else if (request.body.type === 'xml') {
      const current = request.body.xmlBody ?? request.body.raw;
      if (!current) return;
      try {
        const beautified = formatXml(current);
        onChange({
          ...request,
          body: { ...request.body, raw: beautified, xmlBody: beautified },
        });
      } catch {}
    } else if (request.body.type === 'graphql') {
      if (graphqlSubTab === 'variables' && request.body.graphqlVariables) {
        try {
          const parsed = JSON.parse(request.body.graphqlVariables);
          const formatted = JSON.stringify(parsed, null, 2);
          onChange({
            ...request,
            body: {
              ...request.body,
              graphqlVariables: formatted,
              raw: JSON.stringify({ query: request.body.graphqlQuery || '', variables: formatted }),
            },
          });
        } catch {}
      }
    }
  };

  // Add SOAPAction Header Helper
  const addSoapActionHeader = (actionName = 'http://tempuri.org/GetEndpointData') => {
    const existingIdx = (request.headers || []).findIndex((h) => h.key.toLowerCase() === 'soapaction');
    let newHeaders: KeyValueItem[];
    if (existingIdx >= 0) {
      newHeaders = request.headers.map((h, i) => (i === existingIdx ? { ...h, value: `"${actionName}"`, enabled: true } : h));
    } else {
      newHeaders = [...(request.headers || []), { key: 'SOAPAction', value: `"${actionName}"`, enabled: true }];
    }
    onChange({ ...request, headers: newHeaders });
  };

  // Safe display text helpers that NEVER cross-contaminate XML and JSON
  const jsonDisplayText = (() => {
    if (request.body.jsonBody !== undefined) return request.body.jsonBody;
    const raw = request.body.raw || '';
    if (raw.trim().startsWith('<')) {
      return JSON_SAMPLE_TEMPLATE;
    }
    return raw;
  })();

  const xmlDisplayText = (() => {
    if (request.body.xmlBody !== undefined) return request.body.xmlBody;
    const raw = request.body.raw || '';
    if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      return SOAP_11_TEMPLATE;
    }
    return raw || SOAP_11_TEMPLATE;
  })();

  // JSON validity helper (supports {{var}} templates cleanly and detects unquoted string vars)
  const jsonValidation = (() => {
    if (!jsonDisplayText.trim()) return { valid: true, needsQuotesFor: [] as string[] };
    const { valid, unquotedVars } = formatJsonPreservingEnvVars(jsonDisplayText);
    const vars = activeEnv?.variables || {};
    const needsQuotesFor = unquotedVars.filter((v) => {
      if (!Object.prototype.hasOwnProperty.call(vars, v)) return false;
      const val = vars[v].trim();
      if (!val) return true;
      try {
        JSON.parse(val);
        return false; // valid raw JSON literal (number, boolean, null, object, array)
      } catch {
        return true; // string value such as URL or token
      }
    });
    return { valid, needsQuotesFor };
  })();
  const isJsonValid = jsonValidation.valid;

  const currentBodyOption = BODY_OPTIONS.find((b) => b.id === request.body.type) || BODY_OPTIONS[0];
  const paramCount = request.queryParams?.filter((p) => p.enabled && p.key).length || 0;
  const headerCount = request.headers?.filter((h) => h.enabled && h.key).length || 0;
  const hasBody = request.body.type !== 'none' && (
    request.body.type === 'graphql'
      ? !!request.body.graphqlQuery?.trim()
      : !!request.body.raw?.trim()
  );

  return (
    <div className={`flex h-full flex-col overflow-hidden transition-colors duration-200 ${
      isDark ? 'bg-[#13161f] text-slate-100' : 'bg-white text-slate-900'
    }`}>
      {/* Request Tabs: Body (with Dropdown), Query, Headers, Scripts, Load Test */}
      <div className={`flex shrink-0 items-center border-b px-3 gap-3 text-xs font-bold select-none whitespace-nowrap ${
        isDark ? 'border-neutral-800/80 bg-[#13161f] text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'
      }`}>
        {/* Interactive Body Type Selector Dropdown Tab */}
        <div className="relative" ref={dropdownRef}>
          <div
            className={`flex items-center border-b-2 transition ${
              activeTab === 'body'
                ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
                : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <button
              onClick={() => {
                if (activeTab === 'body') {
                  setIsBodyDropdownOpen(!isBodyDropdownOpen);
                } else {
                  setActiveTab('body');
                }
              }}
              className="py-2 pl-2 pr-1 flex items-center gap-1.5 cursor-pointer leading-4"
            >
              <currentBodyOption.icon className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>{currentBodyOption.label}</span>
              {hasBody && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />}
            </button>

            {/* Dropdown Chevron Trigger */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsBodyDropdownOpen(!isBodyDropdownOpen);
              }}
              className="py-2 pr-2 pl-1 flex items-center justify-center cursor-pointer leading-4"
              title="Change Request Body Format (JSON, XML / SOAP, GraphQL, etc.)"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isBodyDropdownOpen ? 'rotate-180 text-violet-400' : ''}`} />
            </button>
          </div>

          {/* Body Type Dropdown Popover */}
          {isBodyDropdownOpen && (
            <div className={`absolute left-0 top-full mt-1 w-56 rounded-xl border p-1.5 shadow-2xl z-50 transition-all ${
              isDark ? 'border-neutral-800 bg-[#161924] text-white' : 'border-slate-300 bg-white text-slate-900'
            }`}>
              <div className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-neutral-700/50 mb-1">
                Select Body Payload Format
              </div>
              {BODY_OPTIONS.map((opt) => {
                const isSelected = request.body.type === opt.id;
                const IconComponent = opt.icon;
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleSelectBodyType(opt.id as any)}
                    className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition cursor-pointer ${
                      isSelected
                        ? isDark
                          ? 'bg-violet-600/20 text-violet-300 font-bold'
                          : 'bg-violet-100 text-violet-800 font-bold'
                        : isDark
                          ? 'hover:bg-neutral-800 text-slate-300 hover:text-white'
                          : 'hover:bg-slate-100 text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <IconComponent className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                      <div>
                        <div className="font-bold leading-tight">{opt.label}</div>
                        <div className="text-[10px] text-slate-400 leading-tight">{opt.badge}</div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-violet-400" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Query (Params) */}
        <button
          onClick={() => setActiveTab('params')}
          className={`py-2 px-2 border-b-2 transition flex items-center gap-1 cursor-pointer ${
            activeTab === 'params'
              ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
              : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sliders className="h-3.5 w-3.5 text-cyan-400" />
          <span>Query</span>
          {paramCount > 0 && (
            <span className="text-[10px] text-slate-400 font-bold opacity-80">{paramCount}</span>
          )}
        </button>

        {/* Headers */}
        <button
          onClick={() => setActiveTab('headers')}
          className={`py-2 px-2 border-b-2 transition flex items-center gap-1 cursor-pointer ${
            activeTab === 'headers'
              ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
              : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="h-3.5 w-3.5 text-purple-400" />
          <span>Headers</span>
          {headerCount > 0 && (
            <span className="text-[10px] text-slate-400 font-bold opacity-80">{headerCount}</span>
          )}
        </button>

        {/* Scripts & Tests */}
        <button
          onClick={() => setActiveTab('scripts')}
          className={`py-2 px-2 border-b-2 transition flex items-center gap-1 cursor-pointer ${
            activeTab === 'scripts'
              ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
              : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Code2 className="h-3.5 w-3.5 text-indigo-400" />
          <span>Scripts</span>
          {(request.preRequestScript || request.postResponseScript) && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          )}
        </button>

        {/* Load Test */}
        <button
          onClick={() => setActiveTab('loadtest')}
          className={`py-2 px-2 border-b-2 transition flex items-center gap-1 cursor-pointer ${
            activeTab === 'loadtest'
              ? 'border-amber-500 text-amber-400 font-extrabold'
              : 'border-transparent hover:text-amber-400'
          }`}
        >
          <Zap className="h-3 w-3 text-amber-400" />
          <span>Load Test</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className="flex-1 flex flex-col min-h-0 overflow-auto p-3">
        {/* Body Editor Panel */}
        {activeTab === 'body' && (
          <div className="flex flex-col flex-1 min-h-0 gap-2">
            {/* 1. XML / SOAP SPECIFIC VIEW */}
            {request.body.type === 'xml' && (
              <div className="flex flex-col flex-1 min-h-0 gap-2">
                {/* SOAP Action Toolbar */}
                <div className={`flex items-center justify-between flex-wrap gap-2 rounded-xl border p-2 text-xs ${
                  isDark ? 'border-neutral-800 bg-[#161924]' : 'border-slate-300 bg-slate-50'
                }`}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[11px] font-bold flex items-center gap-1 ${isDark ? 'text-violet-400' : 'text-violet-700'}`}>
                      <Sparkles className="h-3.5 w-3.5" /> Envelopes:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({
                          ...request,
                          body: { ...request.body, raw: SOAP_11_TEMPLATE, xmlBody: SOAP_11_TEMPLATE },
                        });
                      }}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                        isDark
                          ? 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/40 border-violet-500/30'
                          : 'bg-violet-100 text-violet-800 hover:bg-violet-200 border-violet-300'
                      }`}
                      title="Insert standard SOAP 1.1 Envelope with namespaces"
                    >
                      SOAP 1.1
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({
                          ...request,
                          body: { ...request.body, raw: SOAP_12_TEMPLATE, xmlBody: SOAP_12_TEMPLATE },
                        });
                      }}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                        isDark
                          ? 'bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40 border-indigo-500/30'
                          : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200 border-indigo-300'
                      }`}
                      title="Insert standard SOAP 1.2 Envelope"
                    >
                      SOAP 1.2
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({
                          ...request,
                          body: { ...request.body, raw: REST_XML_TEMPLATE, xmlBody: REST_XML_TEMPLATE },
                        });
                      }}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                        isDark
                          ? 'bg-teal-600/20 text-teal-300 hover:bg-teal-600/40 border-teal-500/30'
                          : 'bg-teal-100 text-teal-800 hover:bg-teal-200 border-teal-300'
                      }`}
                      title="Insert standard REST XML"
                    >
                      REST XML
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({
                          ...request,
                          body: { ...request.body, raw: '', xmlBody: '' },
                        });
                      }}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                        isDark ? 'text-slate-400 hover:text-rose-400' : 'text-slate-600 hover:text-rose-600'
                      }`}
                      title="Clear XML body"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => addSoapActionHeader()}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition flex items-center gap-1 cursor-pointer ${
                        isDark
                          ? 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 border-emerald-500/30'
                          : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-300'
                      }`}
                      title="Add or update SOAPAction header"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Add SOAPAction</span>
                    </button>

                    <button
                      type="button"
                      onClick={beautifyPayload}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition flex items-center gap-1 cursor-pointer ${
                        isDark
                          ? 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/40 border-violet-500/30'
                          : 'bg-violet-100 text-violet-800 hover:bg-violet-200 border-violet-300'
                      }`}
                      title="Format and beautify XML"
                    >
                      <Wand2 className="h-3 w-3" />
                      <span>Beautify XML</span>
                    </button>

                    {request.method !== 'POST' && (
                      <button
                        type="button"
                        onClick={() => onChange({ ...request, method: 'POST' })}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition flex items-center gap-1 cursor-pointer ${
                          isDark
                            ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/40 border-amber-500/30'
                            : 'bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300'
                        }`}
                        title="SOAP specification requires HTTP POST"
                      >
                        <AlertCircle className="h-3 w-3" />
                        <span>Switch to POST</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Syntax-Highlighted XML / SOAP Editor with Collapsible Tags */}
                <CodeInputEditor
                  value={xmlDisplayText}
                  onChange={(val) => {
                    onChange({
                      ...request,
                      body: {
                        ...request.body,
                        type: 'xml',
                        raw: val,
                        xmlBody: val,
                      },
                    });
                  }}
                  language="xml"
                  placeholder={SOAP_11_TEMPLATE}
                  isDark={isDark}
                  activeEnv={activeEnv}
                />
              </div>
            )}

            {/* 2. GRAPHQL SPECIFIC VIEW */}
            {request.body.type === 'graphql' && (
              <div className="flex flex-col flex-1 min-h-0 gap-2">
                {/* GraphQL Sub-Tabs: Query & Variables */}
                <div className={`flex items-center justify-between border-b pb-2 ${
                  isDark ? 'border-neutral-800' : 'border-slate-200'
                }`}>
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setGraphqlSubTab('query')}
                      className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                        graphqlSubTab === 'query'
                          ? 'bg-violet-600 text-white font-extrabold shadow-sm'
                          : isDark
                            ? 'text-slate-400 hover:bg-neutral-800'
                            : 'text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Query
                    </button>
                    <button
                      type="button"
                      onClick={() => setGraphqlSubTab('variables')}
                      className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                        graphqlSubTab === 'variables'
                          ? 'bg-violet-600 text-white font-extrabold shadow-sm'
                          : isDark
                            ? 'text-slate-400 hover:bg-neutral-800'
                            : 'text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Variables (JSON)
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const newQuery = GRAPHQL_QUERY_TEMPLATE;
                        const newVars = GRAPHQL_VARS_TEMPLATE;
                        onChange({
                          ...request,
                          body: {
                            ...request.body,
                            type: 'graphql',
                            graphqlQuery: newQuery,
                            graphqlVariables: newVars,
                            raw: JSON.stringify({ query: newQuery, variables: newVars }),
                          },
                        });
                      }}
                      className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition cursor-pointer ${
                        isDark
                          ? 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/40 border-violet-500/30'
                          : 'bg-violet-100 text-violet-800 hover:bg-violet-200 border-violet-300'
                      }`}
                    >
                      + Sample Query
                    </button>

                    {graphqlSubTab === 'variables' && (
                      <button
                        type="button"
                        onClick={beautifyPayload}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition flex items-center gap-1 cursor-pointer ${
                          isDark
                            ? 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/40 border-violet-500/30'
                            : 'bg-violet-100 text-violet-800 hover:bg-violet-200 border-violet-300'
                        }`}
                      >
                        <Wand2 className="h-3 w-3" />
                        <span>Format Vars</span>
                      </button>
                    )}
                  </div>
                </div>

                {graphqlSubTab === 'query' ? (
                  <CodeInputEditor
                    value={request.body.graphqlQuery || ''}
                    onChange={(newQuery) => {
                      onChange({
                        ...request,
                        body: {
                          ...request.body,
                          graphqlQuery: newQuery,
                          raw: JSON.stringify({
                            query: newQuery,
                            variables: request.body.graphqlVariables || '',
                          }),
                        },
                      });
                    }}
                    language="graphql"
                    placeholder={GRAPHQL_QUERY_TEMPLATE}
                    isDark={isDark}
                    activeEnv={activeEnv}
                  />
                ) : (
                  <CodeInputEditor
                    value={request.body.graphqlVariables || ''}
                    onChange={(newVars) => {
                      onChange({
                        ...request,
                        body: {
                          ...request.body,
                          graphqlVariables: newVars,
                          raw: JSON.stringify({
                            query: request.body.graphqlQuery || '',
                            variables: newVars,
                          }),
                        },
                      });
                    }}
                    language="json"
                    placeholder={GRAPHQL_VARS_TEMPLATE}
                    isDark={isDark}
                    activeEnv={activeEnv}
                  />
                )}
              </div>
            )}

            {/* 3. JSON SPECIFIC VIEW */}
            {request.body.type === 'json' && (
              <div className="flex flex-col flex-1 min-h-0 gap-2">
                {/* JSON Toolbar */}
                <div className={`flex items-center justify-between flex-wrap gap-2 rounded-xl border p-2 text-xs ${
                  isDark ? 'border-neutral-800 bg-[#161924]' : 'border-slate-300 bg-slate-50'
                }`}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[11px] font-bold flex items-center gap-1 ${isDark ? 'text-violet-400' : 'text-violet-700'}`}>
                      <Sparkles className="h-3.5 w-3.5" /> Presets:
                    </span>
                    <button
                      type="button"
                      onClick={() => jsonEditorRef.current?.replaceValue(JSON_SAMPLE_TEMPLATE)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                        isDark
                          ? 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/40 border-violet-500/30'
                          : 'bg-violet-100 text-violet-800 hover:bg-violet-200 border-violet-300'
                      }`}
                      title="Insert sample JSON object"
                    >
                      Sample JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => jsonEditorRef.current?.replaceValue(JSON_EMPTY_TEMPLATE)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                        isDark
                          ? 'bg-neutral-700/40 text-slate-300 hover:bg-neutral-700/60 border-neutral-600/40'
                          : 'bg-slate-200 text-slate-800 hover:bg-slate-300 border-slate-300'
                      }`}
                      title="Insert empty JSON object"
                    >
                      {'{ }'}
                    </button>
                    <button
                      type="button"
                      onClick={() => jsonEditorRef.current?.replaceValue(JSON_ARRAY_TEMPLATE)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                        isDark
                          ? 'bg-neutral-700/40 text-slate-300 hover:bg-neutral-700/60 border-neutral-600/40'
                          : 'bg-slate-200 text-slate-800 hover:bg-slate-300 border-slate-300'
                      }`}
                      title="Insert JSON array"
                    >
                      {'[ ]'}
                    </button>
                    <button
                      type="button"
                      onClick={() => jsonEditorRef.current?.replaceValue('')}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                        isDark ? 'text-slate-400 hover:text-rose-400' : 'text-slate-600 hover:text-rose-600'
                      }`}
                      title="Clear JSON body"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={beautifyPayload}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition flex items-center gap-1 cursor-pointer ${
                        isDark
                          ? 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/40 border-violet-500/30'
                          : 'bg-violet-100 text-violet-800 hover:bg-violet-200 border-violet-300'
                      }`}
                      title="Format and beautify JSON"
                    >
                      <Wand2 className="h-3 w-3" />
                      <span>Beautify JSON</span>
                    </button>

                    {jsonValidation.needsQuotesFor.length > 0 && (
                      <span
                        title={`"${jsonValidation.needsQuotesFor[0]}" resolves to a string in ${activeEnv?.name || 'Env'} — wrap as "{{${jsonValidation.needsQuotesFor[0]}}}" for valid JSON`}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          isDark
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : 'bg-amber-100 text-amber-800 border-amber-300'
                        }`}
                      >
                        Quote {`{{${jsonValidation.needsQuotesFor[0]}}}`}
                      </span>
                    )}

                    {!isJsonValid && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        isDark
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                          : 'bg-rose-100 text-rose-700 border-rose-300'
                      }`}>
                        Invalid JSON
                      </span>
                    )}
                  </div>
                </div>

                {/* Syntax-Highlighted JSON Editor with Line Numbers & Collapsible Braces */}
                <CodeInputEditor
                  ref={jsonEditorRef}
                  value={jsonDisplayText}
                  onChange={(val) => {
                    onChange({
                      ...request,
                      body: {
                        ...request.body,
                        type: 'json',
                        raw: val,
                        jsonBody: val,
                      },
                    });
                  }}
                  language="json"
                  placeholder={'{\n  "name": "value"\n}'}
                  isDark={isDark}
                  activeEnv={activeEnv}
                />
              </div>
            )}

            {/* 4. FORM URL-ENCODED OR RAW VIEW */}
            {(request.body.type === 'x-www-form-urlencoded' || request.body.type === 'raw') && (
              <CodeInputEditor
                value={
                  request.body.type === 'x-www-form-urlencoded'
                    ? request.body.formBody ?? request.body.raw ?? ''
                    : request.body.rawBody ?? request.body.raw ?? ''
                }
                onChange={(val) => {
                  if (request.body.type === 'x-www-form-urlencoded') {
                    onChange({
                      ...request,
                      body: { ...request.body, raw: val, formBody: val },
                    });
                  } else {
                    onChange({
                      ...request,
                      body: { ...request.body, raw: val, rawBody: val },
                    });
                  }
                }}
                language={request.body.type === 'x-www-form-urlencoded' ? 'form' : 'raw'}
                placeholder={request.body.type === 'x-www-form-urlencoded' ? 'key1=value1&key2=value2' : 'Plain raw body content...'}
                isDark={isDark}
                activeEnv={activeEnv}
              />
            )}

            {/* 5. NONE VIEW */}
            {request.body.type === 'none' && (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                <Ban className="h-8 w-8 text-slate-500" />
                <span className="text-xs text-slate-400">This request does not have a body payload.</span>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => handleSelectBodyType('json')}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-violet-600 text-white hover:bg-violet-500 transition cursor-pointer shadow-md"
                  >
                    Add JSON Body
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectBodyType('xml')}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition cursor-pointer shadow-md"
                  >
                    Add XML / SOAP Body
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectBodyType('graphql')}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition cursor-pointer shadow-md"
                  >
                    Add GraphQL Query
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Query Params Panel */}
        {activeTab === 'params' && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-slate-400">Query String Parameters</span>
            <KeyValueTable
              items={request.queryParams}
              onChange={handleParamsChange}
              keyPlaceholder="Parameter"
              valuePlaceholder="Value"
              activeEnv={activeEnv}
            />
          </div>
        )}

        {/* Headers Panel */}
        {activeTab === 'headers' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400">Request Headers</span>
              {request.body.type === 'xml' && (
                <button
                  type="button"
                  onClick={() => addSoapActionHeader()}
                  className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/40 cursor-pointer"
                >
                  + Add SOAPAction
                </button>
              )}
            </div>
            <KeyValueTable
              items={request.headers}
              onChange={(newHeaders) => updateRequest('headers', newHeaders)}
              keyPlaceholder="Header"
              valuePlaceholder="Value"
              activeEnv={activeEnv}
            />
          </div>
        )}

        {/* Scripts Panel */}
        {activeTab === 'scripts' && (
          <div className="flex flex-col gap-4 overflow-y-auto pr-1 flex-1 min-h-0">
            <div className="flex flex-col gap-2">
              <span className={`text-xs font-bold ${isDark ? 'text-violet-400' : 'text-violet-700'}`}>
                Pre-Request Script (Runs before sending)
              </span>
              <CodeInputEditor
                value={request.preRequestScript || ''}
                onChange={(val) => updateRequest('preRequestScript', val)}
                language="js"
                placeholder="// pulse.setEnv('timestamp', Date.now().toString());"
                isDark={isDark}
                activeEnv={activeEnv}
                minHeightClass="min-h-[120px]"
              />
            </div>

            <div className="flex flex-col gap-2 flex-1 min-h-0">
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                  Post-Response Tests (Runs after receiving)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const snippet = `pulse.test("Status is 200", () => pulse.expect(response.status).toBe(200));\n`;
                      updateRequest('postResponseScript', (request.postResponseScript || '') + snippet);
                    }}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border cursor-pointer ${
                      isDark
                        ? 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/40 border-violet-500/30'
                        : 'bg-violet-100 text-violet-800 hover:bg-violet-200 border-violet-300'
                    }`}
                  >
                    + Status 200
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const snippet = `const data = response.json();\npulse.setEnv("token", data.token);\n`;
                      updateRequest('postResponseScript', (request.postResponseScript || '') + snippet);
                    }}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border cursor-pointer ${
                      isDark
                        ? 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/40 border-violet-500/30'
                        : 'bg-violet-100 text-violet-800 hover:bg-violet-200 border-violet-300'
                    }`}
                  >
                    + Extract Token
                  </button>
                </div>
              </div>
              <CodeInputEditor
                value={request.postResponseScript || ''}
                onChange={(val) => updateRequest('postResponseScript', val)}
                language="js"
                placeholder="// pulse.test('Status is 200', () => pulse.expect(response.status).toBe(200));"
                isDark={isDark}
                activeEnv={activeEnv}
                minHeightClass="min-h-[150px]"
              />
            </div>
          </div>
        )}

        {/* Load Test Panel */}
        {activeTab === 'loadtest' && (
          <div className="h-full">
            <LoadTestPanel request={request} activeEnv={activeEnv} />
          </div>
        )}
      </div>

      {/* Bottom Bar: Beautifier Action & Format Info */}
      <div className={`flex items-center justify-between border-t px-3 py-1.5 text-xs select-none ${
        isDark ? 'border-neutral-800/80 bg-[#10121a]' : 'border-slate-200 bg-slate-100'
      }`}>
        {request.body.type !== 'none' ? (
          <button
            onClick={beautifyPayload}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-neutral-800' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
            title={`Format ${currentBodyOption.label} with proper indentation`}
          >
            <Wand2 className="h-3 w-3 text-violet-400" />
            <span>
              {request.body.type === 'xml'
                ? 'Beautify XML'
                : request.body.type === 'graphql'
                  ? 'Format Variables'
                  : 'Beautify JSON'}
            </span>
          </button>
        ) : (
          <span className="text-[11px] text-slate-500">No Body</span>
        )}

        <span className="text-[10px] text-slate-500 font-mono">
          {currentBodyOption.label} • UTF-8
        </span>
      </div>
    </div>
  );
};
