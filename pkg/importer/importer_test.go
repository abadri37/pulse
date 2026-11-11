package importer

import (
	"encoding/json"
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
