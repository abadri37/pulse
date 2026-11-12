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

func TestNestedFoldersLoadAndRename(t *testing.T) {
	baseDir := t.TempDir()
	mgr := &Manager{basePath: baseDir}

	if err := mgr.CreateCollection("Suite/Auth/OAuth"); err != nil {
		t.Fatalf("CreateCollection nested failed: %v", err)
	}
	if err := mgr.SaveRequest(SavedRequest{
		ID:         "req_login",
		Name:       "Login",
		Collection: "Suite/Auth",
		Method:     "POST",
		URL:        "http://localhost/login",
	}); err != nil {
		t.Fatalf("SaveRequest Suite/Auth failed: %v", err)
	}
	if err := mgr.SaveRequest(SavedRequest{
		ID:         "req_token",
		Name:       "Token",
		Collection: "Suite/Auth/OAuth",
		Method:     "POST",
		URL:        "http://localhost/oauth/token",
	}); err != nil {
		t.Fatalf("SaveRequest Suite/Auth/OAuth failed: %v", err)
	}

	colls, err := mgr.LoadCollections()
	if err != nil || len(colls) != 1 {
		t.Fatalf("expected 1 top-level collection, got %+v (err=%v)", colls, err)
	}
	if colls[0].Path != "Suite" || len(colls[0].Folders) != 1 || colls[0].Folders[0].Name != "Auth" {
		t.Fatalf("unexpected hierarchy: %+v", colls[0])
	}
	authFolder := colls[0].Folders[0]
	if len(authFolder.Requests) != 1 || len(authFolder.Folders) != 1 || authFolder.Folders[0].Path != "Suite/Auth/OAuth" {
		t.Fatalf("unexpected Auth folder contents: %+v", authFolder)
	}

	// Rename subfolder in place: Suite/Auth -> Suite/Authentication
	if err := mgr.RenameCollection("Suite/Auth", "Authentication"); err != nil {
		t.Fatalf("RenameCollection subfolder failed: %v", err)
	}
	colls2, err := mgr.LoadCollections()
	if err != nil {
		t.Fatalf("LoadCollections after rename failed: %v", err)
	}
	renamedAuth := colls2[0].Folders[0]
	if renamedAuth.Path != "Suite/Authentication" || renamedAuth.Requests[0].Collection != "Suite/Authentication" {
		t.Fatalf("expected updated subfolder path, got %+v", renamedAuth)
	}
	if renamedAuth.Folders[0].Path != "Suite/Authentication/OAuth" || renamedAuth.Folders[0].Requests[0].Collection != "Suite/Authentication/OAuth" {
		t.Fatalf("expected updated grandchild path, got %+v", renamedAuth.Folders[0])
	}
}

func TestSaveOrUpdateByNameAndDir_SameDirUpdatesDifferentDirPreserved(t *testing.T) {
	baseDir := t.TempDir()
	mgr := &Manager{basePath: baseDir}

	reqContract := SavedRequest{
		ID:         "req_contract_1",
		Name:       "Get By Id",
		Collection: "Kinto Global API/Contract",
		Method:     "GET",
		URL:        "http://localhost/contracts/1",
	}
	reqDocument := SavedRequest{
		ID:         "req_document_1",
		Name:       "Get By Id",
		Collection: "Kinto Global API/Document",
		Method:     "GET",
		URL:        "http://localhost/documents/1",
	}

	if err := mgr.SaveOrUpdateByNameAndDir(reqContract); err != nil {
		t.Fatalf("SaveOrUpdate Contract failed: %v", err)
	}
	if err := mgr.SaveOrUpdateByNameAndDir(reqDocument); err != nil {
		t.Fatalf("SaveOrUpdate Document failed: %v", err)
	}

	// Re-importing same name in the SAME directory should update in place (no duplicate)
	reqContractUpdated := SavedRequest{
		ID:         "req_contract_new_id",
		Name:       "get by id",
		Collection: "Kinto Global API/Contract",
		Method:     "POST",
		URL:        "http://localhost/contracts/v2/1",
	}
	if err := mgr.SaveOrUpdateByNameAndDir(reqContractUpdated); err != nil {
		t.Fatalf("SaveOrUpdate Contract update failed: %v", err)
	}

	colls, err := mgr.LoadCollections()
	if err != nil || len(colls) != 1 {
		t.Fatalf("expected 1 root collection, got %+v (err=%v)", colls, err)
	}

	byFolder := map[string]Collection{}
	for _, sub := range colls[0].Folders {
		byFolder[sub.Name] = sub
	}
	if len(byFolder["Contract"].Requests) != 1 {
		t.Fatalf("expected 1 request in Contract (updated, not duplicated), got %d", len(byFolder["Contract"].Requests))
	}
	if byFolder["Contract"].Requests[0].ID != "req_contract_1" || byFolder["Contract"].Requests[0].URL != "http://localhost/contracts/v2/1" {
		t.Fatalf("expected Contract request updated in place, got %+v", byFolder["Contract"].Requests[0])
	}
	if len(byFolder["Document"].Requests) != 1 || byFolder["Document"].Requests[0].URL != "http://localhost/documents/1" {
		t.Fatalf("expected Document same-named request preserved separately, got %+v", byFolder["Document"].Requests)
	}
}

