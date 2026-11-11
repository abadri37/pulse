package importer

import (
	"fmt"
	"pulse/pkg/engine"
	"pulse/pkg/storage"
	"strings"
	"time"
)

// ParseCurlCommand converts a curl command line string into a SavedRequest
func ParseCurlCommand(curlCmd string) (storage.SavedRequest, error) {
	tokens := tokenizeCurlCommand(curlCmd)
	if len(tokens) == 0 {
		return storage.SavedRequest{}, fmt.Errorf("empty curl command")
	}

	method := ""
	rawURL := ""
	var headers []engine.HeaderPair
	var bodyData []string

	for i := 0; i < len(tokens); i++ {
		t := tokens[i]

		switch t {
		case "curl":
			continue
		case "-X", "--request":
			if i+1 < len(tokens) {
				method = strings.ToUpper(tokens[i+1])
				i++
			}
		case "-H", "--header":
			if i+1 < len(tokens) {
				headerStr := tokens[i+1]
				parts := strings.SplitN(headerStr, ":", 2)
				if len(parts) == 2 {
					headers = append(headers, engine.HeaderPair{
						Key:     strings.TrimSpace(parts[0]),
						Value:   strings.TrimSpace(parts[1]),
						Enabled: true,
					})
				}
				i++
			}
		case "-d", "--data", "--data-raw", "--data-binary":
			if i+1 < len(tokens) {
				bodyData = append(bodyData, tokens[i+1])
				if method == "" {
					method = "POST"
				}
				i++
			}
		default:
			// If not a flag, it might be the URL
			if strings.HasPrefix(t, "http://") || strings.HasPrefix(t, "https://") || (!strings.HasPrefix(t, "-") && rawURL == "") {
				rawURL = t
			}
		}
	}

	if rawURL == "" {
		return storage.SavedRequest{}, fmt.Errorf("could not find a valid URL in the curl command")
	}

	if method == "" {
		if len(bodyData) > 0 {
			method = "POST"
		} else {
			method = "GET"
		}
	}

	rawBody := strings.Join(bodyData, "\n")
	bodyType := "none"
	if len(rawBody) > 0 {
		trimmed := strings.TrimSpace(rawBody)
		if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
			bodyType = "json"
		} else {
			bodyType = "raw"
		}
	}

	return storage.SavedRequest{
		ID:             fmt.Sprintf("req_curl_%d", time.Now().Unix()),
		Name:           fmt.Sprintf("%s %s", method, sanitizeURLForName(rawURL)),
		Collection:     "cURL Imports",
		Method:         method,
		URL:            rawURL,
		Headers:        headers,
		QueryParams:    nil,
		Body: engine.RequestBody{
			Type: bodyType,
			Raw:  rawBody,
		},
		LastModifiedAt: time.Now().Unix(),
	}, nil
}

// tokenizeCurlCommand splits a curl command respecting single and double quotes
func tokenizeCurlCommand(cmd string) []string {
	var tokens []string
	var current strings.Builder
	inSingleQuote := false
	inDoubleQuote := false
	escaped := false

	for _, r := range cmd {
		if escaped {
			current.WriteRune(r)
			escaped = false
			continue
		}

		if r == '\\' {
			escaped = true
			continue
		}

		if r == '\'' && !inDoubleQuote {
			inSingleQuote = !inSingleQuote
			continue
		}

		if r == '"' && !inSingleQuote {
			inDoubleQuote = !inDoubleQuote
			continue
		}

		if (r == ' ' || r == '\t' || r == '\n' || r == '\r') && !inSingleQuote && !inDoubleQuote {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			continue
		}

		current.WriteRune(r)
	}

	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}

	return tokens
}

func sanitizeURLForName(u string) string {
	parts := strings.Split(u, "?")
	clean := parts[0]
	if len(clean) > 40 {
		return clean[:40] + "..."
	}
	return clean
}
