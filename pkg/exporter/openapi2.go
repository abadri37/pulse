package exporter

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"pulse/pkg/engine"
	"pulse/pkg/storage"
)

var nonAlnumRe = regexp.MustCompile(`[^a-zA-Z0-9]+`)

// OpenAPI2Spec represents an OpenAPI v2 (Swagger 2.0) JSON document.
type OpenAPI2Spec struct {
	Swagger  string                                 `json:"swagger"`
	Info     OpenAPI2Info                           `json:"info"`
	Host     string                                 `json:"host,omitempty"`
	BasePath string                                 `json:"basePath,omitempty"`
	Schemes  []string                               `json:"schemes,omitempty"`
	Paths    map[string]map[string]OpenAPI2Operation `json:"paths"`
}

type OpenAPI2Info struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Version     string `json:"version"`
}

type OpenAPI2Operation struct {
	Summary     string                        `json:"summary,omitempty"`
	OperationID string                        `json:"operationId,omitempty"`
	Tags        []string                      `json:"tags,omitempty"`
	Consumes    []string                      `json:"consumes,omitempty"`
	Produces    []string                      `json:"produces,omitempty"`
	Parameters  []OpenAPI2Parameter           `json:"parameters,omitempty"`
	Responses   map[string]OpenAPI2Response   `json:"responses"`
}

type OpenAPI2Parameter struct {
	Name        string                 `json:"name"`
	In          string                 `json:"in"`
	Description string                 `json:"description,omitempty"`
	Required    bool                   `json:"required,omitempty"`
	Type        string                 `json:"type,omitempty"`
	Default     interface{}            `json:"default,omitempty"`
	Schema      map[string]interface{} `json:"schema,omitempty"`
}

type OpenAPI2Response struct {
	Description string `json:"description"`
}

func sanitizeOpID(s string) string {
	cleaned := strings.Trim(nonAlnumRe.ReplaceAllString(s, "_"), "_")
	if cleaned == "" {
		return "operation"
	}
	return cleaned
}

func parseRequestURL(rawURL string) (scheme string, host string, path string, inlineQuery []engine.ParamPair) {
	scheme = "http"
	host = "localhost"
	path = "/"

	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return
	}

	// Replace template placeholders like {{baseUrl}} temporarily for URL parsing
	sanitized := trimmed
	if strings.HasPrefix(sanitized, "{{") {
		if idx := strings.Index(sanitized, "}}"); idx != -1 {
			rest := sanitized[idx+2:]
			if rest == "" || strings.HasPrefix(rest, "/") || strings.HasPrefix(rest, "?") {
				sanitized = "http://localhost" + rest
			}
		}
	}

	u, err := url.Parse(sanitized)
	if err != nil {
		return
	}
	if u.Scheme != "" {
		scheme = u.Scheme
	}
	if u.Host != "" {
		host = u.Host
	}
	if u.Path != "" {
		path = u.Path
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}
	}
	for k, vals := range u.Query() {
		val := ""
		if len(vals) > 0 {
			val = vals[0]
		}
		inlineQuery = append(inlineQuery, engine.ParamPair{
			Key:     k,
			Value:   val,
			Enabled: true,
		})
	}
	return
}

func inferJSONSchema(raw string) map[string]interface{} {
	var parsed interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return map[string]interface{}{
			"type":    "string",
			"example": raw,
		}
	}

	switch v := parsed.(type) {
	case map[string]interface{}:
		props := make(map[string]interface{}, len(v))
		for k, val := range v {
			propType := "string"
			switch val.(type) {
			case float64, int:
				propType = "number"
			case bool:
				propType = "boolean"
			case []interface{}:
				propType = "array"
			case map[string]interface{}:
				propType = "object"
			}
			props[k] = map[string]interface{}{
				"type":    propType,
				"example": val,
			}
		}
		return map[string]interface{}{
			"type":       "object",
			"properties": props,
			"example":    v,
		}
	case []interface{}:
		return map[string]interface{}{
			"type":    "array",
			"items":   map[string]interface{}{"type": "object"},
			"example": v,
		}
	default:
		return map[string]interface{}{
			"type":    "string",
			"example": raw,
		}
	}
}

type taggedRequest struct {
	req storage.SavedRequest
	tag string
}

func flattenCollectionRequests(coll storage.Collection, defaultTag string) []taggedRequest {
	var out []taggedRequest
	for _, r := range coll.Requests {
		out = append(out, taggedRequest{req: r, tag: defaultTag})
	}
	for _, sub := range coll.Folders {
		subTag := strings.TrimSpace(sub.Name)
		if subTag == "" {
			subTag = defaultTag
		}
		out = append(out, flattenCollectionRequests(sub, subTag)...)
	}
	return out
}

