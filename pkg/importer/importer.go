package importer

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"pulse/pkg/engine"
	"pulse/pkg/storage"
	"strings"
	"time"
)

// CollectionDocument represents the Collection v2.0 / v2.1 JSON schema
type CollectionDocument struct {
	Info struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Schema      string `json:"schema"`
	} `json:"info"`
	Item []CollectionItemNode `json:"item"`
}

// CollectionItemNode can represent a folder or a request
type CollectionItemNode struct {
	Name    string                 `json:"name"`
	Item    []CollectionItemNode   `json:"item,omitempty"` // Nested items / folders
	Request *CollectionRequestSpec `json:"request,omitempty"`
	Event   []CollectionEvent      `json:"event,omitempty"`
}

// CollectionEvent holds pre-request or post-response scripts in collection JSON
type CollectionEvent struct {
	Listen string `json:"listen"`
	Script struct {
		Exec []string `json:"exec"`
	} `json:"script"`
}

// CollectionRequestSpec holds method, url, headers, and body
type CollectionRequestSpec struct {
	Method string `json:"method"`
	Header []struct {
		Key      string `json:"key"`
		Value    string `json:"value"`
		Disabled bool   `json:"disabled,omitempty"`
	} `json:"header"`
	Body *struct {
		Mode    string `json:"mode"`
		Raw     string `json:"raw"`
		Options *struct {
			Raw *struct {
				Language string `json:"language"`
			} `json:"raw"`
		} `json:"options,omitempty"`
	} `json:"body"`
	URL json.RawMessage `json:"url"` // Can be string or struct {"raw": "..."}
}

// CollectionURLSpec represents a structured URL object in collection JSON
type CollectionURLSpec struct {
	Raw   string `json:"raw"`
	Query []struct {
		Key      string `json:"key"`
		Value    string `json:"value"`
		Disabled bool   `json:"disabled,omitempty"`
	} `json:"query"`
}

type swagger2Doc struct {
	Swagger  string   `json:"swagger"`
	Host     string   `json:"host"`
	BasePath string   `json:"basePath"`
	Schemes  []string `json:"schemes"`
	Info     struct {
		Title string `json:"title"`
	} `json:"info"`
	Paths map[string]map[string]struct {
		Summary    string   `json:"summary"`
		Consumes   []string `json:"consumes"`
		Parameters []struct {
			Name    string                 `json:"name"`
			In      string                 `json:"in"`
			Default interface{}            `json:"default"`
			Schema  map[string]interface{} `json:"schema"`
		} `json:"parameters"`
	} `json:"paths"`
}

func parseOpenAPIv2(content string) (string, []storage.SavedRequest, error) {
	var doc swagger2Doc
	if err := json.Unmarshal([]byte(content), &doc); err != nil {
		return "", nil, fmt.Errorf("invalid OpenAPI v2 JSON: %w", err)
	}
	collName := strings.TrimSpace(doc.Info.Title)
	if collName == "" {
		collName = "Imported OpenAPI v2"
	}
	scheme := "http"
	if len(doc.Schemes) > 0 && doc.Schemes[0] != "" {
		scheme = doc.Schemes[0]
	}
	host := strings.TrimSpace(doc.Host)
	if host == "" {
		host = "localhost"
	}
	basePath := strings.TrimRight(doc.BasePath, "/")

	var requests []storage.SavedRequest
	idx := 0
	for p, methods := range doc.Paths {
		cleanPath := strings.SplitN(p, "?", 2)[0]
		if !strings.HasPrefix(cleanPath, "/") {
			cleanPath = "/" + cleanPath
		}
		fullURL := fmt.Sprintf("%s://%s%s%s", scheme, host, basePath, cleanPath)

		for m, op := range methods {
			idx++
			method := strings.ToUpper(m)
			var headers []engine.HeaderPair
			var queryParams []engine.ParamPair
			var formParts []string
			body := engine.RequestBody{Type: "none", Raw: ""}

			for _, c := range op.Consumes {
				if c != "" {
					headers = append(headers, engine.HeaderPair{Key: "Content-Type", Value: c, Enabled: true})
					break
				}
			}

			for _, param := range op.Parameters {
				defStr := ""
				if param.Default != nil {
					defStr = fmt.Sprintf("%v", param.Default)
				}
				switch strings.ToLower(param.In) {
				case "query":
					queryParams = append(queryParams, engine.ParamPair{Key: param.Name, Value: defStr, Enabled: true})
				case "header":
					headers = append(headers, engine.HeaderPair{Key: param.Name, Value: defStr, Enabled: true})
				case "formdata":
					formParts = append(formParts, fmt.Sprintf("%s=%s", param.Name, defStr))
				case "body":
					bodyType := "json"
					for _, c := range op.Consumes {
						if strings.Contains(strings.ToLower(c), "xml") {
							bodyType = "xml"
							break
						} else if strings.Contains(strings.ToLower(c), "text/plain") {
							bodyType = "raw"
							break
						}
					}
					raw := ""
					if ex, ok := param.Schema["example"]; ok {
						if s, isStr := ex.(string); isStr {
							raw = s
						} else if b, err := json.MarshalIndent(ex, "", "  "); err == nil {
							raw = string(b)
						}
					}
					body = engine.RequestBody{Type: bodyType, Raw: raw}
				}
			}

			if len(formParts) > 0 {
				body = engine.RequestBody{Type: "x-www-form-urlencoded", Raw: strings.Join(formParts, "&")}
			}

			reqName := strings.TrimSpace(op.Summary)
			if reqName == "" {
				reqName = fmt.Sprintf("%s %s", method, cleanPath)
			}

			requests = append(requests, storage.SavedRequest{
				ID:             fmt.Sprintf("req_oa2_%d_%d", time.Now().UnixNano(), idx),
				Name:           reqName,
				Collection:     collName,
				Method:         method,
				URL:            fullURL,
				Headers:        headers,
				QueryParams:    queryParams,
				Body:           body,
				LastModifiedAt: time.Now().Unix(),
			})
		}
	}
	return collName, requests, nil
}

