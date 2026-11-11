package engine

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"pulse/pkg/resolver"
	"strings"
	"time"
)

// Client executes HTTP requests and captures granular network timing
type Client struct {
	httpClient *http.Client
	cookies    *CookieManager
}

// NewClient initializes a new HTTP client engine with tuned transport and cookie jar
func NewClient() *Client {
	transport := &http.Transport{
		MaxIdleConns:        500,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
		DisableCompression: false,
	}

	cm := NewCookieManager()

	return &Client{
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   60 * time.Second,
			Jar:       cm.GetJar(),
		},
		cookies: cm,
	}
}

// GetCookies returns the active cookies for a given URL
func (c *Client) GetCookies(rawURL string) []CookieItem {
	return c.cookies.GetCookies(rawURL)
}

// ClearCookies clears all stored cookies
func (c *Client) ClearCookies() {
	c.cookies.Clear()
}

// BuildResolvedURL resolves {{var}} templates in rawURL and merges enabled queryParams without duplicating identical pairs
func BuildResolvedURL(rawURL string, queryParams []ParamPair, variables map[string]string) (*url.URL, error) {
	resolvedURL := resolver.ResolveString(rawURL, variables)
	parsedURL, err := url.Parse(resolvedURL)
	if err != nil {
		return nil, err
	}

	if parsedURL.Scheme == "" {
		parsedURL.Scheme = "https"
	}

	query := parsedURL.Query()
	for _, p := range queryParams {
		if !p.Enabled || strings.TrimSpace(p.Key) == "" {
			continue
		}
		resolvedKey := resolver.ResolveString(p.Key, variables)
		resolvedVal := resolver.ResolveString(p.Value, variables)
		alreadyPresent := false
		for _, existing := range query[resolvedKey] {
			if existing == resolvedVal {
				alreadyPresent = true
				break
			}
		}
		if !alreadyPresent {
			query.Add(resolvedKey, resolvedVal)
		}
	}
	parsedURL.RawQuery = query.Encode()
	return parsedURL, nil
}

// ResolveEnabledHeaders resolves {{var}} templates in enabled header keys and values
func ResolveEnabledHeaders(headers []HeaderPair, variables map[string]string) []HeaderPair {
	resolved := make([]HeaderPair, 0, len(headers))
	for _, h := range headers {
		if !h.Enabled || strings.TrimSpace(h.Key) == "" {
			continue
		}
		resolved = append(resolved, HeaderPair{
			Key:     resolver.ResolveString(h.Key, variables),
			Value:   resolver.ResolveString(h.Value, variables),
			Enabled: true,
		})
	}
	return resolved
}

