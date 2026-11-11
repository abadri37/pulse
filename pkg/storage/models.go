package storage

import "pulse/pkg/engine"

// SavedRequest represents a request file stored on disk
type SavedRequest struct {
	ID                 string              `json:"id"`
	Name               string              `json:"name"`
	Collection         string              `json:"collection"`
	Method             string              `json:"method"`
	URL                string              `json:"url"`
	Headers            []engine.HeaderPair `json:"headers"`
	QueryParams        []engine.ParamPair  `json:"queryParams"`
	Body               engine.RequestBody  `json:"body"`
	PreRequestScript   string              `json:"preRequestScript,omitempty"`
	PostResponseScript string              `json:"postResponseScript,omitempty"`
	LastModifiedAt     int64               `json:"lastModifiedAt"`
}

// Collection represents a group of requests stored in a folder
type Collection struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Requests []SavedRequest `json:"requests"`
}

// SavedEnvironment represents an environment file stored on disk
type SavedEnvironment struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Variables map[string]string `json:"variables"`
}

// WorkspaceData bundles all collections and environments for the UI
type WorkspaceData struct {
	WorkspacePath string             `json:"workspacePath"`
	Collections   []Collection       `json:"collections"`
	Environments  []SavedEnvironment `json:"environments"`
}
