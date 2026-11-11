package main

import (
	"pulse/pkg/storage"
	"testing"
)

func TestAppImport_SameNameAcrossDifferentDirsPreservedAndSameDirUpdated(t *testing.T) {
	store, err := storage.NewManagerWithBasePath(t.TempDir())
	if err != nil {
		t.Fatalf("NewManagerWithBasePath failed: %v", err)
	}
	app := &App{storage: store}

	collJSON := `{
  "info": { "name": "Kinto Global API" },
  "item": [
    {
      "name": "Contract",
      "item": [
        { "name": "Get", "request": { "method": "GET", "url": "http://localhost/contract/1" } },
        { "name": "Create", "request": { "method": "POST", "url": "http://localhost/contract" } }
      ]
    },
    {
      "name": "Document",
      "item": [
        { "name": "Get", "request": { "method": "GET", "url": "http://localhost/document/1" } },
        { "name": "Create", "request": { "method": "POST", "url": "http://localhost/document" } }
      ]
    },
    {
      "name": "Driver",
      "item": [
        {
          "name": "A",
          "item": [
            { "name": "Get", "request": { "method": "GET", "url": "http://localhost/driver/a/1" } }
          ]
        }
      ]
    }
  ]
}`

	count, err := app.ImportCollectionJSON(collJSON)
	if err != nil {
		t.Fatalf("ImportCollectionJSON failed: %v", err)
	}
	if count != 5 {
		t.Fatalf("expected 5 imported requests across different dirs, got %d", count)
	}

	// Re-import with an updated URL in Contract -> Get; must update in place without adding duplicates
	collJSONUpdated := `{
  "info": { "name": "Kinto Global API" },
  "item": [
    {
      "name": "Contract",
      "item": [
        { "name": "Get", "request": { "method": "GET", "url": "http://localhost/contract/v2/1" } }
      ]
    }
  ]
}`
	count2, err := app.ImportCollectionJSON(collJSONUpdated)
	if err != nil || count2 != 1 {
		t.Fatalf("re-import failed: count=%d err=%v", count2, err)
	}

	colls, err := store.LoadCollections()
	if err != nil || len(colls) != 1 {
		t.Fatalf("expected 1 root collection, got %+v (err=%v)", colls, err)
	}
	root := colls[0]
	if root.Name != "Kinto Global API" || len(root.Folders) != 3 {
		t.Fatalf("expected 3 folders (Contract, Document, Driver), got %+v", root.Folders)
	}

	byName := map[string]storage.Collection{}
	for _, f := range root.Folders {
		byName[f.Name] = f
	}
	if len(byName["Contract"].Requests) != 2 {
		t.Fatalf("expected 2 requests in Contract (Create + updated Get), got %d", len(byName["Contract"].Requests))
	}
	if len(byName["Document"].Requests) != 2 {
		t.Fatalf("expected 2 requests in Document, got %d", len(byName["Document"].Requests))
	}
	if len(byName["Driver"].Folders) != 1 || len(byName["Driver"].Folders[0].Requests) != 1 {
		t.Fatalf("expected Driver/A to have 1 request, got %+v", byName["Driver"])
	}

	// Verify Contract -> Get has the updated URL while Document -> Get kept its own URL
	for _, r := range byName["Contract"].Requests {
		if r.Name == "Get" && r.URL != "http://localhost/contract/v2/1" {
			t.Fatalf("expected Contract/Get URL updated, got %q", r.URL)
		}
	}
	for _, r := range byName["Document"].Requests {
		if r.Name == "Get" && r.URL != "http://localhost/document/1" {
			t.Fatalf("expected Document/Get URL untouched, got %q", r.URL)
		}
	}
}

func TestAppImport_OpenAPIv3MultiTagKeepsBothUnitAccountAndDocuments(t *testing.T) {
	store, err := storage.NewManagerWithBasePath(t.TempDir())
	if err != nil {
		t.Fatalf("NewManagerWithBasePath failed: %v", err)
	}
	app := &App{storage: store}

	oa3 := `{
  "openapi": "3.0.3",
  "info": { "title": "Kinto Global API" },
  "paths": {
    "/companies": {
      "get": {
        "summary": "Get Companies",
        "tags": ["Kinto Global API-Unit Account", "Kinto Global API/Documents"]
      }
    }
  }
}`
	count, err := app.ImportCollectionJSON(oa3)
	if err != nil || count != 2 {
		t.Fatalf("expected 2 requests imported, got count=%d err=%v", count, err)
	}

	colls, err := store.LoadCollections()
	if err != nil || len(colls) != 1 || len(colls[0].Folders) != 2 {
		t.Fatalf("expected 2 folders under Kinto Global API, got %+v (err=%v)", colls, err)
	}
	for _, f := range colls[0].Folders {
		if len(f.Requests) != 1 || f.Requests[0].Name != "Get Companies" {
			t.Fatalf("expected Get Companies inside folder %q, got %+v", f.Name, f.Requests)
		}
	}
}