// Execute performs an HTTP request and measures full timing metrics
func (c *Client) Execute(req HTTPRequest) HTTPResponse {
	// 1. Resolve variable placeholders in URL, QueryParams, and Body
	parsedURL, err := BuildResolvedURL(req.URL, req.QueryParams, req.Variables)
	if err != nil {
		return HTTPResponse{
			StatusCode: 0,
			Error:      fmt.Sprintf("Invalid URL: %v", err),
		}
	}
	resolvedBody := resolver.ResolveString(req.Body.Raw, req.Variables)

	// 3. Prepare request body reader
	var bodyReader io.Reader
	if req.Body.Type != "none" && resolvedBody != "" {
		bodyReader = strings.NewReader(resolvedBody)
	}

	// 4. Setup Context and Timeout
	timeout := 30 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// 5. Track High-Resolution Network Timings
	var (
		dnsStart, dnsDone     time.Time
		connStart, connDone   time.Time
		tlsStart, tlsDone     time.Time
		wroteRequest          time.Time
		gotFirstByte          time.Time
		downloadDone          time.Time
		totalStart            = time.Now()
	)

	trace := &httptrace.ClientTrace{
		DNSStart: func(_ httptrace.DNSStartInfo) {
			dnsStart = time.Now()
		},
		DNSDone: func(_ httptrace.DNSDoneInfo) {
			dnsDone = time.Now()
		},
		ConnectStart: func(_, _ string) {
			connStart = time.Now()
		},
		ConnectDone: func(_, _ string, _ error) {
			connDone = time.Now()
		},
		TLSHandshakeStart: func() {
			tlsStart = time.Now()
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			tlsDone = time.Now()
		},
		WroteRequest: func(_ httptrace.WroteRequestInfo) {
			wroteRequest = time.Now()
		},
		GotFirstResponseByte: func() {
			gotFirstByte = time.Now()
		},
	}

	traceCtx := httptrace.WithClientTrace(ctx, trace)

	// 6. Build the HTTP Request
	method := strings.ToUpper(req.Method)
	if method == "" {
		method = http.MethodGet
	}

	httpReq, err := http.NewRequestWithContext(traceCtx, method, parsedURL.String(), bodyReader)
	if err != nil {
		return HTTPResponse{
			StatusCode: 0,
			Error:      fmt.Sprintf("Failed to build request: %v", err),
		}
	}

	// 7. Attach User Headers (resolved against active environment variables)
	hasUserAgent := false
	for _, h := range ResolveEnabledHeaders(req.Headers, req.Variables) {
		httpReq.Header.Set(h.Key, h.Value)
		if strings.EqualFold(h.Key, "User-Agent") {
			hasUserAgent = true
		}
	}

	if !hasUserAgent {
		httpReq.Header.Set("User-Agent", "Pulse-API-Client/1.0")
	}

	// Auto-set Content-Type based on body type if not already specified by user
	if httpReq.Header.Get("Content-Type") == "" {
		switch strings.ToLower(req.Body.Type) {
		case "json", "graphql":
			httpReq.Header.Set("Content-Type", "application/json")
		case "xml", "soap":
			httpReq.Header.Set("Content-Type", "text/xml; charset=utf-8")
		case "x-www-form-urlencoded":
			httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		case "raw":
			httpReq.Header.Set("Content-Type", "text/plain; charset=utf-8")
		}
	}

	// Custom transport if InsecureSkipVerify is requested
	execClient := c.httpClient
	if req.InsecureSkipVerify {
		customTransport := &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // #nosec G402
		}
		execClient = &http.Client{
			Transport: customTransport,
			Timeout:   timeout,
			Jar:       c.cookies.GetJar(),
		}
	}

	// 8. Execute HTTP Request
	resp, err := execClient.Do(httpReq)
	if err != nil {
		totalDuration := time.Since(totalStart).Milliseconds()
		return HTTPResponse{
			StatusCode: 0,
			Error:      fmt.Sprintf("Request failed: %v", err),
			Timing: TimingStats{
				TotalDurationMs: totalDuration,
			},
		}
	}
	defer resp.Body.Close()

	// 9. Read Response Body (capped at 50MB to protect memory)
	const maxBodySize = 50 * 1024 * 1024
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, maxBodySize))
	downloadDone = time.Now()

	if err != nil {
		return HTTPResponse{
			StatusCode: resp.StatusCode,
			StatusText: resp.Status,
			Error:      fmt.Sprintf("Error reading response: %v", err),
		}
	}

	// 10. Compute Fine-Grained Timing Durations
	var dnsDuration, tcpDuration, tlsDuration, ttfbDuration, downloadDuration int64

	if !dnsDone.IsZero() && !dnsStart.IsZero() {
		dnsDuration = dnsDone.Sub(dnsStart).Milliseconds()
	}
	if !connDone.IsZero() && !connStart.IsZero() {
		tcpDuration = connDone.Sub(connStart).Milliseconds()
	}
	if !tlsDone.IsZero() && !tlsStart.IsZero() {
		tlsDuration = tlsDone.Sub(tlsStart).Milliseconds()
	}
	if !gotFirstByte.IsZero() && !wroteRequest.IsZero() {
		ttfbDuration = gotFirstByte.Sub(wroteRequest).Milliseconds()
	} else if !gotFirstByte.IsZero() {
		ttfbDuration = gotFirstByte.Sub(totalStart).Milliseconds()
	}
	if !downloadDone.IsZero() && !gotFirstByte.IsZero() {
		downloadDuration = downloadDone.Sub(gotFirstByte).Milliseconds()
	}

	totalDuration := downloadDone.Sub(totalStart).Milliseconds()

	// Extract active session cookies for this URL
	sessionCookies := c.cookies.GetCookies(parsedURL.String())

	return HTTPResponse{
		StatusCode: resp.StatusCode,
		StatusText: resp.Status,
		Headers:    resp.Header,
		Body:       string(bodyBytes),
		Size:       int64(len(bodyBytes)),
		Timing: TimingStats{
			DNSDurationMs:      dnsDuration,
			TCPDurationMs:      tcpDuration,
			TLSDurationMs:      tlsDuration,
			TTFBDurationMs:      ttfbDuration,
			DownloadDurationMs: downloadDuration,
			TotalDurationMs:    totalDuration,
		},
		Cookies: sessionCookies,
	}
}