func TestMoveRequest_PreservesPayloadAcrossDirectories(t *testing.T) {
	baseDir := t.TempDir()
	mgr := &Manager{basePath: baseDir}

	req := SavedRequest{
		ID:         "req_move_1",
		Name:       "Get Workspaces",
		Collection: "Atom/Alpha",
		Method:     "GET",
		URL:        "https://api.example.com/workspaces",
	}
	if err := mgr.SaveRequest(req); err != nil {
		t.Fatalf("SaveRequest failed: %v", err)
	}
	if err := mgr.CreateCollection("Atom/Beta"); err != nil {
		t.Fatalf("CreateCollection failed: %v", err)
	}

	moved, err := mgr.MoveRequest("req_move_1", "Atom/Alpha", "Atom/Beta")
	if err != nil {
		t.Fatalf("MoveRequest failed: %v", err)
	}
	if moved.Collection != "Atom/Beta" {
		t.Fatalf("expected moved Collection Atom/Beta, got %q", moved.Collection)
	}

	colls, err := mgr.LoadCollections()
	if err != nil || len(colls) != 1 || len(colls[0].Folders) != 2 {
		t.Fatalf("expected Atom with Alpha and Beta, got %+v (err=%v)", colls, err)
	}
	for _, f := range colls[0].Folders {
		if f.Name == "Alpha" && len(f.Requests) != 0 {
			t.Fatalf("expected Alpha empty after move, got %+v", f.Requests)
		}
		if f.Name == "Beta" && (len(f.Requests) != 1 || f.Requests[0].ID != "req_move_1") {
			t.Fatalf("expected req_move_1 in Beta after move, got %+v", f.Requests)
		}
	}
}

func TestMoveAndReorderCollections(t *testing.T) {
	baseDir := t.TempDir()
	mgr := &Manager{basePath: baseDir}

	for _, dir := range []string{"RootA/ChildOne", "RootA/ChildTwo", "RootA/ChildThree", "RootB"} {
		if err := mgr.CreateCollection(dir); err != nil {
			t.Fatalf("CreateCollection(%s) failed: %v", dir, err)
		}
	}
	if err := mgr.SaveRequest(SavedRequest{
		ID:         "req_nested_1",
		Name:       "Ping",
		Collection: "RootA/ChildOne",
		Method:     "GET",
		URL:        "https://example.com/ping",
	}); err != nil {
		t.Fatalf("SaveRequest failed: %v", err)
	}

	// Reorder root collections and child subfolders
	if err := mgr.ReorderCollections("", []string{"RootB", "RootA"}); err != nil {
		t.Fatalf("ReorderCollections root failed: %v", err)
	}
	if err := mgr.ReorderCollections("RootA", []string{"ChildThree", "ChildTwo", "ChildOne"}); err != nil {
		t.Fatalf("ReorderCollections child failed: %v", err)
	}

	colls, err := mgr.LoadCollections()
	if err != nil || len(colls) != 2 {
		t.Fatalf("LoadCollections failed: %+v (err=%v)", colls, err)
	}
	if colls[0].Name != "RootB" || colls[1].Name != "RootA" {
		t.Fatalf("expected root order [RootB RootA], got [%s %s]", colls[0].Name, colls[1].Name)
	}
	rootA := colls[1]
	if len(rootA.Folders) != 3 ||
		rootA.Folders[0].Name != "ChildThree" ||
		rootA.Folders[1].Name != "ChildTwo" ||
		rootA.Folders[2].Name != "ChildOne" {
		t.Fatalf("unexpected child folder order: %+v", rootA.Folders)
	}

	// Self/descendant move must fail cleanly
	if _, err := mgr.MoveCollection("RootA", "RootA/ChildOne"); err == nil {
		t.Fatalf("expected moving folder into its own descendant to fail")
	}

	// Move RootA/ChildOne into RootB
	newPath, err := mgr.MoveCollection("RootA/ChildOne", "RootB")
	if err != nil || newPath != "RootB/ChildOne" {
		t.Fatalf("MoveCollection failed: path=%q err=%v", newPath, err)
	}
	colls2, err := mgr.LoadCollections()
	if err != nil || len(colls2[0].Folders) != 1 || colls2[0].Folders[0].Name != "ChildOne" {
		t.Fatalf("expected ChildOne inside RootB, got %+v (err=%v)", colls2[0], err)
	}
	if len(colls2[0].Folders[0].Requests) != 1 || colls2[0].Folders[0].Requests[0].Collection != "RootB/ChildOne" {
		t.Fatalf("expected nested request Collection updated to RootB/ChildOne, got %+v", colls2[0].Folders[0].Requests)
	}
}
