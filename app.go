package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"pulse/pkg/engine"
	"pulse/pkg/exporter"
	"pulse/pkg/importer"
	"pulse/pkg/loadtest"
	"pulse/pkg/resolver"
	"pulse/pkg/script"
	"pulse/pkg/storage"
	runtimeGo "runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx        context.Context
	httpEngine *engine.Client
	storage    *storage.Manager
	loadRunner *loadtest.Runner
	sandbox    *script.Sandbox
}

// NewApp creates a new App application struct
func NewApp() *App {
	store, err := storage.NewManager()
	if err != nil {
		println("Warning: Failed to initialize storage:", err.Error())
	}

	return &App{
		httpEngine: engine.NewClient(),
		storage:    store,
		loadRunner: loadtest.NewRunner(),
		sandbox:    script.NewSandbox(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// GetAppVersion returns the current semantic version of Pulse
func (a *App) GetAppVersion() string {
	return AppVersion
}

// SendRequest executes an HTTP request with pre/post scripts and cookie jar support
func (a *App) SendRequest(req engine.HTTPRequest) engine.HTTPResponse {
	// 1. Run Pre-Request Script (if present)
	if req.PreRequestScript != "" && a.sandbox != nil {
		updatedVars, err := a.sandbox.ExecutePreRequest(req.PreRequestScript, req.Variables)
		if err != nil {
			return engine.HTTPResponse{
				StatusCode: 0,
				Error:      fmt.Sprintf("Pre-request script failed: %v", err),
			}
		}
		req.Variables = updatedVars
	}

	// 2. Dispatch HTTP Request through the engine
	resp := a.httpEngine.Execute(req)

	// 3. Run Post-Response / Test Script (if present)
	if req.PostResponseScript != "" && a.sandbox != nil {
		updatedVars, testResults, err := a.sandbox.ExecutePostResponse(req.PostResponseScript, resp, req.Variables)
		resp.TestResults = testResults
		resp.UpdatedVariables = updatedVars
		if err != nil && resp.Error == "" {
			resp.Error = fmt.Sprintf("Post-response script failed: %v", err)
		}
	}

	return resp
}

// GetCookies returns the active session cookies for a given URL
func (a *App) GetCookies(rawURL string) []engine.CookieItem {
	if a.httpEngine == nil {
		return nil
	}
	return a.httpEngine.GetCookies(rawURL)
}

// ClearCookies clears all stored session cookies in the cookie jar
func (a *App) ClearCookies() {
	if a.httpEngine != nil {
		a.httpEngine.ClearCookies()
	}
}

// ResolveVariables resolves {{var}} templates against the provided map
func (a *App) ResolveVariables(input string, variables map[string]string) string {
	return resolver.ResolveString(input, variables)
}

// LoadWorkspace loads all collections and environments from disk (~/.pulse/)
func (a *App) LoadWorkspace() storage.WorkspaceData {
	if a.storage == nil {
		return storage.WorkspaceData{}
	}
	return a.storage.LoadWorkspace()
}

// SaveRequest persists a request to disk inside its collection folder
func (a *App) SaveRequest(req storage.SavedRequest) error {
	if a.storage == nil {
		return nil
	}
	return a.storage.SaveRequest(req)
}

// DeleteRequest deletes a request file from disk
func (a *App) DeleteRequest(id string, collection string) error {
	if a.storage == nil {
		return nil
	}
	return a.storage.DeleteRequest(id, collection)
}

// MoveRequest moves a request file from one collection/folder directory to another on disk
func (a *App) MoveRequest(id string, fromCollection string, toCollection string) (storage.SavedRequest, error) {
	if a.storage == nil {
		return storage.SavedRequest{}, fmt.Errorf("storage engine not initialized")
	}
	return a.storage.MoveRequest(id, fromCollection, toCollection)
}

// CreateCollection creates a new empty collection folder on disk
func (a *App) CreateCollection(name string) error {
	if a.storage == nil {
		return nil
	}
	return a.storage.CreateCollection(name)
}

// RenameCollection renames an existing collection folder and its requests on disk
func (a *App) RenameCollection(oldName string, newName string) error {
	if a.storage == nil {
		return nil
	}
	return a.storage.RenameCollection(oldName, newName)
}

// DeleteCollection removes a collection folder and all its requests from disk
func (a *App) DeleteCollection(name string) error {
	if a.storage == nil {
		return nil
	}
	return a.storage.DeleteCollection(name)
}

// MoveCollection moves a directory (and its subfolders/requests) into targetParentPath or root
func (a *App) MoveCollection(oldPath string, targetParentPath string) (string, error) {
	if a.storage == nil {
		return "", fmt.Errorf("storage engine not initialized")
	}
	return a.storage.MoveCollection(oldPath, targetParentPath)
}

// ReorderCollections persists custom directory display ordering under parentPath (or root when empty)
func (a *App) ReorderCollections(parentPath string, orderedNames []string) error {
	if a.storage == nil {
		return nil
	}
	return a.storage.ReorderCollections(parentPath, orderedNames)
}

func buildExportRequestItem(r storage.SavedRequest) map[string]interface{} {
	headers := make([]map[string]interface{}, 0, len(r.Headers))
	for _, h := range r.Headers {
		if h.Enabled && h.Key != "" {
			headers = append(headers, map[string]interface{}{
				"key":   h.Key,
				"value": h.Value,
				"type":  "text",
			})
		}
	}

	queryParams := make([]map[string]interface{}, 0, len(r.QueryParams))
	for _, p := range r.QueryParams {
		if p.Enabled && p.Key != "" {
			queryParams = append(queryParams, map[string]interface{}{
				"key":   p.Key,
				"value": p.Value,
			})
		}
	}

	rawLang := "json"
	if strings.EqualFold(r.Body.Type, "xml") {
		rawLang = "xml"
	} else if strings.EqualFold(r.Body.Type, "raw") {
		rawLang = "text"
	}

	bodyMap := map[string]interface{}{
		"mode": "raw",
		"raw":  r.Body.Raw,
		"options": map[string]interface{}{
			"raw": map[string]interface{}{
				"language": rawLang,
			},
		},
	}

	urlMap := map[string]interface{}{
		"raw":   r.URL,
		"query": queryParams,
	}

	item := map[string]interface{}{
		"name": r.Name,
		"request": map[string]interface{}{
			"method": r.Method,
			"header": headers,
			"body":   bodyMap,
			"url":    urlMap,
		},
	}

	var events []map[string]interface{}
	if strings.TrimSpace(r.PreRequestScript) != "" {
		events = append(events, map[string]interface{}{
			"listen": "prerequest",
			"script": map[string]interface{}{
				"type": "text/javascript",
				"exec": strings.Split(r.PreRequestScript, "\n"),
			},
		})
	}
	if strings.TrimSpace(r.PostResponseScript) != "" {
		events = append(events, map[string]interface{}{
			"listen": "test",
			"script": map[string]interface{}{
				"type": "text/javascript",
				"exec": strings.Split(r.PostResponseScript, "\n"),
			},
		})
	}
	if len(events) > 0 {
		item["event"] = events
	}
	return item
}

func resolveExportDir() string {
	homeDir, err := os.UserHomeDir()
	if err == nil {
		downloadsDir := filepath.Join(homeDir, "Downloads")
		if stat, err := os.Stat(downloadsDir); err == nil && stat.IsDir() {
			return downloadsDir
		}
	}
	targetDir := filepath.Join(homeDir, ".pulse", "exports")
	_ = os.MkdirAll(targetDir, 0755)
	return targetDir
}

func writeExportJSON(exportData interface{}, fileName string) (string, error) {
	jsonBytes, err := json.MarshalIndent(exportData, "", "  ")
	if err != nil {
		return "", err
	}
	filePath := filepath.Join(resolveExportDir(), fileName)
	if err := os.WriteFile(filePath, jsonBytes, 0644); err != nil {
		return "", err
	}
	return filePath, nil
}

func findCollectionNodeByExactPath(colls []storage.Collection, target string) (*storage.Collection, bool) {
	for _, c := range colls {
		if c.Path == target {
			coll := c
			return &coll, true
		}
		if len(c.Folders) > 0 {
			if found, ok := findCollectionNodeByExactPath(c.Folders, target); ok {
				return found, true
			}
		}
	}
	return nil, false
}

func findCollectionNodeByName(colls []storage.Collection, target string) (*storage.Collection, bool) {
	for _, c := range colls {
		if c.Name == target {
			coll := c
			return &coll, true
		}
		if len(c.Folders) > 0 {
			if found, ok := findCollectionNodeByName(c.Folders, target); ok {
				return found, true
			}
		}
	}
	return nil, false
}

func findCollectionNode(colls []storage.Collection, target string) (*storage.Collection, bool) {
	if found, ok := findCollectionNodeByExactPath(colls, target); ok {
		return found, true
	}
	return findCollectionNodeByName(colls, target)
}

func (a *App) findCollectionByName(collectionName string) (*storage.Collection, error) {
	if a.storage == nil {
		return nil, fmt.Errorf("storage not initialized")
	}
	colls, err := a.storage.LoadCollections()
	if err != nil {
		return nil, err
	}
	if found, ok := findCollectionNode(colls, collectionName); ok {
		return found, nil
	}
	return nil, fmt.Errorf("collection %q not found", collectionName)
}

func safeExportName(name string) string {
	return strings.NewReplacer(" ", "_", "/", "_", "\\", "_").Replace(name)
}

func buildExportCollectionNodes(c storage.Collection) []map[string]interface{} {
	nodes := make([]map[string]interface{}, 0, len(c.Folders)+len(c.Requests))
	for _, folder := range c.Folders {
		nodes = append(nodes, map[string]interface{}{
			"name": folder.Name,
			"item": buildExportCollectionNodes(folder),
		})
	}
	for _, r := range c.Requests {
		nodes = append(nodes, buildExportRequestItem(r))
	}
	return nodes
}

// ExportCollectionJSON exports a specific collection (preserving nested folders) as JSON in ~/Downloads/
func (a *App) ExportCollectionJSON(collectionName string) (string, error) {
	targetColl, err := a.findCollectionByName(collectionName)
	if err != nil {
		return "", err
	}

	items := buildExportCollectionNodes(*targetColl)

	exportData := map[string]interface{}{
		"info": map[string]interface{}{
			"_postman_id": fmt.Sprintf("%d", time.Now().UnixNano()),
			"name":        targetColl.Name,
			"schema":      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
			"description": fmt.Sprintf("Exported from Pulse on %s", time.Now().Format("2006-01-02 15:04:05")),
		},
		"item": items,
	}

	fileName := fmt.Sprintf("%s.collection.json", safeExportName(targetColl.Name))
	return writeExportJSON(exportData, fileName)
}

// ExportCollectionOpenAPIv2 exports a collection in OpenAPI v2 (Swagger 2.0) JSON format in ~/Downloads/
func (a *App) ExportCollectionOpenAPIv2(collectionName string) (string, error) {
	targetColl, err := a.findCollectionByName(collectionName)
	if err != nil {
		return "", err
	}
	spec := exporter.CollectionToOpenAPI2(*targetColl, AppVersion)
	fileName := fmt.Sprintf("%s.openapi-v2.json", safeExportName(targetColl.Name))
	return writeExportJSON(spec, fileName)
}

// ExportRequestOpenAPIv2 exports a single request in OpenAPI v2 (Swagger 2.0) JSON format in ~/Downloads/
func (a *App) ExportRequestOpenAPIv2(req storage.SavedRequest) (string, error) {
	title := strings.TrimSpace(req.Name)
	if title == "" {
		title = "Untitled_Request"
	}
	coll := storage.Collection{
		ID:       "single_req",
		Name:     title,
		Requests: []storage.SavedRequest{req},
	}
	spec := exporter.CollectionToOpenAPI2(coll, AppVersion)
	fileName := fmt.Sprintf("%s.openapi-v2.json", safeExportName(title))
	return writeExportJSON(spec, fileName)
}

// ExportRequestJSON exports a single request as an importable JSON file in ~/Downloads/
func (a *App) ExportRequestJSON(req storage.SavedRequest) (string, error) {
	collName := strings.TrimSpace(req.Collection)
	if collName == "" {
		collName = "Imported Requests"
	}
	reqName := strings.TrimSpace(req.Name)
	if reqName == "" {
		reqName = "Untitled_Request"
	}

	exportData := map[string]interface{}{
		"info": map[string]interface{}{
			"_postman_id": fmt.Sprintf("%d", time.Now().UnixNano()),
			"name":        collName,
			"schema":      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
			"description": fmt.Sprintf("Single request exported from Pulse on %s", time.Now().Format("2006-01-02 15:04:05")),
		},
		"item": []map[string]interface{}{buildExportRequestItem(req)},
	}

	safeName := strings.NewReplacer(" ", "_", "/", "_", "\\", "_").Replace(reqName)
	fileName := fmt.Sprintf("%s.request.json", safeName)
	return writeExportJSON(exportData, fileName)
}

// SaveEnvironment writes an environment JSON file to disk
func (a *App) SaveEnvironment(env storage.SavedEnvironment) error {
	if a.storage == nil {
		return nil
	}
	return a.storage.SaveEnvironment(env)
}

// DeleteEnvironment removes an environment JSON file from disk
func (a *App) DeleteEnvironment(id string) error {
	if a.storage == nil {
		return nil
	}
	return a.storage.DeleteEnvironment(id)
}

// ImportCollectionJSON auto-detects and imports Collection v2.0/v2.1 JSON, OpenAPI v2 (Swagger 2.0), or OpenAPI v3 (3.0/3.1 JSON/YAML) with full folder hierarchy into disk storage
func (a *App) ImportCollectionJSON(jsonContent string) (int, error) {
	return a.ImportCollectionIntoFolder(jsonContent, "")
}

// ImportCollectionIntoFolder imports a Collection or OpenAPI spec at root or nested inside parentFolder
func (a *App) ImportCollectionIntoFolder(jsonContent string, parentFolder string) (int, error) {
	if a.storage == nil {
		return 0, fmt.Errorf("storage engine not initialized")
	}

	res, err := importer.ParseCollectionWithFolders(jsonContent)
	if err != nil {
		return 0, err
	}

	cleanParent := strings.Trim(strings.ReplaceAll(strings.TrimSpace(parentFolder), "\\", "/"), "/")
	remapPath := func(p string) string {
		if cleanParent == "" {
			return p
		}
		parentLeaf := cleanParent
		if idx := strings.LastIndex(cleanParent, "/"); idx >= 0 {
			parentLeaf = cleanParent[idx+1:]
		}
		// Avoid duplicating folder if root collection already matches target parent folder
		if strings.EqualFold(p, res.CollectionName) && strings.EqualFold(res.CollectionName, parentLeaf) {
			return cleanParent
		}
		prefix := res.CollectionName + "/"
		if strings.EqualFold(res.CollectionName, parentLeaf) && len(p) > len(prefix) && strings.EqualFold(p[:len(prefix)], prefix) {
			return cleanParent + "/" + p[len(prefix):]
		}
		return cleanParent + "/" + p
	}

	if cleanParent != "" {
		_ = a.storage.CreateCollection(cleanParent)
	}
	for _, folderPath := range res.Folders {
		target := remapPath(folderPath)
		if err := a.storage.CreateCollection(target); err != nil {
			return 0, fmt.Errorf("failed to create collection folder %q: %w", target, err)
		}
	}

	count := 0
	claimedIDs := map[string]bool{}
	var lastSaveErr error
	for _, req := range res.Requests {
		req.Collection = remapPath(req.Collection)
		if _, saveErr := a.storage.SaveOrUpdateInCollectionBatch(req, claimedIDs); saveErr == nil {
			count++
		} else {
			lastSaveErr = saveErr
		}
	}
	if count == 0 && len(res.Requests) > 0 && lastSaveErr != nil {
		return 0, fmt.Errorf("failed to save imported requests: %w", lastSaveErr)
	}

	return count, nil
}

// ImportCSV parses and saves a CSV of endpoints to disk
func (a *App) ImportCSV(collectionName string, csvContent string) (int, error) {
	if a.storage == nil {
		return 0, fmt.Errorf("storage engine not initialized")
	}

	requests, err := importer.ParseCSV(collectionName, csvContent)
	if err != nil {
		return 0, err
	}

	if err := a.storage.CreateCollection(collectionName); err != nil {
		return 0, fmt.Errorf("failed to create collection folder: %w", err)
	}

	count := 0
	for _, req := range requests {
		if err := a.storage.SaveOrUpdateByNameAndDir(req); err == nil {
			count++
		}
	}

	return count, nil
}

// ParseCurl converts a raw cURL command string into a SavedRequest
func (a *App) ParseCurl(curlCmd string) (storage.SavedRequest, error) {
	return importer.ParseCurlCommand(curlCmd)
}

// ImportCurlCommand parses a cURL command and saves it into the target collection
func (a *App) ImportCurlCommand(collectionName string, curlCmd string) (storage.SavedRequest, error) {
	if a.storage == nil {
		return storage.SavedRequest{}, fmt.Errorf("storage engine not initialized")
	}

	req, err := importer.ParseCurlCommand(curlCmd)
	if err != nil {
		return storage.SavedRequest{}, err
	}

	if collectionName != "" {
		req.Collection = collectionName
	}

	if err := a.storage.CreateCollection(req.Collection); err != nil {
		return storage.SavedRequest{}, err
	}

	if err := a.storage.SaveOrUpdateByNameAndDir(req); err != nil {
		return storage.SavedRequest{}, err
	}

	return req, nil
}

// StartLoadTest runs a concurrent load test and streams live metrics via Wails events
func (a *App) StartLoadTest(config loadtest.LoadTestConfig) (loadtest.SummaryReport, error) {
	if a.loadRunner == nil {
		return loadtest.SummaryReport{}, fmt.Errorf("load test engine not initialized")
	}

	return a.loadRunner.Run(config, func(stats loadtest.LiveStats) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "loadtest:tick", stats)
		}
	})
}

