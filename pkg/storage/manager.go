package storage

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path"
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

	m, err := NewManagerWithBasePath(filepath.Join(homeDir, ".pulse"))
	if err != nil {
		return nil, err
	}

	// Seed with demo workspace if empty
	m.seedDefaultWorkspace()

	return m, nil
}

// NewManagerWithBasePath initializes a storage manager rooted at basePath without seeding defaults.
func NewManagerWithBasePath(basePath string) (*Manager, error) {
	collectionsPath := filepath.Join(basePath, "collections")
	environmentsPath := filepath.Join(basePath, "environments")

	if err := os.MkdirAll(collectionsPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create collections directory: %w", err)
	}
	if err := os.MkdirAll(environmentsPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create environments directory: %w", err)
	}

	return &Manager{basePath: basePath}, nil
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

func (m *Manager) resolveCollectionDir(folderPath string) (string, string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(folderPath), "\\", "/")
	rawParts := strings.Split(normalized, "/")
	parts := make([]string, 0, len(rawParts))
	for _, seg := range rawParts {
		s := strings.TrimSpace(seg)
		if s == "" {
			continue
		}
		if s == "." || s == ".." {
			return "", "", fmt.Errorf("invalid collection folder segment %q", s)
		}
		parts = append(parts, s)
	}
	if len(parts) == 0 {
		return "", "", fmt.Errorf("collection name cannot be empty")
	}

	relPath := strings.Join(parts, "/")
	pathSegments := append([]string{m.basePath, "collections"}, parts...)
	return relPath, filepath.Join(pathSegments...), nil
}

// LoadCollections reads all folders, nested subfolders, and JSON requests in ~/.pulse/collections/
func (m *Manager) LoadCollections() ([]Collection, error) {
	collectionsDir := filepath.Join(m.basePath, "collections")
	entries, err := os.ReadDir(collectionsDir)
	if err != nil {
		return nil, err
	}

	var collections []Collection
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		collName := entry.Name()
		collPath := filepath.Join(collectionsDir, collName)
		node, ok := m.loadCollectionNode(collPath, collName, collName)
		if ok {
			collections = append(collections, node)
		}
	}

	return collections, nil
}

func (m *Manager) loadCollectionNode(dirPath, relPath, leafName string) (Collection, bool) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return Collection{}, false
	}

	var requests []SavedRequest
	var folders []Collection

	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if entry.IsDir() {
			subRel := relPath + "/" + name
			subNode, ok := m.loadCollectionNode(filepath.Join(dirPath, name), subRel, name)
			if ok {
				folders = append(folders, subNode)
			}
			continue
		}
		if !strings.HasSuffix(name, ".json") {
			continue
		}

		data, err := os.ReadFile(filepath.Join(dirPath, name))
		if err != nil {
			continue
		}
		var req SavedRequest
		if err := json.Unmarshal(data, &req); err == nil {
			req.Collection = relPath
			requests = append(requests, req)
		}
	}

	sort.Slice(requests, func(i, j int) bool {
		return strings.ToLower(requests[i].Name) < strings.ToLower(requests[j].Name)
	})
	sort.Slice(folders, func(i, j int) bool {
		return strings.ToLower(folders[i].Name) < strings.ToLower(folders[j].Name)
	})

	return Collection{
		ID:       "coll_" + sanitizeFileName(relPath),
		Name:     leafName,
		Path:     relPath,
		Requests: requests,
		Folders:  folders,
	}, true
}