func TestAppImport_OpenAPIv3MultipleDirsWithDuplicatesInsideEachDir(t *testing.T) {
	store, err := storage.NewManagerWithBasePath(t.TempDir())
	if err != nil {
		t.Fatalf("NewManagerWithBasePath failed: %v", err)
	}
	app := &App{storage: store}

	oa3 := "\ufeff" + `{
  "openapi": "3.0.3",
  "info": { "title": "Kinto Global API", "version": "1.0.0" },
  "servers": [{ "url": "https://api.kinto.example.com" }],
  "paths": {
    "/documents/companies": {
      "get": {
        "summary": "Get Companies",
        "tags": ["Kinto Global API/Documents"]
      },
      "POST": {
        "summary": "Get Companies",
        "tags": ["Kinto Global API/Documents"]
      }
    },
    "/unit-account/companies": {
      "get": {
        "summary": "Get Companies",
        "tags": ["Kinto Global API-Unit Account"]
      },
      "put": {
        "summary": "Get Companies",
        "tags": ["Kinto Global API-Unit Account"]
      }
    },
    "/nested/companies": {
      "get": {
        "summary": "Get Companies",
        "tags": ["1/2/3/4"]
      },
      "delete": {
        "summary": "Get Companies",
        "tags": ["1/2/3/4"]
      }
    },
    "/shared/health": {
      "get": {
        "summary": "Shared Check",
        "tags": ["Kinto Global API/Documents", "Kinto Global API-Unit Account", "1/2/3/4"]
      }
    }
  }
}`

	count, err := app.ImportCollectionJSON(oa3)
	if err != nil {
		t.Fatalf("ImportCollectionJSON failed: %v", err)
	}
	if count != 9 {
		t.Fatalf("expected 9 imported requests across 3 dirs (3 per dir), got %d", count)
	}

	// Re-importing the exact same spec must keep exactly 9 requests (no extra duplicates)
	count2, err := app.ImportCollectionJSON(oa3)
	if err != nil {
		t.Fatalf("re-import failed: %v", err)
	}
	if count2 != 9 {
		t.Fatalf("expected 9 requests processed on re-import, got %d", count2)
	}

	colls, err := store.LoadCollections()
	if err != nil || len(colls) != 1 {
		t.Fatalf("expected 1 root collection, got %+v (err=%v)", colls, err)
	}
	var totalLoaded int
	byFolderPath := map[string][]storage.SavedRequest{}
	var walk func(c storage.Collection)
	walk = func(c storage.Collection) {
		byFolderPath[c.Path] = c.Requests
		totalLoaded += len(c.Requests)
		for _, sub := range c.Folders {
			walk(sub)
		}
	}
	walk(colls[0])
	if totalLoaded != 9 {
		t.Fatalf("expected 9 total requests on disk after re-import, got %d", totalLoaded)
	}
	for _, wantDir := range []string{
		"Kinto Global API/Documents",
		"Kinto Global API/Unit Account",
		"Kinto Global API/1/2/3/4",
	} {
		reqs := byFolderPath[wantDir]
		if len(reqs) != 3 {
			t.Fatalf("expected 3 requests in %q (2 duplicate-named ops + 1 shared), got %d: %+v", wantDir, len(reqs), reqs)
		}
	}
}

func TestAppImport_AtomAlphaBetaGammaWithDuplicateX(t *testing.T) {
	specs := map[string]string{
		"openapi_v3_multitag": `{
  "openapi": "3.0.3",
  "info": { "title": "Atom", "version": "1.0.0" },
  "paths": {
    "/x": {
      "get": {
        "summary": "X",
        "tags": ["Atom/Alpha", "Atom-Beta", "Gamma"]
      }
    }
  }
}`,
		"openapi_v3_separate_paths": `{
  "openapi": "3.0.3",
  "info": { "title": "Atom", "version": "1.0.0" },
  "paths": {
    "/alpha/x": { "get": { "summary": "X", "tags": ["Alpha"] } },
    "/beta/x":  { "get": { "summary": "X", "tags": ["Atom/Beta"] } },
    "/gamma/x": { "get": { "summary": "X", "tags": ["Atom-Gamma"] } }
  }
}`,
		"folder_requests_v2": `{
  "v": 2,
  "name": "Atom",
  "folders": [
    { "name": "Alpha", "folders": [], "requests": [{ "name": "X", "method": "GET", "endpoint": "https://example.com/x" }] },
    { "name": "Beta",  "folders": [], "requests": [{ "name": "X", "method": "GET", "endpoint": "https://example.com/x" }] },
    { "name": "Gamma", "folders": [], "requests": [{ "name": "X", "method": "GET", "endpoint": "https://example.com/x" }] }
  ],
  "requests": []
}`,
	}

	for name, spec := range specs {
		t.Run(name, func(t *testing.T) {
			store, err := storage.NewManagerWithBasePath(t.TempDir())
			if err != nil {
				t.Fatalf("NewManagerWithBasePath failed: %v", err)
			}
			app := &App{storage: store}

			count, err := app.ImportCollectionJSON(spec)
			if err != nil || count != 3 {
				t.Fatalf("expected 3 requests imported for %s, got count=%d err=%v", name, count, err)
			}
			colls, err := store.LoadCollections()
			if err != nil || len(colls) != 1 || colls[0].Name != "Atom" || len(colls[0].Folders) != 3 {
				t.Fatalf("expected Atom with Alpha, Beta, Gamma folders for %s, got %+v (err=%v)", name, colls, err)
			}
			for _, f := range colls[0].Folders {
				if len(f.Requests) != 1 || f.Requests[0].Name != "X" {
					t.Fatalf("%s: expected request X inside folder %q, got %+v", name, f.Name, f.Requests)
				}
			}
		})
	}
}

