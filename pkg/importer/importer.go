package importer

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"pulse/pkg/engine"
	"pulse/pkg/storage"
	"strings"
	"sync/atomic"
	"time"
)

var importIDCounter uint64

func nextImportID(prefix string) string {
	seq := atomic.AddUint64(&importIDCounter, 1)
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), seq)
}

// CollectionDocument represents the Collection v2.0 / v2.1 JSON schema
type CollectionDocument struct {
	Info struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Schema      string `json:"schema"`
	} `json:"info"`
	Item []CollectionItemNode `json:"item"`
}

// folderRequestsDocument represents nested collection JSON exports using folders[] + requests[]
type folderRequestsDocument struct {
	Name     string                   `json:"name"`
	Folders  []folderRequestsDocument `json:"folders"`
	Requests []folderRequestEntry     `json:"requests"`
}

type folderRequestEntry struct {
	Name       string `json:"name"`
	Method     string `json:"method"`
	Endpoint   string `json:"endpoint"`
	URL        string `json:"url"`
	PreRequest string `json:"preRequestScript"`
	TestScript string `json:"testScript"`
	Params     []struct {
		Key    string `json:"key"`
		Value  string `json:"value"`
		Active *bool  `json:"active"`
	} `json:"params"`
	Headers []struct {
		Key    string `json:"key"`
		Value  string `json:"value"`
		Active *bool  `json:"active"`
	} `json:"headers"`
	Body struct {
		ContentType string `json:"contentType"`
		Body        string `json:"body"`
	} `json:"body"`
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

// ImportResult bundles the root collection name, every folder/subfolder path, and converted requests
type ImportResult struct {
	CollectionName string
	Folders        []string
	Requests       []storage.SavedRequest
}

func sanitizeFolderSegment(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || trimmed == "." || trimmed == ".." {
		return "Folder"
	}
	replacer := strings.NewReplacer("/", "-", "\\", "-", ":", "-", "\x00", "")
	out := strings.TrimSpace(replacer.Replace(trimmed))
	if out == "" {
		return "Folder"
	}
	return out
}

func appendUniqueFolder(folders *[]string, seen map[string]bool, path string) {
	if path == "" || seen[path] {
		return
	}
	seen[path] = true
	*folders = append(*folders, path)
}

// ParseCollectionWithFolders parses Collection v2.0/v2.1 JSON or OpenAPI v2/v3 (JSON/YAML)
// while preserving the full nested folder hierarchy.
func ParseCollectionWithFolders(content string) (ImportResult, error) {
	cleaned := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(content), "\ufeff"))
	if strings.HasPrefix(cleaned, "[") {
		if res, ok := parseCollectionArray(cleaned); ok {
			return res, nil
		}
	}
	if matched, res, err := parseOpenAPISpecWithFolders(cleaned); matched {
		return res, err
	}

	var coll CollectionDocument
	if err := json.Unmarshal([]byte(cleaned), &coll); err != nil {
		return ImportResult{}, fmt.Errorf("invalid specification: expected Collection v2.0/v2.1 JSON or OpenAPI v2/v3 (JSON/YAML): %w", err)
	}

	if len(coll.Item) == 0 && strings.TrimSpace(coll.Info.Name) == "" {
		var nestedDoc folderRequestsDocument
		if err := json.Unmarshal([]byte(cleaned), &nestedDoc); err == nil &&
			(strings.TrimSpace(nestedDoc.Name) != "" || len(nestedDoc.Folders) > 0 || len(nestedDoc.Requests) > 0) {
			return convertFolderRequestsDoc(nestedDoc), nil
		}
	}

	collName := sanitizeFolderSegment(coll.Info.Name)
	if strings.TrimSpace(coll.Info.Name) == "" {
		collName = "Imported Collection"
	}

	seenFolders := map[string]bool{}
	var folders []string
	appendUniqueFolder(&folders, seenFolders, collName)

	var requests []storage.SavedRequest
	extractCollectionItems(coll.Item, collName, &folders, seenFolders, &requests)

	return ImportResult{
		CollectionName: collName,
		Folders:        folders,
		Requests:       requests,
	}, nil
}

func parseCollectionArray(cleaned string) (ImportResult, bool) {
	var rawItems []json.RawMessage
	if err := json.Unmarshal([]byte(cleaned), &rawItems); err != nil || len(rawItems) == 0 {
		return ImportResult{}, false
	}
	seenFolders := map[string]bool{}
	var allFolders []string
	var allRequests []storage.SavedRequest
	firstName := ""
	for _, rawItem := range rawItems {
		res, err := ParseCollectionWithFolders(string(rawItem))
		if err != nil {
			continue
		}
		if firstName == "" {
			firstName = res.CollectionName
		}
		for _, f := range res.Folders {
			appendUniqueFolder(&allFolders, seenFolders, f)
		}
		allRequests = append(allRequests, res.Requests...)
	}
	if len(allFolders) == 0 && len(allRequests) == 0 {
		return ImportResult{}, false
	}
	return ImportResult{
		CollectionName: firstName,
		Folders:        allFolders,
		Requests:       allRequests,
	}, true
}

