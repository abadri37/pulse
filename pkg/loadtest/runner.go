package loadtest

import (
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"pulse/pkg/engine"
	"pulse/pkg/resolver"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Runner manages the execution of concurrent load tests
type Runner struct {
	cancelFunc context.CancelFunc
	isRunning  atomic.Bool
	mu         sync.Mutex
}

// NewRunner creates a new load test runner
func NewRunner() *Runner {
	return &Runner{}
}

// IsRunning reports whether a load test is currently active
func (r *Runner) IsRunning() bool {
	return r.isRunning.Load()
}

// Stop terminates the currently running load test immediately
func (r *Runner) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.cancelFunc != nil {
		r.cancelFunc()
		r.cancelFunc = nil
	}
	r.isRunning.Store(false)
}

// Run executes a concurrent load test and streams live stats via onTick callback
func (r *Runner) Run(
	config LoadTestConfig,
	onTick func(LiveStats),
) (SummaryReport, error) {
	r.Stop() // Ensure any prior run is stopped

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(config.DurationSeconds)*time.Second)
	r.mu.Lock()
	r.cancelFunc = cancel
	r.isRunning.Store(true)
	r.mu.Unlock()

	defer func() {
		r.isRunning.Store(false)
		cancel()
	}()

	// Tune HTTP Transport for high-throughput connection pooling
	transport := &http.Transport{
		MaxIdleConns:        2000,
		MaxIdleConnsPerHost: 1000,
		IdleConnTimeout:     90 * time.Second,
		DisableKeepAlives:   false,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true}, // #nosec G402
	}

	httpClient := &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
	}

	// Prepare resolved URL (with QueryParams), Headers, and Body once
	method := strings.ToUpper(config.TargetRequest.Method)
	if method == "" {
		method = "GET"
	}

	targetURL := resolver.ResolveString(config.TargetRequest.URL, config.TargetRequest.Variables)
	if parsedURL, err := engine.BuildResolvedURL(config.TargetRequest.URL, config.TargetRequest.QueryParams, config.TargetRequest.Variables); err == nil {
		targetURL = parsedURL.String()
	}
	resolvedHeaders := engine.ResolveEnabledHeaders(config.TargetRequest.Headers, config.TargetRequest.Variables)

	var (
		recordsMu    sync.Mutex
		records      []RequestRecord
		totalReqs      atomic.Int64
		successReqs    atomic.Int64
		failedReqs     atomic.Int64
		totalLatencyNs atomic.Int64
		statusMu       sync.Mutex
		statusCounts = make(map[int]int64)
		startTime    = time.Now()
	)

	// Stream live statistics to UI every 250ms
	tickerDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()

		var lastReqCount int64
		var lastTime = time.Now()

		for {
			select {
			case <-ctx.Done():
				return
			case <-tickerDone:
				return
			case <-ticker.C:
				now := time.Now()
				elapsed := now.Sub(startTime).Seconds()
				tickElapsed := now.Sub(lastTime).Seconds()

				currentTotal := totalReqs.Load()
				reqsInTick := currentTotal - lastReqCount
				var currentRPS float64
				if tickElapsed > 0 {
					currentRPS = float64(reqsInTick) / tickElapsed
				}

				lastReqCount = currentTotal
				lastTime = now

				var avgLatency float64
				if currentTotal > 0 {
					avgLatency = float64(totalLatencyNs.Load()) / float64(currentTotal) / 1e6
				}

				statusMu.Lock()
				statusSnapshot := make(map[int]int64)
				for k, v := range statusCounts {
					statusSnapshot[k] = v
				}
				statusMu.Unlock()

				if onTick != nil {
					onTick(LiveStats{
						ElapsedTimeSec:     elapsed,
						CurrentRPS:         currentRPS,
						TotalRequests:      currentTotal,
						SuccessfulRequests: successReqs.Load(),
						FailedRequests:     failedReqs.Load(),
						AvgLatencyMs:       avgLatency,
						StatusCounts:       statusSnapshot,
						IsRunning:          true,
					})
				}
			}
		}
	}()

	// Spawn Virtual Users worker pool
	var wg sync.WaitGroup
	workers := config.VirtualUsers
	if workers <= 0 {
		workers = 10
	}

	bodyTemplate := resolver.ResolveString(config.TargetRequest.Body.Raw, config.TargetRequest.Variables)

	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			// Optional ramp-up delay per worker
			if config.RampUpSeconds > 0 && workers > 1 {
				rampDelay := time.Duration((float64(workerID)/float64(workers))*float64(config.RampUpSeconds)) * time.Second
				select {
				case <-ctx.Done():
					return
				case <-time.After(rampDelay):
				}
			}

			for {
				select {
				case <-ctx.Done():
					return
				default:
				}

				var bodyReader io.Reader
				if config.TargetRequest.Body.Type != "none" && bodyTemplate != "" {
					bodyReader = strings.NewReader(bodyTemplate)
				}

				req, err := http.NewRequestWithContext(ctx, method, targetURL, bodyReader)
				if err != nil {
					return
				}

				for _, h := range resolvedHeaders {
					req.Header.Set(h.Key, h.Value)
				}

				reqStart := time.Now()
				resp, err := httpClient.Do(req)
				elapsedDur := time.Since(reqStart)
				latencyMs := elapsedDur.Milliseconds()
				latencyNs := elapsedDur.Nanoseconds()

				rec := RequestRecord{
					DurationMs: latencyMs,
					DurationNs: latencyNs,
				}

				if err != nil {
					rec.Error = true
					rec.StatusCode = 0
					failedReqs.Add(1)
				} else {
					rec.StatusCode = resp.StatusCode
					bytesRead, _ := io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
					rec.Bytes = bytesRead

					if resp.StatusCode >= 400 {
						rec.Error = true
						failedReqs.Add(1)
					} else {
						successReqs.Add(1)
					}
				}

				totalReqs.Add(1)
				totalLatencyNs.Add(latencyNs)

				statusMu.Lock()
				statusCounts[rec.StatusCode]++
				statusMu.Unlock()

				recordsMu.Lock()
				records = append(records, rec)
				recordsMu.Unlock()
			}
		}(w)
	}

	// Wait for workers to finish when duration expires
	wg.Wait()
	close(tickerDone)

	totalDuration := time.Since(startTime).Seconds()

	return CalculateSummary(records, totalDuration, targetURL, method, workers), nil
}
