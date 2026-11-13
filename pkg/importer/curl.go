package importer

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"pulse/pkg/engine"
	"pulse/pkg/storage"
	"regexp"
	"strings"
	"time"
)

// misencodedClosingQuoteRe matches a URL-encoded single quote (%27, case
// insensitive) that sits right where a real closing shell quote would be
// expected: immediately before whitespace/line-continuation followed by the
// next curl flag (e.g. `...pageSize=500%27 \` then `--header '...'`). This is
// a common artifact from tools that percent-encode a trailing quote instead
// of leaving it as a literal shell metacharacter, which otherwise causes the
// quoted argument to run on and swallow subsequent flags entirely.
var misencodedClosingQuoteRe = regexp.MustCompile(`(?i)%27(\s*\\?\s*\n?\s*(?:--[A-Za-z][A-Za-z-]*|-[A-Za-z])\b)`)

// fixMisencodedClosingQuotes rewrites a trailing %27 back into a literal
// single quote when followed by another flag so that tokens split properly
// and subsequent flags (e.g. `--header`) aren't lost when curl commands
// are copy-pasted from tools that erroneously URL-encoded shell syntax.
func fixMisencodedClosingQuotes(curlCmd string) string {
	return misencodedClosingQuoteRe.ReplaceAllString(curlCmd, "'$1")
}

// ParseCurlCommand converts a curl command line string into a SavedRequest
func ParseCurlCommand(curlCmd string) (storage.SavedRequest, error) {
	curlCmd = fixMisencodedClosingQuotes(curlCmd)
	tokens := tokenizeCurlCommand(curlCmd)
	if len(tokens) == 0 {
		return storage.SavedRequest{}, fmt.Errorf("empty curl command")
	}

	method := ""
	rawURL := ""
	var headers []engine.HeaderPair
	var queryParams []engine.ParamPair
	var bodyData []string
	var formFields []string
	isFormData := false
	forceGet := false

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
		case "-d", "--data", "--data-raw", "--data-binary", "--data-ascii":
			if i+1 < len(tokens) {
				bodyData = append(bodyData, tokens[i+1])
				if method == "" {
					method = "POST"
				}
				i++
			}
		case "--data-urlencode":
			if i+1 < len(tokens) {
				bodyData = append(bodyData, decodeDataURLEncodeArg(tokens[i+1]))
				if method == "" {
					method = "POST"
				}
				i++
			}
		case "-F", "--form", "--form-string":
			// Multipart form fields (e.g. "name=foo" or "file=@/path/to/file"). Pulse's
			// current body model has no multipart type, so these are captured as
			// x-www-form-urlencoded key/value pairs rather than silently dropped; file
			// uploads (the "@path" form) keep the path as a visible placeholder value.
			if i+1 < len(tokens) {
				formFields = append(formFields, tokens[i+1])
				isFormData = true
				if method == "" {
					method = "POST"
				}
				i++
			}
		case "-u", "--user":
			if i+1 < len(tokens) {
				encoded := base64.StdEncoding.EncodeToString([]byte(tokens[i+1]))
				headers = append(headers, engine.HeaderPair{
					Key:     "Authorization",
					Value:   "Basic " + encoded,
					Enabled: true,
				})
				i++
			}
		case "-b", "--cookie":
			if i+1 < len(tokens) {
				headers = append(headers, engine.HeaderPair{
					Key:     "Cookie",
					Value:   tokens[i+1],
					Enabled: true,
				})
				i++
			}
		case "-A", "--user-agent":
			if i+1 < len(tokens) {
				headers = append(headers, engine.HeaderPair{
					Key:     "User-Agent",
					Value:   tokens[i+1],
					Enabled: true,
				})
				i++
			}
		case "-e", "--referer":
			if i+1 < len(tokens) {
				headers = append(headers, engine.HeaderPair{
					Key:     "Referer",
					Value:   tokens[i+1],
					Enabled: true,
				})
				i++
			}
		case "-G", "--get":
			forceGet = true
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

	// "-G"/"--get" tells curl to send any "-d" data as URL query parameters on a GET
	// request instead of as the request body.
	if forceGet {
		method = "GET"
		for _, d := range bodyData {
			parts := strings.SplitN(d, "=", 2)
			if len(parts) == 2 {
				queryParams = append(queryParams, engine.ParamPair{Key: parts[0], Value: parts[1], Enabled: true})
			} else {
				queryParams = append(queryParams, engine.ParamPair{Key: parts[0], Value: "", Enabled: true})
			}
		}
		bodyData = nil
	}

	if method == "" {
		if len(bodyData) > 0 || len(formFields) > 0 {
			method = "POST"
		} else {
			method = "GET"
		}
	}

	var rawBody string
	bodyType := "none"
	if isFormData {
		rawBody = strings.Join(formFields, "&")
		bodyType = "x-www-form-urlencoded"
	} else {
		// curl concatenates multiple "-d"/"--data*" values with "&" (not a newline) before
		// sending them as a single body, which matters most for form-encoded bodies built
		// from several "-d key=value" flags; joining with "\n" instead would corrupt them.
		rawBody = strings.Join(bodyData, "&")
		if len(rawBody) > 0 {
			trimmed := strings.TrimSpace(rawBody)
			if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
				bodyType = "json"
			} else if isLikelyFormEncoded(bodyData) {
				bodyType = "x-www-form-urlencoded"
			} else {
				bodyType = "raw"
			}
		}
	}

	return storage.SavedRequest{
		ID:             fmt.Sprintf("req_curl_%d", time.Now().Unix()),
		Name:           fmt.Sprintf("%s %s", method, sanitizeURLForName(rawURL)),
		Collection:     "cURL Imports",
		Method:         method,
		URL:            rawURL,
		Headers:        headers,
		QueryParams:    queryParams,
		Body: engine.RequestBody{
			Type: bodyType,
			Raw:  rawBody,
		},
		LastModifiedAt: time.Now().Unix(),
	}, nil
}

