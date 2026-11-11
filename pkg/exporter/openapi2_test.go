package exporter

import (
	"encoding/json"
	"testing"

	"pulse/pkg/engine"
	"pulse/pkg/storage"
)

func TestCollectionToOpenAPI2(t *testing.T) {
	coll := storage.Collection{
		ID:   "coll_test",
		Name: "Pulse Test Suite",
		Requests: []storage.SavedRequest{
			{
				ID:     "1",
				Name:   "List Items",
				Method: "GET",
				URL:    "http://localhost:8090/api/v1/items?category=electronics",
				Headers: []engine.HeaderPair{
					{Key: "Authorization", Value: "Bearer tok", Enabled: true},
				},
			},
			{
				ID:     "2",
				Name:   "Create Item",
				Method: "POST",
				URL:    "http://localhost:8090/api/v1/items",
				Body: engine.RequestBody{
					Type: "json",
					Raw:  `{"name":"Sensor","price":49.99}`,
				},
			},
			{
				ID:     "3",
				Name:   "SOAP Echo",
				Method: "POST",
				URL:    "http://localhost:8090/soap",
				Body: engine.RequestBody{
					Type: "xml",
					Raw:  `<soap:Envelope></soap:Envelope>`,
				},
			},
		},
	}

	spec := CollectionToOpenAPI2(coll, "1.0.0")
	if spec.Swagger != "2.0" {
		t.Fatalf("expected swagger 2.0, got %q", spec.Swagger)
	}
	if spec.Host != "localhost:8090" {
		t.Fatalf("expected host localhost:8090, got %q", spec.Host)
	}
	if _, ok := spec.Paths["/api/v1/items"]["get"]; !ok {
		t.Fatalf("expected GET /api/v1/items path")
	}
	if _, ok := spec.Paths["/api/v1/items"]["post"]; !ok {
		t.Fatalf("expected POST /api/v1/items path")
	}
	if _, ok := spec.Paths["/soap"]["post"]; !ok {
		t.Fatalf("expected POST /soap path")
	}

	raw, err := json.MarshalIndent(spec, "", "  ")
	if err != nil || len(raw) == 0 {
		t.Fatalf("failed to marshal spec: %v", err)
	}
}
