package engine

// HeaderPair represents an HTTP header entry
type HeaderPair struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

// ParamPair represents an HTTP query parameter entry
type ParamPair struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

// RequestBody represents the body payload of an HTTP request
type RequestBody struct {
	Type string `json:"type"` // "none", "json", "xml", "raw", "x-www-form-urlencoded", "graphql"
	Raw  string `json:"raw"`
}

// HTTPRequest is the full request payload sent from the UI
type HTTPRequest struct {
	ID                 string            `json:"id"`
	Name               string            `json:"name"`
	Method             string            `json:"method"`
	URL                string            `json:"url"`
	Headers            []HeaderPair      `json:"headers"`
	QueryParams        []ParamPair       `json:"queryParams"`
	Body               RequestBody       `json:"body"`
	Variables          map[string]string `json:"variables"` // Active environment variables
	TimeoutMs          int64             `json:"timeoutMs"`
	InsecureSkipVerify bool              `json:"insecureSkipVerify"`
	PreRequestScript   string            `json:"preRequestScript"`
	PostResponseScript string            `json:"postResponseScript"`
}

// TimingStats captures high-precision network timing metrics
type TimingStats struct {
	DNSDurationMs      int64 `json:"dnsDurationMs"`
	TCPDurationMs      int64 `json:"tcpDurationMs"`
	TLSDurationMs      int64 `json:"tlsDurationMs"`
	TTFBDurationMs      int64 `json:"ttfbDurationMs"`
	DownloadDurationMs int64 `json:"downloadDurationMs"`
	TotalDurationMs    int64 `json:"totalDurationMs"`
}

// TestResult captures assertions evaluated in post-response scripts
type TestResult struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
	Error  string `json:"error,omitempty"`
}

// HTTPResponse is the response delivered back to the UI
type HTTPResponse struct {
	StatusCode       int                 `json:"statusCode"`
	StatusText       string              `json:"statusText"`
	Headers          map[string][]string `json:"headers"`
	Body             string              `json:"body"`
	Size             int64               `json:"size"` // Total response body size in bytes
	Timing           TimingStats         `json:"timing"`
	Cookies          []CookieItem        `json:"cookies"`
	TestResults      []TestResult        `json:"testResults"`
	UpdatedVariables map[string]string   `json:"updatedVariables,omitempty"`
	Error            string              `json:"error,omitempty"`
}
