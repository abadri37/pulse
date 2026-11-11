package loadtest

import (
	"sort"
)

// CalculateSummary aggregates raw records into a percentile-based SummaryReport
func CalculateSummary(
	records []RequestRecord,
	totalDurationSec float64,
	targetURL string,
	targetMethod string,
	virtualUsers int,
) SummaryReport {
	n := len(records)
	if n == 0 {
		return SummaryReport{
			TotalDurationSec: totalDurationSec,
			TargetURL:        targetURL,
			TargetMethod:     targetMethod,
			VirtualUsers:     virtualUsers,
		}
	}

	durations := make([]int64, n)
	statusDist := make(map[int]int64)
	var (
		totalLatencyNs int64
		successCount   int64
		failedCount    int64
		totalBytes     int64
		minLatency     int64 = records[0].DurationMs
		maxLatency     int64 = records[0].DurationMs
	)

	for i, r := range records {
		durations[i] = r.DurationMs
		if r.DurationNs > 0 {
			totalLatencyNs += r.DurationNs
		} else {
			totalLatencyNs += r.DurationMs * 1_000_000
		}
		totalBytes += r.Bytes
		statusDist[r.StatusCode]++

		if r.Error || r.StatusCode >= 400 || r.StatusCode == 0 {
			failedCount++
		} else {
			successCount++
		}

		if r.DurationMs < minLatency {
			minLatency = r.DurationMs
		}
		if r.DurationMs > maxLatency {
			maxLatency = r.DurationMs
		}
	}

	// Sort durations to calculate exact percentiles
	sort.Slice(durations, func(i, j int) bool {
		return durations[i] < durations[j]
	})

	p50 := getPercentile(durations, 0.50)
	p90 := getPercentile(durations, 0.90)
	p95 := getPercentile(durations, 0.95)
	p99 := getPercentile(durations, 0.99)

	avgLatency := float64(totalLatencyNs) / float64(n) / 1e6
	var throughput float64
	if totalDurationSec > 0 {
		throughput = float64(n) / totalDurationSec
	}

	return SummaryReport{
		TotalRequests:      int64(n),
		SuccessfulRequests: successCount,
		FailedRequests:     failedCount,
		TotalDurationSec:   totalDurationSec,
		ThroughputRPS:      throughput,
		MinLatencyMs:       minLatency,
		MaxLatencyMs:       maxLatency,
		AvgLatencyMs:       avgLatency,
		P50LatencyMs:       p50,
		P90LatencyMs:       p90,
		P95LatencyMs:       p95,
		P99LatencyMs:       p99,
		StatusDistribution: statusDist,
		TotalDataBytes:     totalBytes,
		TargetURL:          targetURL,
		TargetMethod:       targetMethod,
		VirtualUsers:       virtualUsers,
	}
}

// getPercentile calculates the nearest-rank percentile
func getPercentile(sorted []int64, p float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int(float64(len(sorted)) * p)
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}