func convertFolderRequestsDoc(doc folderRequestsDocument) ImportResult {
	rootName := sanitizeFolderSegment(doc.Name)
	if strings.TrimSpace(doc.Name) == "" {
		rootName = "Imported Collection"
	}

	seenFolders := map[string]bool{}
	var folders []string
	var requests []storage.SavedRequest

	var walk func(node folderRequestsDocument, curPath string)
	walk = func(node folderRequestsDocument, curPath string) {
		appendUniqueFolder(&folders, seenFolders, curPath)
		for _, r := range node.Requests {
			method := strings.ToUpper(strings.TrimSpace(r.Method))
			if method == "" {
				method = "GET"
			}
			reqURL := strings.TrimSpace(r.Endpoint)
			if reqURL == "" {
				reqURL = strings.TrimSpace(r.URL)
			}
			var params []engine.ParamPair
			for _, p := range r.Params {
				enabled := true
				if p.Active != nil {
					enabled = *p.Active
				}
				params = append(params, engine.ParamPair{Key: p.Key, Value: p.Value, Enabled: enabled})
			}
			var headers []engine.HeaderPair
			for _, h := range r.Headers {
				enabled := true
				if h.Active != nil {
					enabled = *h.Active
				}
				headers = append(headers, engine.HeaderPair{Key: h.Key, Value: h.Value, Enabled: enabled})
			}
			bodyType := "none"
			if strings.TrimSpace(r.Body.Body) != "" {
				ct := strings.ToLower(r.Body.ContentType)
				switch {
				case strings.Contains(ct, "xml"):
					bodyType = "xml"
				case strings.Contains(ct, "x-www-form-urlencoded"):
					bodyType = "x-www-form-urlencoded"
				case strings.Contains(ct, "text/plain"):
					bodyType = "raw"
				default:
					bodyType = "json"
				}
			}
			requests = append(requests, storage.SavedRequest{
				ID:                 nextImportID("req_coll"),
				Name:               r.Name,
				Collection:         curPath,
				Method:             method,
				URL:                reqURL,
				Headers:            headers,
				QueryParams:        params,
				Body:               engine.RequestBody{Type: bodyType, Raw: r.Body.Body},
				PreRequestScript:   r.PreRequest,
				PostResponseScript: r.TestScript,
				LastModifiedAt:     time.Now().Unix(),
			})
		}
		for _, sub := range node.Folders {
			subName := sanitizeFolderSegment(sub.Name)
			walk(sub, curPath+"/"+subName)
		}
	}

	walk(doc, rootName)
	return ImportResult{
		CollectionName: rootName,
		Folders:        folders,
		Requests:       requests,
	}
}

// ParseCollectionJSON automatically detects OpenAPI v3 (3.0/3.1), OpenAPI v2 (Swagger 2.0)
// in JSON or YAML, or Collection v2.0/v2.1 JSON and converts them into Pulse saved requests.
func ParseCollectionJSON(content string) (string, []storage.SavedRequest, error) {
	res, err := ParseCollectionWithFolders(content)
	if err != nil {
		return "", nil, err
	}
	return res.CollectionName, res.Requests, nil
}

// Recursively walks collection items and preserves every nested folder path
func extractCollectionItems(
	items []CollectionItemNode,
	currentPath string,
	folders *[]string,
	seenFolders map[string]bool,
	out *[]storage.SavedRequest,
) {
	for _, it := range items {
		isFolder := it.Request == nil || len(it.Item) > 0
		if isFolder && it.Request == nil {
			folderName := sanitizeFolderSegment(it.Name)
			subPath := currentPath + "/" + folderName
			appendUniqueFolder(folders, seenFolders, subPath)
			if len(it.Item) > 0 {
				extractCollectionItems(it.Item, subPath, folders, seenFolders, out)
			}
			continue
		}

		if it.Request != nil {
			req := convertCollectionRequest(it.Name, currentPath, it.Request, it.Event, len(*out))
			*out = append(*out, req)
		}

		if len(it.Item) > 0 {
			folderName := sanitizeFolderSegment(it.Name)
			subPath := currentPath + "/" + folderName
			appendUniqueFolder(folders, seenFolders, subPath)
			extractCollectionItems(it.Item, subPath, folders, seenFolders, out)
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
		ID:                 nextImportID("req_coll"),
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
