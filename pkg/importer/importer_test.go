package importer

import (
	"encoding/json"
	"pulse/pkg/storage"
	"strings"
	"testing"
)

func TestParseCollectionJSON_AutoDetectsOpenAPIv3JSON(t *testing.T) {
	spec := `{
  "openapi": "3.0.3",
  "info": { "title": "Storefront v3 API", "version": "1.0.0" },
  "servers": [
    {
      "url": "https://{env}.example.com:{port}/api/v3",
      "variables": {
        "env": { "default": "api" },
        "port": { "default": "8443" }
      }
    }
  ],
  "security": [{ "bearerAuth": [] }],
  "components": {
    "securitySchemes": {
      "bearerAuth": { "type": "http", "scheme": "bearer" }
    },
    "schemas": {
      "CreateItem": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "example": "Mechanical Keyboard" },
          "price": { "type": "number", "default": 149.99 },
          "inStock": { "type": "boolean" }
        }
      }
    },
    "requestBodies": {
      "ItemBody": {
        "content": {
          "application/json": {
            "schema": { "$ref": "#/components/schemas/CreateItem" }
          }
        }
      }
    }
  },
  "paths": {
    "/items/{itemId}": {
      "parameters": [
        { "name": "itemId", "in": "path", "required": true, "schema": { "type": "string", "example": "42" } },
        { "name": "X-Trace-Id", "in": "header", "schema": { "type": "string", "default": "{{$uuid}}" } }
      ],
      "post": {
        "summary": "Update Item",
        "parameters": [
          { "name": "dryRun", "in": "query", "schema": { "type": "boolean", "default": false } }
        ],
        "requestBody": { "$ref": "#/components/requestBodies/ItemBody" }
      }
    }
  }
}`

	collName, reqs, err := ParseCollectionJSON(spec)
	if err != nil {
		t.Fatalf("ParseCollectionJSON failed: %v", err)
	}
	if collName != "Storefront v3 API" {
		t.Fatalf("expected collection 'Storefront v3 API', got %q", collName)
	}
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(reqs))
	}

	req := reqs[0]
	if req.Name != "Update Item" || req.Method != "POST" {
		t.Fatalf("unexpected request name/method: %q %q", req.Name, req.Method)
	}
	if req.URL != "https://api.example.com:8443/api/v3/items/42" {
		t.Fatalf("unexpected resolved server+path URL: %q", req.URL)
	}
	if len(req.QueryParams) != 1 || req.QueryParams[0].Key != "dryRun" || req.QueryParams[0].Value != "false" {
		t.Fatalf("unexpected queryParams: %+v", req.QueryParams)
	}

	headerMap := map[string]string{}
	for _, h := range req.Headers {
		headerMap[h.Key] = h.Value
	}
	if headerMap["Authorization"] != "Bearer {{token}}" {
		t.Fatalf("expected Bearer auth header, got %+v", req.Headers)
	}
	if headerMap["X-Trace-Id"] != "{{$uuid}}" {
		t.Fatalf("expected inherited path header X-Trace-Id, got %+v", req.Headers)
	}
	if headerMap["Content-Type"] != "application/json" {
		t.Fatalf("expected Content-Type application/json, got %+v", req.Headers)
	}

	if req.Body.Type != "json" {
		t.Fatalf("expected json body type, got %q", req.Body.Type)
	}
	var bodyObj map[string]interface{}
	if err := json.Unmarshal([]byte(req.Body.Raw), &bodyObj); err != nil {
		t.Fatalf("expected valid JSON generated from schema, got %q: %v", req.Body.Raw, err)
	}
	if bodyObj["name"] != "Mechanical Keyboard" || bodyObj["price"] != 149.99 || bodyObj["inStock"] != true {
		t.Fatalf("unexpected generated body fields: %+v", bodyObj)
	}
}

