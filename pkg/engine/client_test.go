package engine

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientResolvesVariablesEverywhereWithoutDupQueryParams(t *testing.T) {
	var gotPath string
	var gotQuery string
	var gotAuth string
	var gotCustomHeader string
	var gotBody string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotAuth = r.Header.Get("Authorization")
		gotCustomHeader = r.Header.Get("X-Tenant-Id")
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	client := NewClient()
	resp := client.Execute(HTTPRequest{
		Method: "POST",
		URL:    "{{baseUrl}}/api/{{version}}/items?token={{token}}",
		QueryParams: []ParamPair{
			{Key: "token", Value: "{{token}}", Enabled: true},
			{Key: "{{filterKey}}", Value: "{{filterVal}}", Enabled: true},
		},
		Headers: []HeaderPair{
			{Key: "Authorization", Value: "Bearer {{token}}", Enabled: true},
			{Key: "{{tenantHeader}}", Value: "{{tenantId}}", Enabled: true},
		},
		Body: RequestBody{
			Type: "json",
			Raw:  `{"item":"{{itemName}}"}`,
		},
		Variables: map[string]string{
			"baseUrl":      srv.URL,
			"version":      "v1",
			"token":        "secret_123",
			"filterKey":    "status",
			"filterVal":    "active",
			"tenantHeader": "X-Tenant-Id",
			"tenantId":     "acme-42",
			"itemName":     "Keyboard",
		},
	})

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d (err=%s)", resp.StatusCode, resp.Error)
	}
	if gotPath != "/api/v1/items" {
		t.Fatalf("unexpected path: %q", gotPath)
	}
	// token should appear only once even when synced in both URL and QueryParams
	if gotQuery != "status=active&token=secret_123" {
		t.Fatalf("unexpected query: %q", gotQuery)
	}
	if gotAuth != "Bearer secret_123" {
		t.Fatalf("unexpected Authorization header: %q", gotAuth)
	}
	if gotCustomHeader != "acme-42" {
		t.Fatalf("unexpected X-Tenant-Id header: %q", gotCustomHeader)
	}
	if gotBody != `{"item":"Keyboard"}` {
		t.Fatalf("unexpected body: %q", gotBody)
	}
}
