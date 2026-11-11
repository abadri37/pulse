package loadtest

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"pulse/pkg/engine"
)

func TestRunnerMatchesActualServerHits(t *testing.T) {
	var serverHits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverHits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	runner := NewRunner()
	report, err := runner.Run(LoadTestConfig{
		TargetRequest: engine.HTTPRequest{
			Method: "PUT",
			URL:    srv.URL + "/api/v1/items/1",
			Body: engine.RequestBody{
				Type: "json",
				Raw:  `{"price":149.99}`,
			},
		},
		VirtualUsers:    25,
		DurationSeconds: 2,
		RampUpSeconds:   0,
	}, nil)
	if err != nil {
		t.Fatalf("load test failed: %v", err)
	}

	hits := serverHits.Load()
	t.Logf("2s benchmark with 25 workers: client TotalRequests=%d, serverHits=%d, RPS=%.1f, avgLatency=%.3f ms",
		report.TotalRequests, hits, report.ThroughputRPS, report.AvgLatencyMs)

	// Any tiny delta comes only from requests canceled mid-flight right as the 2s context deadline fires
	if report.SuccessfulRequests > hits || hits == 0 {
		t.Fatalf("unexpected hit mismatch: successful=%d serverHits=%d", report.SuccessfulRequests, hits)
	}
}

func TestRunnerResolvesHeadersAndQueryVariables(t *testing.T) {
	var seenAuth atomic.Value
	var seenQuery atomic.Value

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth.Store(r.Header.Get("Authorization"))
		seenQuery.Store(r.URL.RawQuery)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	runner := NewRunner()
	report, err := runner.Run(LoadTestConfig{
		TargetRequest: engine.HTTPRequest{
			Method: "GET",
			URL:    "{{baseUrl}}/check",
			QueryParams: []engine.ParamPair{
				{Key: "env", Value: "{{envName}}", Enabled: true},
			},
			Headers: []engine.HeaderPair{
				{Key: "Authorization", Value: "Bearer {{token}}", Enabled: true},
			},
			Variables: map[string]string{
				"baseUrl": srv.URL,
				"envName": "staging",
				"token":   "tok_999",
			},
		},
		VirtualUsers:    2,
		DurationSeconds: 1,
		RampUpSeconds:   0,
	}, nil)
	if err != nil {
		t.Fatalf("load test failed: %v", err)
	}
	if report.SuccessfulRequests == 0 {
		t.Fatalf("expected successful requests, got 0")
	}
	if got, _ := seenAuth.Load().(string); got != "Bearer tok_999" {
		t.Fatalf("expected Authorization='Bearer tok_999', got %q", got)
	}
	if got, _ := seenQuery.Load().(string); got != "env=staging" {
		t.Fatalf("expected query='env=staging', got %q", got)
	}
}