func TestParseCollectionJSON_AutoDetectsOpenAPIv31YAML(t *testing.T) {
	yamlSpec := `
openapi: "3.1.0"
info:
  title: Auth Service v3.1
servers:
  - url: /v1
paths:
  /login:
    post:
      operationId: loginUser
      requestBody:
        content:
          application/x-www-form-urlencoded:
            schema:
              type: object
              properties:
                username:
                  type: ["string", "null"]
                  examples:
                    - admin
                password:
                  type: string
                  default: secret
`
	collName, reqs, err := ParseCollectionJSON(yamlSpec)
	if err != nil {
		t.Fatalf("ParseCollectionJSON YAML failed: %v", err)
	}
	if collName != "Auth Service v3.1" || len(reqs) != 1 {
		t.Fatalf("unexpected result: coll=%q len=%d", collName, len(reqs))
	}
	req := reqs[0]
	if req.Name != "loginUser" || req.URL != "http://localhost/v1/login" {
		t.Fatalf("unexpected name/url: %q %q", req.Name, req.URL)
	}
	if req.Body.Type != "x-www-form-urlencoded" || !strings.Contains(req.Body.Raw, "username=admin") || !strings.Contains(req.Body.Raw, "password=secret") {
		t.Fatalf("unexpected form body: type=%q raw=%q", req.Body.Type, req.Body.Raw)
	}
}

func TestParseCollectionJSON_AutoDetectsOpenAPIv2AndCollection(t *testing.T) {
	oa2 := `{
  "swagger": "2.0",
  "info": { "title": "Legacy v2 API" },
  "host": "localhost:8090",
  "basePath": "/api",
  "schemes": ["http"],
  "paths": {
    "/ping": {
      "get": { "summary": "Ping" }
    }
  }
}`
	collName, reqs, err := ParseCollectionJSON(oa2)
	if err != nil || collName != "Legacy v2 API" || len(reqs) != 1 || reqs[0].URL != "http://localhost:8090/api/ping" {
		t.Fatalf("OpenAPI v2 failed: coll=%q reqs=%+v err=%v", collName, reqs, err)
	}

	pmColl := `{
  "info": { "name": "Direct Collection" },
  "item": [
    { "name": "Health", "request": { "method": "GET", "url": "http://localhost:8090/health" } }
  ]
}`
	collName2, reqs2, err2 := ParseCollectionJSON(pmColl)
	if err2 != nil || collName2 != "Direct Collection" || len(reqs2) != 1 {
		t.Fatalf("Collection JSON failed: coll=%q reqs=%+v err=%v", collName2, reqs2, err2)
	}
}