func TestAppImport_KintoGlobalPhotoLayoutPreservesSharedRequestsAcrossUnitAccountDriverFleetManager(t *testing.T) {
	store, err := storage.NewManagerWithBasePath(t.TempDir())
	if err != nil {
		t.Fatalf("NewManagerWithBasePath failed: %v", err)
	}
	app := &App{storage: store}

	oa3 := `{
  "openapi": "3.0.3",
  "info": { "title": "Kinto-Global-API", "version": "1.0.0" },
  "paths": {
    "/workspaces": {
      "get": {
        "summary": "Get Workspaces",
        "tags": ["Kinto-Global-API-Unit-Account", "Kinto-Global-API-Driver", "Kinto-Global-API-Fleet-Manager"]
      },
      "delete": {
        "summary": "Delete Workspace",
        "tags": ["Driver"]
      }
    },
    "/companies": {
      "get": {
        "summary": "Get Companies",
        "tags": ["Unit-Account", "Driver"]
      },
      "delete": {
        "summary": "Delete Companies",
        "tags": ["Driver"]
      }
    },
    "/company-departments": {
      "get": { "summary": "Get Company Departments", "tags": ["Driver"] },
      "post": { "summary": "Create Company Departments", "tags": ["Unit-Account"] }
    },
    "/company-custom-details": {
      "get": { "summary": "Get Company Custom Details", "tags": ["Unit-Account"] }
    },
    "/addresses": {
      "post": { "summary": "Create Addresses", "tags": ["Customer", "Driver"] }
    },
    "/drivers": {
      "get": { "summary": "Get Drivers", "tags": ["Driver"] },
      "post": { "summary": "Create Driver", "tags": ["Driver"] }
    },
    "/drivers/custom": {
      "put": { "summary": "Update Driver Custom details", "tags": ["Driver"] }
    },
    "/drivers/company": {
      "post": { "summary": "Create Driver Company", "tags": ["Driver"] }
    },
    "/drivers/contact": {
      "post": { "summary": "Create Driver Contact", "tags": ["Driver"] }
    },
    "/users": {
      "get": { "summary": "Get Users", "tags": ["Fleet-Manager"] },
      "post": { "summary": "Create user", "tags": ["Customer", "Fleet-Manager"] }
    },
    "/users/member": {
      "put": { "summary": "Update workspace member", "tags": ["Fleet-Manager"] }
    },
    "/users/contact": {
      "post": { "summary": "Create user contact", "tags": ["Fleet-Manager"] }
    }
  }
}`

	count, err := app.ImportCollectionJSON(oa3)
	if err != nil {
		t.Fatalf("ImportCollectionJSON failed: %v", err)
	}
	if count != 22 {
		t.Fatalf("expected 22 imported requests (Customer=2, Unit-Account=4, Driver=11, Fleet-Manager=5), got %d", count)
	}

	colls, err := store.LoadCollections()
	if err != nil || len(colls) != 1 {
		t.Fatalf("expected 1 root collection, got %+v (err=%v)", colls, err)
	}
	gotCounts := map[string]int{}
	for _, f := range colls[0].Folders {
		gotCounts[f.Name] = len(f.Requests)
	}
	wantCounts := map[string]int{
		"Customer":      2,
		"Unit-Account":  4,
		"Driver":        11,
		"Fleet-Manager": 5,
	}
	for dir, want := range wantCounts {
		if gotCounts[dir] != want {
			t.Fatalf("folder %q: expected %d requests, got %d (all=%+v)", dir, want, gotCounts[dir], gotCounts)
		}
	}
}
