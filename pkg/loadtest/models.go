package loadtest

import "pulse/pkg/engine"

// LoadTestConfig defines the parameters to run a load test
type LoadTestConfig struct {
	TargetRequest   engine.HTTPRequest `json:"targetRequest"`
	VirtualUsers    int                `json:"virtualUsers"`    // Concurrency (e.g. 10 to 500)
	DurationSeconds int                `json:"durationSeconds"` // Duration in seconds (e.g. 10 to 300)
	RampUpSeconds   int                `json:"rampUpSeconds"`   // Gradual ramp-up
}

// LiveStats is periodically streamed to the UI every 250ms
type LiveStats struct {
	ElapsedTimeSec     float64       `json:"elapsedTimeSec"`
	CurrentRPS         float64       `json:"currentRps"`
	TotalRequests      int64         `json:"totalRequests"`
	SuccessfulRequests int64         `json:"successfulRequests"`
	FailedRequests     int64         `json:"failedRequests"`
	AvgLatencyMs       float64       `json:"avgLatencyMs"`
	StatusCounts       map[int]int64 `json:"statusCounts"`
	IsRunning          bool          `json:"isRunning"`
}

// RequestRecord holds an individual request result for percentile computation
type RequestRecord struct {
	DurationMs int64
	DurationNs int64
	StatusCode int
	Error      bool
	Bytes      int64
}

// SummaryReport holds percentile-based load test performance metrics
type SummaryReport struct {
	TotalRequests       int64         `json:"totalRequests"`
	SuccessfulRequests  int64         `json:"successfulRequests"`
	FailedRequests      int64         `json:"failedRequests"`
	TotalDurationSec    float64       `json:"totalDurationSec"`
	ThroughputRPS       float64       `json:"throughputRps"`
	MinLatencyMs        int64         `json:"minLatencyMs"`
	MaxLatencyMs        int64         `json:"maxLatencyMs"`
	AvgLatencyMs        float64       `json:"avgLatencyMs"`
	P50LatencyMs        int64         `json:"p50LatencyMs"`
	P90LatencyMs        int64         `json:"p90LatencyMs"`
	P95LatencyMs        int64         `json:"p95LatencyMs"`
	P99LatencyMs        int64         `json:"p99LatencyMs"`
	StatusDistribution  map[int]int64 `json:"statusDistribution"`
	TotalDataBytes      int64         `json:"totalDataBytes"`
	TargetURL           string        `json:"targetUrl"`
	TargetMethod        string        `json:"targetMethod"`
	VirtualUsers        int           `json:"virtualUsers"`
}