func TestParseCollectionWithFolders_PreservesExactHierarchy(t *testing.T) {
	nestedSpec := `{
  "info": { "name": "Enterprise Suite" },
  "item": [
    {
      "name": "1. Auth",
      "item": [
        { "name": "Login", "request": { "method": "POST", "url": "http://localhost/login" } },
        {
          "name": "OAuth2",
          "item": [
            { "name": "Refresh Token", "request": { "method": "POST", "url": "http://localhost/oauth/refresh" } }
          ]
        }
      ]
    },
    {
      "name": "2. Empty Staging",
      "item": []
    },
    {
      "name": "Health Check",
      "request": { "method": "GET", "url": "http://localhost/health" }
    }
  ]
}`

	res, err := ParseCollectionWithFolders(nestedSpec)
	if err != nil {
		t.Fatalf("ParseCollectionWithFolders failed: %v", err)
	}
	if res.CollectionName != "Enterprise Suite" {
		t.Fatalf("unexpected CollectionName: %q", res.CollectionName)
	}

	wantFolders := map[string]bool{
		"Enterprise Suite":                  true,
		"Enterprise Suite/1. Auth":          true,
		"Enterprise Suite/1. Auth/OAuth2":   true,
		"Enterprise Suite/2. Empty Staging": true,
	}
	for f := range wantFolders {
		found := false
		for _, got := range res.Folders {
			if got == f {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected folder %q in %v", f, res.Folders)
		}
	}

	if len(res.Requests) != 3 {
		t.Fatalf("expected 3 requests, got %d", len(res.Requests))
	}
	byName := map[string]string{}
	for _, r := range res.Requests {
		byName[r.Name] = r.Collection
	}
	if byName["Login"] != "Enterprise Suite/1. Auth" {
		t.Fatalf("expected Login in 'Enterprise Suite/1. Auth', got %q", byName["Login"])
	}
	if byName["Refresh Token"] != "Enterprise Suite/1. Auth/OAuth2" {
		t.Fatalf("expected Refresh Token in 'Enterprise Suite/1. Auth/OAuth2', got %q", byName["Refresh Token"])
	}
	if byName["Health Check"] != "Enterprise Suite" {
		t.Fatalf("expected Health Check in 'Enterprise Suite', got %q", byName["Health Check"])
	}
}

func TestOpenAPIAndCollection_FourLevelNestedFolders(t *testing.T) {
	oa3 := `{
  "openapi": "3.0.3",
  "info": { "title": "DeepAPI" },
  "paths": {
    "/items": {
      "get": {
        "summary": "List Items",
        "tags": ["1/2/3/4"]
      }
    }
  }
}`
	res, err := ParseCollectionWithFolders(oa3)
	if err != nil {
		t.Fatalf("ParseCollectionWithFolders failed: %v", err)
	}
	if len(res.Requests) != 1 || res.Requests[0].Collection != "DeepAPI/1/2/3/4" {
		t.Fatalf("expected Collection 'DeepAPI/1/2/3/4', got %+v", res.Requests)
	}
	want := []string{"DeepAPI", "DeepAPI/1", "DeepAPI/1/2", "DeepAPI/1/2/3", "DeepAPI/1/2/3/4"}
	if len(res.Folders) != len(want) {
		t.Fatalf("expected %v folders, got %v", want, res.Folders)
	}
	for i, w := range want {
		if res.Folders[i] != w {
			t.Fatalf("folder[%d]: expected %q, got %q", i, w, res.Folders[i])
		}
	}
}

func TestOpenAPI_StripsRedundantRootPrefixFromTagFolder(t *testing.T) {
	oa3 := `{
  "openapi": "3.0.1",
  "info": { "title": "Kinto Global API" },
  "paths": {
    "/contracts": {
      "get": {
        "summary": "List Contracts",
        "tags": ["Kinto Global API-Contract"]
      }
    },
    "/documents": {
      "get": {
        "summary": "List Documents",
        "tags": ["Document"]
      }
    },
    "/drivers": {
      "get": {
        "summary": "List Drivers",
        "tags": ["Kinto Global API/Driver/SubA"]
      }
    }
  }
}`
	res, err := ParseCollectionWithFolders(oa3)
	if err != nil {
		t.Fatalf("ParseCollectionWithFolders failed: %v", err)
	}
	gotBySummary := map[string]string{}
	for _, r := range res.Requests {
		gotBySummary[r.Name] = r.Collection
	}
	if gotBySummary["List Contracts"] != "Kinto Global API/Contract" {
		t.Fatalf("expected 'Kinto Global API/Contract', got %q", gotBySummary["List Contracts"])
	}
	if gotBySummary["List Documents"] != "Kinto Global API/Document" {
		t.Fatalf("expected 'Kinto Global API/Document', got %q", gotBySummary["List Documents"])
	}
	if gotBySummary["List Drivers"] != "Kinto Global API/Driver/SubA" {
		t.Fatalf("expected 'Kinto Global API/Driver/SubA', got %q", gotBySummary["List Drivers"])
	}
}

func TestOpenAPIv3_MultiTagPlacesRequestInAllTaggedDirectories(t *testing.T) {
	oa3 := `{
  "openapi": "3.0.3",
  "info": { "title": "Kinto Global API" },
  "paths": {
    "/companies": {
      "get": {
        "summary": "Get Companies",
        "tags": ["Kinto Global API-Unit Account", "Kinto Global API / Documents"]
      }
    }
  }
}`
	res, err := ParseCollectionWithFolders(oa3)
	if err != nil {
		t.Fatalf("ParseCollectionWithFolders failed: %v", err)
	}
	if len(res.Requests) != 2 {
		t.Fatalf("expected 2 requests (1 in Unit Account, 1 in Documents), got %d: %+v", len(res.Requests), res.Requests)
	}
	dirs := map[string]bool{}
	for _, r := range res.Requests {
		dirs[r.Collection] = true
	}
	if !dirs["Kinto Global API/Unit Account"] || !dirs["Kinto Global API/Documents"] {
		t.Fatalf("expected requests in both Unit Account and Documents, got %+v", dirs)
	}
}

func TestFolderRequestsJSON_NestedImport(t *testing.T) {
	doc := `{
  "v": 2,
  "name": "Kinto Global API",
  "folders": [
    {
      "v": 2,
      "name": "Unit Account",
      "folders": [],
      "requests": [
        { "name": "Get Company", "method": "GET", "endpoint": "https://api.example.com/unit/company" }
      ]
    },
    {
      "v": 2,
      "name": "Documents",
      "folders": [],
      "requests": [
        { "name": "Get Companies", "method": "GET", "endpoint": "https://api.example.com/docs/companies" }
      ]
    }
  ],
  "requests": []
}`
	res, err := ParseCollectionWithFolders(doc)
	if err != nil {
		t.Fatalf("ParseCollectionWithFolders failed: %v", err)
	}
	if len(res.Requests) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(res.Requests))
	}
	if res.Requests[0].Collection != "Kinto Global API/Unit Account" || res.Requests[1].Collection != "Kinto Global API/Documents" {
		t.Fatalf("unexpected folder paths: %+v", res.Requests)
	}
}