// ParseCollectionJSON converts Collection v2.0 / v2.1 or OpenAPI v2 (Swagger 2.0) JSON into Pulse saved requests
func ParseCollectionJSON(content string) (string, []storage.SavedRequest, error) {
	var probe struct {
		Swagger string `json:"swagger"`
	}
	if err := json.Unmarshal([]byte(content), &probe); err == nil && strings.HasPrefix(strings.TrimSpace(probe.Swagger), "2.") {
		return parseOpenAPIv2(content)
	}

	var coll CollectionDocument
	if err := json.Unmarshal([]byte(content), &coll); err != nil {
		return "", nil, fmt.Errorf("invalid collection JSON: %w", err)
	}

	collName := strings.TrimSpace(coll.Info.Name)
	if collName == "" {
		collName = "Imported Collection"
	}

	var requests []storage.SavedRequest
	extractCollectionItems(coll.Item, collName, &requests)

	return collName, requests, nil
}

// Recursively walks collection items (handles nested folders)
func extractCollectionItems(items []CollectionItemNode, collectionName string, out *[]storage.SavedRequest) {
	for _, it := range items {
		if len(it.Item) > 0 {
			// Nested folder: recurse
			extractCollectionItems(it.Item, collectionName, out)
		}

		if it.Request != nil {
			req := convertCollectionRequest(it.Name, collectionName, it.Request, it.Event, len(*out))
			*out = append(*out, req)
		}
	}
}

// convertCollectionRequest maps a collection request item into Pulse's SavedRequest model
func convertCollectionRequest(name string, collection string, spec *CollectionRequestSpec, events []CollectionEvent, idx int) storage.SavedRequest {
	method := strings.ToUpper(strings.TrimSpace(spec.Method))
	if method == "" {
		method = "GET"
	}

	// Extract URL and Query Params
	var rawURL string
	var queryParams []engine.ParamPair

	// Try unmarshaling as string first
	var strURL string
	if err := json.Unmarshal(spec.URL, &strURL); err == nil {
		rawURL = strURL
	} else {
		// Try unmarshaling as structured URL object
		var objURL CollectionURLSpec
		if err := json.Unmarshal(spec.URL, &objURL); err == nil {
			rawURL = objURL.Raw
			for _, q := range objURL.Query {
				queryParams = append(queryParams, engine.ParamPair{
					Key:     q.Key,
					Value:   q.Value,
					Enabled: !q.Disabled,
				})
			}
		}
	}

	// Extract Headers
	var headers []engine.HeaderPair
	for _, h := range spec.Header {
		headers = append(headers, engine.HeaderPair{
			Key:     h.Key,
			Value:   h.Value,
			Enabled: !h.Disabled,
		})
	}

	// Extract Body
	var body engine.RequestBody
	if spec.Body != nil {
		bodyType := "raw"
		switch strings.ToLower(spec.Body.Mode) {
		case "urlencoded":
			bodyType = "x-www-form-urlencoded"
		case "graphql":
			bodyType = "graphql"
		case "raw":
			lang := ""
			if spec.Body.Options != nil && spec.Body.Options.Raw != nil {
				lang = strings.ToLower(spec.Body.Options.Raw.Language)
			}
			trimmed := strings.TrimSpace(spec.Body.Raw)
			if lang == "xml" || strings.HasPrefix(trimmed, "<") {
				bodyType = "xml"
			} else if lang == "text" {
				bodyType = "raw"
			} else {
				bodyType = "json"
			}
		}
		body = engine.RequestBody{
			Type: bodyType,
			Raw:  spec.Body.Raw,
		}
	} else {
		body = engine.RequestBody{Type: "none", Raw: ""}
	}

	var preScript, postScript string
	for _, ev := range events {
		joined := strings.Join(ev.Script.Exec, "\n")
		switch strings.ToLower(ev.Listen) {
		case "prerequest":
			preScript = joined
		case "test":
			postScript = joined
		}
	}

	return storage.SavedRequest{
		ID:                 fmt.Sprintf("req_coll_%d_%d", time.Now().UnixNano(), idx),
		Name:               name,
		Collection:         collection,
		Method:             method,
		URL:                rawURL,
		Headers:            headers,
		QueryParams:        queryParams,
		Body:               body,
		PreRequestScript:   preScript,
		PostResponseScript: postScript,
		LastModifiedAt:     time.Now().Unix(),
	}
}

