package script

import (
	"pulse/pkg/engine"
	"testing"
)

func TestSandboxMatchersAndEnv(t *testing.T) {
	sb := NewSandbox()
	vars, err := sb.ExecutePreRequest(`pulse.setEnv("ts", "12345");`, map[string]string{})
	if err != nil {
		t.Fatalf("pre-request failed: %v", err)
	}
	if vars["ts"] != "12345" {
		t.Fatalf("expected ts=12345, got %q", vars["ts"])
	}

	resp := engine.HTTPResponse{
		StatusCode: 200,
		StatusText: "200 OK",
		Body:       `{"token":"abc123","count":5}`,
		Size:       28,
	}
	postScript := `
		pulse.test("Status is 200", () => pulse.expect(response.status).toBe(200));
		const data = response.json();
		pulse.test("Count > 0", () => pulse.expect(data.count).toBeGreaterThan(0));
		pulse.test("Body contains token", () => pulse.expect(response.body).toContain("abc123"));
		pulse.setEnv("token", data.token);
	`
	updatedVars, results, err := sb.ExecutePostResponse(postScript, resp, vars)
	if err != nil {
		t.Fatalf("post-response failed: %v", err)
	}
	if updatedVars["token"] != "abc123" {
		t.Fatalf("expected token=abc123, got %q", updatedVars["token"])
	}
	if len(results) != 3 {
		t.Fatalf("expected 3 test results, got %d", len(results))
	}
	for _, r := range results {
		if !r.Passed {
			t.Fatalf("test %q failed: %s", r.Name, r.Error)
		}
	}
}

func TestSandboxTemplateAndEnvironmentAliases(t *testing.T) {
	sb := NewSandbox()
	vars := map[string]string{
		"baseUrl": "http://localhost:8090",
		"role":    "admin",
	}

	preScript := `
		const url = "{{baseUrl}}/users?role=" + pulse.environment.get("role");
		pulse.variables.set("computedUrl", url);
		pulse.setEnv("fromGetEnv", pulse.getEnv("role"));
	`
	updatedVars, err := sb.ExecutePreRequest(preScript, vars)
	if err != nil {
		t.Fatalf("pre-request failed: %v", err)
	}
	if updatedVars["computedUrl"] != "http://localhost:8090/users?role=admin" {
		t.Fatalf("unexpected computedUrl: %q", updatedVars["computedUrl"])
	}
	if updatedVars["fromGetEnv"] != "admin" {
		t.Fatalf("unexpected fromGetEnv: %q", updatedVars["fromGetEnv"])
	}

	resp := engine.HTTPResponse{
		StatusCode: 200,
		Body:       `{"role":"admin"}`,
	}
	postScript := `
		pulse.test("Matches env role template", () => pulse.expect(response.json().role).toBe("{{role}}"));
		pulse.test("Matches getEnv role", () => pulse.expect(response.json().role).toBe(pulse.getEnv("role")));
	`
	_, results, err := sb.ExecutePostResponse(postScript, resp, updatedVars)
	if err != nil {
		t.Fatalf("post-response failed: %v", err)
	}
	if len(results) != 2 || !results[0].Passed || !results[1].Passed {
		t.Fatalf("unexpected test results: %+v", results)
	}
}