// SaveRequest saves or updates a request JSON file inside its collection or subfolder path
func (m *Manager) SaveRequest(req SavedRequest) error {
	relPath, collDir, err := m.resolveCollectionDir(req.Collection)
	if err != nil {
		relPath, collDir, err = m.resolveCollectionDir("General")
		if err != nil {
			return err
		}
	}
	req.Collection = relPath
	req.LastModifiedAt = time.Now().Unix()

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

// SaveOrUpdateByNameAndDir saves req inside its collection directory. If a request
// with the same name (case-insensitive) already exists in that exact same directory,
// it updates that request in place instead of creating a duplicate. Same-named requests
// in different directories are preserved as separate requests.
func (m *Manager) SaveOrUpdateByNameAndDir(req SavedRequest) error {
	_, err := m.SaveOrUpdateInCollectionBatch(req, nil)
	return err
}

// SaveOrUpdateInCollectionBatch saves req inside its collection directory while matching
// against existing unclaimed requests in that same directory. Priority order for matching:
//  1. Same Name + Method + URL (exact endpoint match)
//  2. Same Name + Method
//  3. Same Name
//
// Any matched (or newly created) request ID is recorded in claimedIDs so that batches
// containing intentional duplicate names within the same directory preserve every distinct
// request on initial import and update them 1-to-1 on re-import without creating extra copies.
func (m *Manager) SaveOrUpdateInCollectionBatch(req SavedRequest, claimedIDs map[string]bool) (string, error) {
	relPath, collDir, err := m.resolveCollectionDir(req.Collection)
	if err != nil {
		relPath, collDir, err = m.resolveCollectionDir("General")
		if err != nil {
			return "", err
		}
	}
	req.Collection = relPath

	trimmedName := strings.TrimSpace(req.Name)
	trimmedURL := strings.TrimSpace(req.URL)
	if trimmedName != "" {
		if entries, readErr := os.ReadDir(collDir); readErr == nil {
			var tier1ID, tier2ID, tier3ID string
			for _, entry := range entries {
				if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
					continue
				}
				data, err := os.ReadFile(filepath.Join(collDir, entry.Name()))
				if err != nil {
					continue
				}
				var existing SavedRequest
				if err := json.Unmarshal(data, &existing); err != nil {
					continue
				}
				if claimedIDs != nil && claimedIDs[existing.ID] {
					continue
				}
				if !strings.EqualFold(strings.TrimSpace(existing.Name), trimmedName) {
					continue
				}
				sameMethod := strings.EqualFold(strings.TrimSpace(existing.Method), strings.TrimSpace(req.Method))
				sameURL := strings.TrimSpace(existing.URL) == trimmedURL
				if sameMethod && sameURL && tier1ID == "" {
					tier1ID = existing.ID
					break
				}
				if sameMethod && tier2ID == "" {
					tier2ID = existing.ID
				} else if tier3ID == "" {
					tier3ID = existing.ID
				}
			}

			switch {
			case tier1ID != "":
				req.ID = tier1ID
			case tier2ID != "":
				req.ID = tier2ID
			case tier3ID != "":
				req.ID = tier3ID
			}
		}
	}

	if claimedIDs != nil {
		claimedIDs[req.ID] = true
	}
	return req.ID, m.SaveRequest(req)
}

// DeleteRequest deletes a request file from disk
func (m *Manager) DeleteRequest(id string, collectionName string) error {
	if strings.TrimSpace(collectionName) == "" {
		collectionName = "General"
	}
	_, collDir, err := m.resolveCollectionDir(collectionName)
	if err != nil {
		return err
	}

	filePath := filepath.Join(collDir, id+".json")
	return os.Remove(filePath)
}

// CreateCollection creates a new empty collection or nested subfolder on disk
func (m *Manager) CreateCollection(name string) error {
	_, dir, err := m.resolveCollectionDir(name)
	if err != nil {
		return err
	}
	return os.MkdirAll(dir, 0755)
}

// RenameCollection renames a collection or subfolder on disk and updates all requests under it
func (m *Manager) RenameCollection(oldName, newName string) error {
	oldRel, oldDir, err := m.resolveCollectionDir(oldName)
	if err != nil {
		return err
	}

	trimmedNew := strings.TrimSpace(newName)
	if trimmedNew == "" {
		return fmt.Errorf("collection name cannot be empty")
	}

	var targetRel string
	if strings.ContainsAny(trimmedNew, "/\\") {
		targetRel = trimmedNew
	} else {
		if trimmedNew == "." || trimmedNew == ".." {
			return fmt.Errorf("invalid collection name %q", trimmedNew)
		}
		parent := path.Dir(oldRel)
		if parent == "." {
			targetRel = trimmedNew
		} else {
			targetRel = parent + "/" + trimmedNew
		}
	}

	newRel, newDir, err := m.resolveCollectionDir(targetRel)
	if err != nil {
		return err
	}
	if oldRel == newRel {
		return nil
	}

	if _, err := os.Stat(oldDir); os.IsNotExist(err) {
		return fmt.Errorf("collection %q not found", oldRel)
	} else if err != nil {
		return err
	}

	// On case-insensitive filesystems (macOS), allow case-only renames of the same folder
	if !strings.EqualFold(oldRel, newRel) {
		if _, err := os.Stat(newDir); err == nil {
			return fmt.Errorf("collection %q already exists", newRel)
		} else if !os.IsNotExist(err) {
			return err
		}
	}

	if err := os.MkdirAll(filepath.Dir(newDir), 0755); err != nil {
		return err
	}
	if err := os.Rename(oldDir, newDir); err != nil {
		return err
	}

	return filepath.WalkDir(newDir, func(filePath string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".json") {
			return walkErr
		}
		raw, err := os.ReadFile(filePath)
		if err != nil {
			return err
		}
		var req SavedRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil
		}
		relFileDir, err := filepath.Rel(newDir, filepath.Dir(filePath))
		if err != nil || relFileDir == "." {
			req.Collection = newRel
		} else {
			req.Collection = newRel + "/" + filepath.ToSlash(relFileDir)
		}
		updated, err := json.MarshalIndent(req, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(filePath, updated, 0644)
	})
}

// DeleteCollection deletes a collection or subfolder and all nested items from disk
func (m *Manager) DeleteCollection(name string) error {
	_, dir, err := m.resolveCollectionDir(name)
	if err != nil {
		return err
	}
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