// ParseCSV converts a CSV string into Pulse saved requests
// Expected header row: Name,Method,URL,Headers,Body
func ParseCSV(collectionName string, content string) ([]storage.SavedRequest, error) {
	if collectionName == "" {
		collectionName = "Imported CSV"
	}

	reader := csv.NewReader(strings.NewReader(content))
	reader.TrimLeadingSpace = true

	records, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("failed to parse CSV: %w", err)
	}

	if len(records) < 2 {
		return nil, fmt.Errorf("CSV must have at least a header row and one data row")
	}

	// Find column indices
	headerRow := records[0]
	nameIdx, methodIdx, urlIdx, headersIdx, bodyIdx := -1, -1, -1, -1, -1

	for i, col := range headerRow {
		colLower := strings.ToLower(strings.TrimSpace(col))
		switch colLower {
		case "name", "title", "request_name":
			nameIdx = i
		case "method", "http_method":
			methodIdx = i
		case "url", "endpoint", "path":
			urlIdx = i
		case "headers", "header":
			headersIdx = i
		case "body", "payload":
			bodyIdx = i
		}
	}

	// Fallback to default positional column indices if not found by name
	if urlIdx == -1 && len(headerRow) >= 3 {
		nameIdx = 0
		methodIdx = 1
		urlIdx = 2
		if len(headerRow) >= 4 {
			headersIdx = 3
		}
		if len(headerRow) >= 5 {
			bodyIdx = 4
		}
	}

	if urlIdx == -1 {
		return nil, fmt.Errorf("CSV must contain a 'URL' column")
	}

	var requests []storage.SavedRequest

	for rowNum, row := range records[1:] {
		reqURL := ""
		if urlIdx < len(row) {
			reqURL = strings.TrimSpace(row[urlIdx])
		}
		if reqURL == "" {
			continue // Skip rows without URL
		}

		name := fmt.Sprintf("Request %d", rowNum+1)
		if nameIdx != -1 && nameIdx < len(row) && strings.TrimSpace(row[nameIdx]) != "" {
			name = strings.TrimSpace(row[nameIdx])
		}

		method := "GET"
		if methodIdx != -1 && methodIdx < len(row) && strings.TrimSpace(row[methodIdx]) != "" {
			method = strings.ToUpper(strings.TrimSpace(row[methodIdx]))
		}

		var headers []engine.HeaderPair
		if headersIdx != -1 && headersIdx < len(row) {
			rawHeaders := row[headersIdx]
			// Supports "Key1: Val1\nKey2: Val2" or "Key1: Val1, Key2: Val2"
			headerLines := strings.FieldsFunc(rawHeaders, func(r rune) bool {
				return r == '\n' || r == ';'
			})
			for _, line := range headerLines {
				parts := strings.SplitN(line, ":", 2)
				if len(parts) == 2 {
					headers = append(headers, engine.HeaderPair{
						Key:     strings.TrimSpace(parts[0]),
						Value:   strings.TrimSpace(parts[1]),
						Enabled: true,
					})
				}
			}
		}

		var body engine.RequestBody
		if bodyIdx != -1 && bodyIdx < len(row) && strings.TrimSpace(row[bodyIdx]) != "" {
			rawBody := strings.TrimSpace(row[bodyIdx])
			bodyType := "raw"
			if strings.HasPrefix(rawBody, "{") || strings.HasPrefix(rawBody, "[") {
				bodyType = "json"
			}
			body = engine.RequestBody{
				Type: bodyType,
				Raw:  rawBody,
			}
		} else {
			body = engine.RequestBody{Type: "none", Raw: ""}
		}

		requests = append(requests, storage.SavedRequest{
			ID:             fmt.Sprintf("req_csv_%d_%d", time.Now().Unix(), rowNum),
			Name:           name,
			Collection:     collectionName,
			Method:         method,
			URL:            reqURL,
			Headers:        headers,
			QueryParams:    nil,
			Body:           body,
			LastModifiedAt: time.Now().Unix(),
		})
	}

	return requests, nil
}
