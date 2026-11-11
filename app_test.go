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