// isLikelyFormEncoded reports whether multiple "-d"/"--data*" pieces look like separate
// "key=value" form fields (curl's documented use case for joining them with "&"), as opposed to
// a single raw/JSON body that merely contains an "=" character.
func isLikelyFormEncoded(bodyData []string) bool {
	if len(bodyData) < 2 {
		return false
	}
	for _, d := range bodyData {
		trimmed := strings.TrimSpace(d)
		if trimmed == "" || !strings.Contains(trimmed, "=") {
			return false
		}
		if strings.ContainsAny(trimmed, "{}[]") {
			return false
		}
	}
	return true
}

// decodeDataURLEncodeArg handles curl's "--data-urlencode" argument forms:
// "content" (whole value is urlencoded), "name=content" (only content is urlencoded), and
// "name@file"/"@file" (read from file, not supported here, kept as a visible placeholder).
func decodeDataURLEncodeArg(arg string) string {
	if strings.Contains(arg, "@") {
		// File-content form; we can't read the original file, so leave a clear placeholder
		// instead of silently dropping the field.
		return arg
	}
	if idx := strings.Index(arg, "="); idx >= 0 {
		name := arg[:idx]
		value := arg[idx+1:]
		return name + "=" + url.QueryEscape(value)
	}
	return url.QueryEscape(arg)
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
			// A backslash immediately followed by a newline (or a carriage return leading
			// into one) outside quotes is a shell line continuation, e.g. a multi-line
			// curl command copied from Postman/browser dev tools with no leading
			// indentation on the next line. It must be dropped entirely rather than kept
			// as a literal character, otherwise it silently glues onto the start of the
			// next flag (producing a mangled token like "\n--header" that matches no known
			// flag), causing that flag and everything after it to be lost.
			if !inSingleQuote && !inDoubleQuote && r == '\r' {
				continue // wait for the following '\n' while still "escaped"
			}
			if !inSingleQuote && !inDoubleQuote && (r == '\n' || r == ' ' || r == '\t') {
				// A backslash followed by a newline (shell line continuation) or by
				// plain whitespace (the same continuation after line breaks were
				// collapsed by copy/paste) should just be dropped outside quotes.
				// Treating it as "escape this whitespace into a literal character"
				// instead would glue a stray leading space onto the next flag (e.g.
				// producing " --header" instead of "--header"), silently dropping
				// that flag because it matches no known switch case.
				escaped = false
				continue
			}
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