func TestOpenAPIv3_BOMRootTagAndDeclaredEmptyFolders(t *testing.T) {
	oa3 := "\ufeff" + `{
  "openapi": "3.0.3",
  "info": { "title": "Kinto Global API" },
  "tags": [
    { "name": "Kinto Global API/EmptyStaging" }
  ],
  "paths": {
    "/root-ping": {
      "get": {
        "summary": "Root Ping",
        "tags": ["Kinto Global API"]
      }
    }
  }
}`
	res, err := ParseCollectionWithFolders(oa3)
	if err != nil {
		t.Fatalf("ParseCollectionWithFolders failed: %v", err)
	}
	if len(res.Requests) != 1 || res.Requests[0].Collection != "Kinto Global API" {
		t.Fatalf("expected tag matching root title to land in 'Kinto Global API', got %+v", res.Requests)
	}
	foundEmpty := false
	for _, f := range res.Folders {
		if f == "Kinto Global API/EmptyStaging" {
			foundEmpty = true
			break
		}
	}
	if !foundEmpty {
		t.Fatalf("expected declared empty tag folder in %v", res.Folders)
	}
}

func TestOpenAPIv3_DuplicatePathKeysDuplicateMethodKeysAndTagObjects(t *testing.T) {
	oa3 := `{
  "openapi": "3.0.3",
  "info": { "title": "Kinto-Global-API" },
  "paths": {
    "/workspaces": {
      "get": { "summary": "Get Workspaces", "tags": ["Unit-Account"] }
    },
    "/workspaces": {
      "get": { "summary": "Get Workspaces", "tags": ["Driver"] },
      "get": { "summary": "Get Workspaces", "tags": [{ "name": "Fleet-Manager" }] }
    }
  }
}`
	res, err := ParseCollectionWithFolders(oa3)
	if err != nil {
		t.Fatalf("ParseCollectionWithFolders failed: %v", err)
	}
	if len(res.Requests) != 3 {
		t.Fatalf("expected all 3 duplicate-key requests preserved, got %d: %+v", len(res.Requests), res.Requests)
	}
	seenIDs := map[string]bool{}
	seenDirs := map[string]bool{}
	for _, r := range res.Requests {
		if seenIDs[r.ID] {
			t.Fatalf("duplicate request ID %q", r.ID)
		}
		seenIDs[r.ID] = true
		seenDirs[r.Collection] = true
	}
	for _, wantDir := range []string{
		"Kinto-Global-API/Unit-Account",
		"Kinto-Global-API/Driver",
		"Kinto-Global-API/Fleet-Manager",
	} {
		if !seenDirs[wantDir] {
			t.Fatalf("missing folder %q in %+v", wantDir, seenDirs)
		}
	}
}

