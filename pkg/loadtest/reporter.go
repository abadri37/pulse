package loadtest

import (
	"bytes"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// StatusRowView holds display data for each status code
type StatusRowView struct {
	Code       int
	Count      int64
	Percentage string
	BadgeColor string
}

// ReportTemplateData holds all data passed into the HTML template safely by name
type ReportTemplateData struct {
	TargetMethod        string
	TargetURL           string
	VirtualUsers        int
	FormattedDuration   string
	GeneratedAt         string
	TotalRequests       int64
	FormattedThroughput string
	FormattedSuccess    string
	MinLatencyMs        int64
	MaxLatencyMs        int64
	FormattedAvg        string
	P50LatencyMs        int64
	P90LatencyMs        int64
	P95LatencyMs        int64
	P99LatencyMs        int64
	StatusRows          []StatusRowView
	HasStatusRows       bool
}

const htmlReportTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Pulse Load Test Report - {{.TargetMethod}} {{.TargetURL}}</title>
	<style>
		body {
			background-color: #0d0f17;
			color: #ededed;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			margin: 0;
			padding: 40px 20px;
		}
		.container {
			max-width: 960px;
			margin: 0 auto;
		}
		.header {
			border-bottom: 1px solid #1e293b;
			padding-bottom: 24px;
			margin-bottom: 30px;
		}
		.badge {
			display: inline-block;
			background: linear-gradient(135deg, #7c3aed, #4f46e5);
			color: #fff;
			padding: 4px 12px;
			border-radius: 9999px;
			font-size: 11px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
			gap: 16px;
			margin-bottom: 32px;
		}
		.card {
			background: #161924;
			border: 1px solid #1e293b;
			border-radius: 12px;
			padding: 20px;
			box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
		}
		.card-title {
			color: #94a3b8;
			font-size: 11px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			margin-bottom: 8px;
		}
		.card-value {
			font-size: 30px;
			font-weight: 800;
			color: #fff;
			font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			background: #161924;
			border-radius: 12px;
			overflow: hidden;
			border: 1px solid #1e293b;
			margin-bottom: 32px;
			box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
		}
		th, td {
			padding: 12px 18px;
			text-align: left;
			font-size: 13px;
		}
		th {
			background: #11131a;
			color: #94a3b8;
			font-weight: 700;
			text-transform: uppercase;
			font-size: 11px;
			letter-spacing: 0.05em;
			border-bottom: 1px solid #1e293b;
		}
		tr:not(:last-child) {
			border-bottom: 1px solid #1e293b;
		}
		.section-title {
			font-size: 15px;
			font-weight: 700;
			margin-bottom: 14px;
			color: #f1f5f9;
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.footer {
			margin-top: 40px;
			text-align: center;
			color: #64748b;
			font-size: 12px;
			border-top: 1px solid #1e293b;
			padding-top: 20px;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<span class="badge">⚡ Pulse Load Test Report</span>
			<h1 style="margin: 14px 0 6px 0; font-size: 26px; font-weight: 900; letter-spacing: -0.02em;">
				<span style="color: #a78bfa;">{{.TargetMethod}}</span> {{.TargetURL}}
			</h1>
			<p style="color: #94a3b8; font-size: 13px; margin: 0;">
				Executed with <strong>{{.VirtualUsers}} Virtual Workers</strong> for <strong>{{.FormattedDuration}}</strong> &bull; Generated on {{.GeneratedAt}}
			</p>
		</div>

		<div class="grid">
			<div class="card">
				<div class="card-title">Total Requests</div>
				<div class="card-value">{{.TotalRequests}}</div>
			</div>
			<div class="card">
				<div class="card-title">Throughput</div>
				<div class="card-value" style="color: #38bdf8;">{{.FormattedThroughput}} <span style="font-size: 14px; font-weight: normal;">RPS</span></div>
			</div>
			<div class="card">
				<div class="card-title">Success Rate</div>
				<div class="card-value" style="color: #34d399;">{{.FormattedSuccess}}%</div>
			</div>
			<div class="card">
				<div class="card-title">p95 Latency</div>
				<div class="card-value" style="color: #c084fc;">{{.P95LatencyMs}} <span style="font-size: 14px; font-weight: normal;">ms</span></div>
			</div>
		</div>

		<div class="section-title">📊 Response Time Percentiles</div>
		<table>
			<thead>
				<tr>
					<th>Metric</th>
					<th>Latency</th>
					<th>Description</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td><strong>Minimum</strong></td>
					<td style="font-family:ui-monospace, monospace; color:#34d399; font-weight:bold;">{{.MinLatencyMs}} ms</td>
					<td style="color:#94a3b8;">Fastest recorded response</td>
				</tr>
				<tr>
					<td><strong>Average</strong></td>
					<td style="font-family:ui-monospace, monospace; color:#38bdf8; font-weight:bold;">{{.FormattedAvg}} ms</td>
					<td style="color:#94a3b8;">Mean response time across all workers</td>
				</tr>
				<tr>
					<td><strong>p50 (Median)</strong></td>
					<td style="font-family:ui-monospace, monospace; color:#fff; font-weight:bold;">{{.P50LatencyMs}} ms</td>
					<td style="color:#94a3b8;">50% of requests finished below this</td>
				</tr>
				<tr>
					<td><strong>p90</strong></td>
					<td style="font-family:ui-monospace, monospace; color:#fbbf24; font-weight:bold;">{{.P90LatencyMs}} ms</td>
					<td style="color:#94a3b8;">90% of requests finished below this</td>
				</tr>
				<tr style="background: rgba(124, 58, 237, 0.1);">
					<td><strong style="color:#c084fc;">p95 (SLA Baseline)</strong></td>
					<td style="font-family:ui-monospace, monospace; color:#c084fc; font-weight:800;">{{.P95LatencyMs}} ms</td>
					<td style="color:#cbd5e1;">95% of requests finished below this (Standard API SLA)</td>
				</tr>
				<tr style="background: rgba(244, 63, 94, 0.1);">
					<td><strong style="color:#fb7185;">p99 (Tail Latency)</strong></td>
					<td style="font-family:ui-monospace, monospace; color:#fb7185; font-weight:800;">{{.P99LatencyMs}} ms</td>
					<td style="color:#cbd5e1;">99% of requests finished below this (Outlier bottleneck)</td>
				</tr>
				<tr>
					<td><strong>Maximum</strong></td>
					<td style="font-family:ui-monospace, monospace; color:#f87171; font-weight:bold;">{{.MaxLatencyMs}} ms</td>
					<td style="color:#94a3b8;">Slowest response recorded</td>
				</tr>
			</tbody>
		</table>

		<div class="section-title">🚦 HTTP Status Code Breakdown</div>
		<table>
			<thead>
				<tr>
					<th>Status Code</th>
					<th>Total Count</th>
					<th>Percentage</th>
				</tr>
			</thead>
			<tbody>
				{{if .HasStatusRows}}
					{{range .StatusRows}}
					<tr>
						<td><span style="display:inline-block;padding:2px 8px;border-radius:4px;background:{{.BadgeColor}}20;color:{{.BadgeColor}};font-weight:bold;">{{.Code}}</span></td>
						<td style="font-family:ui-monospace, monospace;">{{.Count}}</td>
						<td style="font-family:ui-monospace, monospace; font-weight:bold;">{{.Percentage}}%</td>
					</tr>
					{{end}}
				{{else}}
					<tr><td colspan="3" style="color:#737373;text-align:center;">No responses recorded</td></tr>
				{{end}}
			</tbody>
		</table>

		<div class="footer">
			Pulse API Client & Load Testing Engine &bull; Generated Locally & Offline
		</div>
	</div>
</body>
</html>`

// RenderHTMLReport generates a modern, standalone HTML dashboard report string using safe Go html/template
func RenderHTMLReport(report SummaryReport) string {
	successRate := 0.0
	if report.TotalRequests > 0 {
		successRate = (float64(report.SuccessfulRequests) / float64(report.TotalRequests)) * 100.0
	}

	// Sort status codes numerically
	var sortedCodes []int
	for code := range report.StatusDistribution {
		sortedCodes = append(sortedCodes, code)
	}
	sort.Ints(sortedCodes)

	var statusRows []StatusRowView
	for _, code := range sortedCodes {
		count := report.StatusDistribution[code]
		pct := 0.0
		if report.TotalRequests > 0 {
			pct = (float64(count) / float64(report.TotalRequests)) * 100.0
		}

		badgeColor := "#10b981" // green for 2xx
		if code >= 300 && code < 400 {
			badgeColor = "#06b6d4" // cyan for 3xx
		} else if code >= 400 && code < 500 {
			badgeColor = "#f59e0b" // amber for 4xx
		} else if code >= 500 || code == 0 {
			badgeColor = "#f43f5e" // rose for 5xx/errors
		}

		statusRows = append(statusRows, StatusRowView{
			Code:       code,
			Count:      count,
			Percentage: fmt.Sprintf("%.1f", pct),
			BadgeColor: badgeColor,
		})
	}

	targetMethod := strings.ToUpper(strings.TrimSpace(report.TargetMethod))
	if targetMethod == "" {
		targetMethod = "GET"
	}
	targetURL := strings.TrimSpace(report.TargetURL)
	if targetURL == "" {
		targetURL = "Load Test Target"
	}

	data := ReportTemplateData{
		TargetMethod:        targetMethod,
		TargetURL:           targetURL,
		VirtualUsers:        report.VirtualUsers,
		FormattedDuration:   fmt.Sprintf("%.1f seconds", report.TotalDurationSec),
		GeneratedAt:         time.Now().Format("Jan 02, 2006 15:04:05"),
		TotalRequests:       report.TotalRequests,
		FormattedThroughput: fmt.Sprintf("%.1f", report.ThroughputRPS),
		FormattedSuccess:    fmt.Sprintf("%.1f", successRate),
		MinLatencyMs:        report.MinLatencyMs,
		MaxLatencyMs:        report.MaxLatencyMs,
		FormattedAvg:        fmt.Sprintf("%.1f", report.AvgLatencyMs),
		P50LatencyMs:        report.P50LatencyMs,
		P90LatencyMs:        report.P90LatencyMs,
		P95LatencyMs:        report.P95LatencyMs,
		P99LatencyMs:        report.P99LatencyMs,
		StatusRows:          statusRows,
		HasStatusRows:       len(statusRows) > 0,
	}

	tmpl, err := template.New("pulse_report").Parse(htmlReportTemplate)
	if err != nil {
		return fmt.Sprintf("<html><body><h1>Error rendering report</h1><p>%v</p></body></html>", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return fmt.Sprintf("<html><body><h1>Error generating report</h1><p>%v</p></body></html>", err)
	}

	return buf.String()
}

// GenerateHTMLReport generates a standalone HTML dashboard report and saves it directly to ~/Downloads/
func GenerateHTMLReport(basePath string, report SummaryReport) (string, error) {
	targetDir := ""
	homeDir, err := os.UserHomeDir()
	if err == nil {
		downloadsDir := filepath.Join(homeDir, "Downloads")
		if stat, err := os.Stat(downloadsDir); err == nil && stat.IsDir() {
			targetDir = downloadsDir
		}
	}
	if targetDir == "" {
		if basePath != "" {
			targetDir = filepath.Join(basePath, "reports")
		} else {
			targetDir = filepath.Join(homeDir, ".pulse", "reports")
		}
		_ = os.MkdirAll(targetDir, 0755)
	}

	methodTag := strings.ToUpper(report.TargetMethod)
	if methodTag == "" {
		methodTag = "LOADTEST"
	}
	fileName := fmt.Sprintf("pulse_%s_report_%s.html", methodTag, time.Now().Format("20060102_150405"))
	filePath := filepath.Join(targetDir, fileName)

	htmlContent := RenderHTMLReport(report)
	err = os.WriteFile(filePath, []byte(htmlContent), 0644)
	return filePath, err
}
