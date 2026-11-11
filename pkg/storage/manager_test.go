package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRenameCollection(t *testing.T) {
	baseDir := t.TempDir()
	mgr := &Manager{basePath: baseDir}

	if err := mgr.CreateCollection("Old Folder"); err != nil {
		t.Fatalf("CreateCollection failed: %v", err)
	}
	req := SavedRequest{
		ID:         "req_1",
		Name:       "Get Users",
		Collection: "Old Folder",
		Method:     "GET",
		URL:        "http://localhost:8090/users",
	}
	if err := mgr.SaveRequest(req); err != nil {
		t.Fatalf("SaveRequest failed: %v", err)
	}

	if err := mgr.RenameCollection("Old Folder", "New Folder"); err != nil {
		t.Fatalf("RenameCollection failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(baseDir, "collections", "Old Folder")); !os.IsNotExist(err) {
		t.Fatalf("expected old folder to be gone, stat err=%v", err)
	}

	colls, err := mgr.LoadCollections()
	if err != nil {
		t.Fatalf("LoadCollections failed: %v", err)
	}
	var found *Collection
	for i := range colls {
		if colls[i].Name == "New Folder" {
			found = &colls[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("expected renamed collection 'New Folder' in %+v", colls)
	}
	if len(found.Requests) != 1 || found.Requests[0].Collection != "New Folder" {
		t.Fatalf("expected request Collection='New Folder', got %+v", found.Requests)
	}

	// Duplicate destination should fail
	if err := mgr.CreateCollection("Existing"); err != nil {
		t.Fatalf("CreateCollection Existing failed: %v", err)
	}
	if err := mgr.RenameCollection("New Folder", "Existing"); err == nil {
		t.Fatalf("expected error when renaming to an existing collection")
	}
}