// StopLoadTest stops the active load test
func (a *App) StopLoadTest() {
	if a.loadRunner != nil {
		a.loadRunner.Stop()
	}
}

// ToggleFullscreen toggles the desktop window between fullscreen and normal
func (a *App) ToggleFullscreen() {
	if a.ctx != nil {
		if runtime.WindowIsFullscreen(a.ctx) {
			runtime.WindowUnfullscreen(a.ctx)
		} else {
			runtime.WindowFullscreen(a.ctx)
		}
	}
}

// ExportLoadTestReport writes an offline standalone HTML report to ~/.pulse/reports/
func (a *App) ExportLoadTestReport(report loadtest.SummaryReport) (string, error) {
	basePath := ""
	if a.storage != nil {
		basePath = a.storage.GetBasePath()
	}
	return loadtest.GenerateHTMLReport(basePath, report)
}

// GenerateHTMLReportContent returns the raw HTML string for the report
func (a *App) GenerateHTMLReportContent(report loadtest.SummaryReport) string {
	return loadtest.RenderHTMLReport(report)
}

// OpenInBrowser opens a file path or URL in the system's default web browser using native OS commands
func (a *App) OpenInBrowser(targetPath string) error {
	if targetPath == "" {
		return fmt.Errorf("empty path")
	}

	var cmd *exec.Cmd
	switch runtimeGo.GOOS {
	case "darwin":
		cmd = exec.Command("open", targetPath)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", targetPath)
	default:
		cmd = exec.Command("xdg-open", targetPath)
	}

	return cmd.Start()
}

// ShowInFolder reveals the file in Finder (macOS) or Explorer (Windows)
func (a *App) ShowInFolder(targetPath string) error {
	if targetPath == "" {
		return fmt.Errorf("empty path")
	}

	var cmd *exec.Cmd
	switch runtimeGo.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", targetPath)
	case "windows":
		cmd = exec.Command("explorer", "/select,", targetPath)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(targetPath))
	}

	return cmd.Start()
}
