package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"pulse/pkg/engine"
	"sort"
	"strings"
	"time"
)

// Manager handles reading and writing collections and environments as plain files
type Manager struct {
	basePath string
}

// NewManager initializes the storage manager and ensures directories exist
func NewManager() (*Manager, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("unable to locate user home directory: %w", err)
	}

	basePath := filepath.Join(homeDir, ".pulse")
	collectionsPath := filepath.Join(basePath, "collections")
	environmentsPath := filepath.Join(basePath, "environments")

	// Create directories if they do not exist
	if err := os.MkdirAll(collectionsPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create collections directory: %w", err)
	}
	if err := os.MkdirAll(environmentsPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create environments directory: %w", err)
	}

	m := &Manager{basePath: basePath}

	// Seed with demo workspace if empty
	m.seedDefaultWorkspace()

	return m, nil
}

// GetBasePath returns the current disk storage path
func (m *Manager) GetBasePath() string {
	return m.basePath
}

// seedDefaultWorkspace writes sample collections and environments if empty
func (m *Manager) seedDefaultWorkspace() {
	envs, _ := m.LoadEnvironments()
	if len(envs) == 0 {
		devEnv := SavedEnvironment{
			ID:   "env_dev",
			Name: "Development",
			Variables: map[string]string{
				"baseUrl": "https://dummyjson.com",
			},
		}
		_ = m.SaveEnvironment(devEnv)
	}

	colls, _ := m.LoadCollections()
	if len(colls) == 0 {
		demoReq := SavedRequest{
			ID:         "req_demo_products",
			Name:       "Get Products",
			Collection: "Demo APIs",
			Method:     "GET",
			URL:        "{{baseUrl}}/products",
			Headers: []engine.HeaderPair{
				{Key: "Accept", Value: "application/json", Enabled: true},
			},
			QueryParams: []engine.ParamPair{
				{Key: "limit", Value: "10", Enabled: true},
			},
			Body: engine.RequestBody{
				Type: "none",
				Raw:  "",
			},
			LastModifiedAt: time.Now().Unix(),
		}
		_ = m.SaveRequest(demoReq)
	}
}

// LoadWorkspace loads all collections and environments from disk
func (m *Manager) LoadWorkspace() WorkspaceData {
	colls, _ := m.LoadCollections()
	envs, _ := m.LoadEnvironments()

	return WorkspaceData{
		WorkspacePath: m.basePath,
		Collections:   colls,
		Environments:  envs,
	}
}

// LoadCollections reads all folders and JSON requests in ~/.pulse/collections/
func (m *Manager) LoadCollections() ([]Collection, error) {
	collectionsDir := filepath.Join(m.basePath, "collections")
	entries, err := os.ReadDir(collectionsDir)
	if err != nil {
		return nil, err
	}

	var collections []Collection

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		collName := entry.Name()
		collPath := filepath.Join(collectionsDir, collName)

		reqFiles, err := os.ReadDir(collPath)
		if err != nil {
			continue
		}

		var requests []SavedRequest
		for _, file := range reqFiles {
			if file.IsDir() || !strings.HasSuffix(file.Name(), ".json") {
				continue
			}

			filePath := filepath.Join(collPath, file.Name())
			data, err := os.ReadFile(filePath)
			if err != nil {
				continue
			}

			var req SavedRequest
			if err := json.Unmarshal(data, &req); err == nil {
				requests = append(requests, req)
			}
		}

		sort.Slice(requests, func(i, j int) bool {
			return strings.ToLower(requests[i].Name) < strings.ToLower(requests[j].Name)
		})

		collections = append(collections, Collection{
			ID:       "coll_" + sanitizeFileName(collName),
			Name:     collName,
			Requests: requests,
		})
	}

	return collections, nil
}

// SaveRequest saves or updates a request JSON file inside its collection folder
func (m *Manager) SaveRequest(req SavedRequest) error {
	collName := strings.TrimSpace(req.Collection)
	if collName == "" {
		collName = "General"
	}
	req.Collection = collName
	req.LastModifiedAt = time.Now().Unix()

	collDir := filepath.Join(m.basePath, "collections", collName)
	if err := os.MkdirAll(collDir, 0755); err != nil {
		return fmt.Errorf("failed to create collection folder: %w", err)
	}

	fileName := req.ID + ".json"
	filePath := filepath.Join(collDir, fileName)

	bytes, err := json.MarshalIndent(req, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize request: %w", err)
	}

	return os.WriteFile(filePath, bytes, 0644)
}