func TestCollectionArray_ImportsAllCollectionsWithUniqueIDs(t *testing.T) {
	arr := `[
  {
    "v": 2,
    "name": "Kinto-Global-API",
    "folders": [
      { "name": "Unit-Account", "requests": [{ "name": "Get Workspaces", "method": "GET", "endpoint": "https://api.example.com/workspaces" }] },
      { "name": "Driver", "requests": [{ "name": "Get Workspaces", "method": "GET", "endpoint": "https://api.example.com/workspaces" }] }
    ]
  },
  {
    "v": 2,
    "name": "POC",
    "requests": [{ "name": "CreateVehicleMileage", "method": "POST", "endpoint": "https://api.example.com/mileage" }]
  }
]`
	res, err := ParseCollectionWithFolders(arr)
	if err != nil {
		t.Fatalf("ParseCollectionWithFolders array failed: %v", err)
	}
	if len(res.Requests) != 3 {
		t.Fatalf("expected 3 requests from JSON array, got %d", len(res.Requests))
	}
	seenIDs := map[string]bool{}
	for _, r := range res.Requests {
		if seenIDs[r.ID] {
			t.Fatalf("duplicate ID %q in array import", r.ID)
		}
		seenIDs[r.ID] = true
	}
}

func TestOpenAPI_HoppscotchDroppedRequests(t *testing.T) {
	oa3 := `{
  "openapi": "3.0.3",
  "info": { "title": "Kinto-Global-API" },
  "paths": {
    "/workspaces": {
      "get": {
        "summary": "Get Workspaces",
        "tags": ["Unit-Account"]
      }
    }
  },
  "x-hoppscotch-dropped-requests": [
    {
      "tagPath": "Driver",
      "request": {
        "name": "Get Workspaces",
        "method": "GET",
        "endpoint": "<<baseUrl>>/workspaces",
        "params": [
          { "key": "page", "value": "1", "active": true },
          { "key": "<<filterKey>>", "value": "<<filterVal>>" }
        ],
        "headers": [
          { "key": "Authorization", "value": "Bearer <<token>>", "active": true }
        ]
      }
    },
    {
      "tagPath": "Fleet-Manager",
      "request": {
        "name": "Get Workspaces",
        "method": "GET",
        "endpoint": "<<baseUrl>>/workspaces"
      }
    }
  ]
}`
	res, err := ParseCollectionWithFolders(oa3)
	if err != nil {
		t.Fatalf("ParseCollectionWithFolders failed: %v", err)
	}
	if len(res.Requests) != 3 {
		t.Fatalf("expected 3 requests including Hoppscotch dropped requests, got %d: %+v", len(res.Requests), res.Requests)
	}

	dirs := map[string]int{}
	for _, r := range res.Requests {
		dirs[r.Collection]++
		if r.Name != "Get Workspaces" {
			t.Errorf("unexpected request name: %s", r.Name)
		}
	}

	if dirs["Kinto-Global-API/Unit-Account"] != 1 {
		t.Errorf("expected 1 in Unit-Account, got %d", dirs["Kinto-Global-API/Unit-Account"])
	}
	if dirs["Kinto-Global-API/Driver"] != 1 {
		t.Errorf("expected 1 in Driver, got %d", dirs["Kinto-Global-API/Driver"])
	}
	if dirs["Kinto-Global-API/Fleet-Manager"] != 1 {
		t.Errorf("expected 1 in Fleet-Manager, got %d", dirs["Kinto-Global-API/Fleet-Manager"])
	}

	var driverReq *storage.SavedRequest
	for i := range res.Requests {
		if res.Requests[i].Collection == "Kinto-Global-API/Driver" {
			driverReq = &res.Requests[i]
			break
		}
	}
	if driverReq == nil {
		t.Fatalf("driverReq not found")
	}
	if driverReq.URL != "{{baseUrl}}/workspaces" {
		t.Errorf("expected variable converted to {{baseUrl}}/workspaces, got %s", driverReq.URL)
	}
	if len(driverReq.Headers) != 1 || driverReq.Headers[0].Value != "Bearer {{token}}" {
		t.Errorf("expected header variable converted, got %+v", driverReq.Headers)
	}
}