// CollectionToOpenAPI2 converts a Pulse Collection into an OpenAPI v2 (Swagger 2.0) spec.
func CollectionToOpenAPI2(coll storage.Collection, appVersion string) OpenAPI2Spec {
	if strings.TrimSpace(appVersion) == "" {
		appVersion = "1.0.0"
	}
	title := strings.TrimSpace(coll.Name)
	if title == "" {
		title = "Pulse Exported API"
	}

	spec := OpenAPI2Spec{
		Swagger: "2.0",
		Info: OpenAPI2Info{
			Title:       title,
			Description: fmt.Sprintf("OpenAPI v2 specification exported from Pulse v%s", appVersion),
			Version:     appVersion,
		},
		BasePath: "/",
		Paths:    make(map[string]map[string]OpenAPI2Operation),
	}

	schemeSet := make(map[string]bool)
	opCounter := 0

	for _, item := range flattenCollectionRequests(coll, title) {
		req := item.req
		opTag := item.tag
		scheme, host, reqPath, inlineQuery := parseRequestURL(req.URL)
		if spec.Host == "" && host != "" {
			spec.Host = host
		}
		if scheme != "" && !schemeSet[scheme] {
			schemeSet[scheme] = true
			spec.Schemes = append(spec.Schemes, scheme)
		}

		method := strings.ToLower(strings.TrimSpace(req.Method))
		if method == "" {
			method = "get"
		}

		// Disambiguate only if exact (path, method) collides (e.g., multiple POSTs to /graphql or /soap)
		targetPath := reqPath
		if existingMethods, exists := spec.Paths[targetPath]; exists {
			if _, methodTaken := existingMethods[method]; methodTaken {
				opCounter++
				targetPath = fmt.Sprintf("%s?op=%s_%d", reqPath, sanitizeOpID(req.Name), opCounter)
			}
		}
		if spec.Paths[targetPath] == nil {
			spec.Paths[targetPath] = make(map[string]OpenAPI2Operation)
		}

		var params []OpenAPI2Parameter
		seenQuery := make(map[string]bool)

		for _, q := range req.QueryParams {
			if q.Enabled && strings.TrimSpace(q.Key) != "" && !seenQuery[q.Key] {
				seenQuery[q.Key] = true
				params = append(params, OpenAPI2Parameter{
					Name:    q.Key,
					In:      "query",
					Type:    "string",
					Default: q.Value,
				})
			}
		}
		for _, q := range inlineQuery {
			if strings.TrimSpace(q.Key) != "" && !seenQuery[q.Key] {
				seenQuery[q.Key] = true
				params = append(params, OpenAPI2Parameter{
					Name:    q.Key,
					In:      "query",
					Type:    "string",
					Default: q.Value,
				})
			}
		}

		var consumes []string
		for _, h := range req.Headers {
			if !h.Enabled || strings.TrimSpace(h.Key) == "" {
				continue
			}
			if strings.EqualFold(h.Key, "Content-Type") {
				consumes = append(consumes, h.Value)
				continue
			}
			params = append(params, OpenAPI2Parameter{
				Name:    h.Key,
				In:      "header",
				Type:    "string",
				Default: h.Value,
			})
		}

		bodyType := strings.ToLower(strings.TrimSpace(req.Body.Type))
		hasRaw := strings.TrimSpace(req.Body.Raw) != ""
		if bodyType != "none" && hasRaw {
			switch bodyType {
			case "x-www-form-urlencoded":
				if len(consumes) == 0 {
					consumes = []string{"application/x-www-form-urlencoded"}
				}
				vals, err := url.ParseQuery(req.Body.Raw)
				if err == nil && len(vals) > 0 {
					for k, v := range vals {
						def := ""
						if len(v) > 0 {
							def = v[0]
						}
						params = append(params, OpenAPI2Parameter{
							Name:    k,
							In:      "formData",
							Type:    "string",
							Default: def,
						})
					}
				}
			case "xml", "soap":
				if len(consumes) == 0 {
					consumes = []string{"text/xml"}
				}
				params = append(params, OpenAPI2Parameter{
					Name:     "body",
					In:       "body",
					Required: true,
					Schema: map[string]interface{}{
						"type":    "string",
						"example": req.Body.Raw,
					},
				})
			case "raw":
				if len(consumes) == 0 {
					consumes = []string{"text/plain"}
				}
				params = append(params, OpenAPI2Parameter{
					Name:     "body",
					In:       "body",
					Required: true,
					Schema: map[string]interface{}{
						"type":    "string",
						"example": req.Body.Raw,
					},
				})
			default: // json, graphql
				if len(consumes) == 0 {
					consumes = []string{"application/json"}
				}
				params = append(params, OpenAPI2Parameter{
					Name:     "body",
					In:       "body",
					Required: true,
					Schema:   inferJSONSchema(req.Body.Raw),
				})
			}
		}

		if len(consumes) == 0 && (method == "post" || method == "put" || method == "patch") {
			consumes = []string{"application/json"}
		}

		produces := []string{"application/json"}
		if bodyType == "xml" || bodyType == "soap" {
			produces = []string{"text/xml"}
		}

		opCounter++
		op := OpenAPI2Operation{
			Summary:     req.Name,
			OperationID: fmt.Sprintf("%s_%s_%d", method, sanitizeOpID(req.Name), opCounter),
			Tags:        []string{opTag},
			Consumes:    consumes,
			Produces:    produces,
			Parameters:  params,
			Responses: map[string]OpenAPI2Response{
				"200": {Description: "Successful response"},
			},
		}

		spec.Paths[targetPath][method] = op
	}

	if spec.Host == "" {
		spec.Host = "localhost"
	}
	if len(spec.Schemes) == 0 {
		spec.Schemes = []string{"http"}
	}

	return spec
}