// DeleteRequest deletes a request file from disk
func (m *Manager) DeleteRequest(id string, collectionName string) error {
	if collectionName == "" {
		collectionName = "General"
	}

	filePath := filepath.Join(m.basePath, "collections", collectionName, id+".json")
	return os.Remove(filePath)
}

// CreateCollection creates a new empty collection folder on disk
func (m *Manager) CreateCollection(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("collection name cannot be empty")
	}

	dir := filepath.Join(m.basePath, "collections", name)
	return os.MkdirAll(dir, 0755)
}

// RenameCollection renames a collection folder on disk and updates each saved request inside it
func (m *Manager) RenameCollection(oldName, newName string) error {
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if oldName == "" || newName == "" {
		return fmt.Errorf("collection name cannot be empty")
	}
	if strings.ContainsAny(newName, "/\\") || newName == "." || newName == ".." {
		return fmt.Errorf("invalid collection name %q", newName)
	}
	if oldName == newName {
		return nil
	}

	collectionsRoot := filepath.Join(m.basePath, "collections")
	oldDir := filepath.Join(collectionsRoot, oldName)
	newDir := filepath.Join(collectionsRoot, newName)

	if _, err := os.Stat(oldDir); os.IsNotExist(err) {
		return fmt.Errorf("collection %q not found", oldName)
	} else if err != nil {
		return err
	}

	// On case-insensitive filesystems (macOS), allow case-only renames of the same folder
	if !strings.EqualFold(oldName, newName) {
		if _, err := os.Stat(newDir); err == nil {
			return fmt.Errorf("collection %q already exists", newName)
		} else if !os.IsNotExist(err) {
			return err
		}
	}

	if err := os.Rename(oldDir, newDir); err != nil {
		return err
	}

	entries, err := os.ReadDir(newDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		filePath := filepath.Join(newDir, entry.Name())
		raw, err := os.ReadFile(filePath)
		if err != nil {
			return err
		}
		var req SavedRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			continue
		}
		req.Collection = newName
		updated, err := json.MarshalIndent(req, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(filePath, updated, 0644); err != nil {
			return err
		}
	}

	return nil
}

// DeleteCollection deletes a collection folder and all its requests from disk
func (m *Manager) DeleteCollection(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("collection name cannot be empty")
	}

	dir := filepath.Join(m.basePath, "collections", name)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return nil
	}
	return os.RemoveAll(dir)
}

// LoadEnvironments reads all environment files from ~/.pulse/environments/
func (m *Manager) LoadEnvironments() ([]SavedEnvironment, error) {
	envsDir := filepath.Join(m.basePath, "environments")
	entries, err := os.ReadDir(envsDir)
	if err != nil {
		return nil, err
	}

	var envs []SavedEnvironment
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		filePath := filepath.Join(envsDir, entry.Name())
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var env SavedEnvironment
		if err := json.Unmarshal(data, &env); err == nil {
			envs = append(envs, env)
		}
	}

	return envs, nil
}

// SaveEnvironment writes an environment as a JSON file to disk
func (m *Manager) SaveEnvironment(env SavedEnvironment) error {
	if env.ID == "" {
		env.ID = fmt.Sprintf("env_%d", time.Now().UnixNano())
	}

	envsDir := filepath.Join(m.basePath, "environments")
	filePath := filepath.Join(envsDir, env.ID+".json")

	bytes, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize environment: %w", err)
	}

	return os.WriteFile(filePath, bytes, 0644)
}

// DeleteEnvironment deletes an environment file from disk
func (m *Manager) DeleteEnvironment(id string) error {
	filePath := filepath.Join(m.basePath, "environments", id+".json")
	return os.Remove(filePath)
}

// Helper to remove invalid characters from names
func sanitizeFileName(name string) string {
	r := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return r.Replace(name)
}
