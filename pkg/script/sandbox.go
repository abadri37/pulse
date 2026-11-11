package script

import (
	"encoding/json"
	"fmt"
	"pulse/pkg/engine"
	"pulse/pkg/resolver"
	"strings"

	"github.com/dop251/goja"
)

// Sandbox executes pre-request and post-response scripts in an isolated JS runtime
type Sandbox struct{}

// NewSandbox creates a script sandbox instance
func NewSandbox() *Sandbox {
	return &Sandbox{}
}

func cloneVars(variables map[string]string) map[string]string {
	updatedVars := make(map[string]string, len(variables))
	for k, v := range variables {
		updatedVars[k] = v
	}
	return updatedVars
}

func newPulseObject(vm *goja.Runtime, updatedVars map[string]string) *goja.Object {
	getEnvFn := func(call goja.FunctionCall) goja.Value {
		key := call.Argument(0).String()
		return vm.ToValue(updatedVars[key])
	}
	setEnvFn := func(call goja.FunctionCall) goja.Value {
		key := call.Argument(0).String()
		val := call.Argument(1).String()
		updatedVars[key] = val
		return goja.Undefined()
	}

	envStore := vm.NewObject()
	_ = envStore.Set("get", getEnvFn)
	_ = envStore.Set("set", setEnvFn)

	pulseObj := vm.NewObject()
	_ = pulseObj.Set("getEnv", getEnvFn)
	_ = pulseObj.Set("setEnv", setEnvFn)
	_ = pulseObj.Set("environment", envStore)
	_ = pulseObj.Set("variables", envStore)
	return pulseObj
}

// ExecutePreRequest runs a script before the HTTP request is dispatched
func (s *Sandbox) ExecutePreRequest(
	script string,
	variables map[string]string,
) (map[string]string, error) {
	if script == "" {
		return variables, nil
	}

	vm := goja.New()
	updatedVars := cloneVars(variables)
	pulseObj := newPulseObject(vm, updatedVars)
	_ = vm.Set("pulse", pulseObj)

	resolvedScript := resolver.ResolveString(script, updatedVars)
	_, err := vm.RunString(resolvedScript)
	if err != nil {
		return updatedVars, fmt.Errorf("pre-request script error: %w", err)
	}

	return updatedVars, nil
}

// ExecutePostResponse runs test assertions and variable extraction after receiving an HTTP response
func (s *Sandbox) ExecutePostResponse(
	script string,
	resp engine.HTTPResponse,
	variables map[string]string,
) (map[string]string, []engine.TestResult, error) {
	if script == "" {
		return variables, nil, nil
	}

	vm := goja.New()
	updatedVars := cloneVars(variables)

	var testResults []engine.TestResult

	// 1. Expose 'pulse' object to JS
	pulseObj := newPulseObject(vm, updatedVars)
	_ = pulseObj.Set("test", func(call goja.FunctionCall) goja.Value {
		name := call.Argument(0).String()
		fn, ok := goja.AssertFunction(call.Argument(1))
		if !ok {
			testResults = append(testResults, engine.TestResult{
				Name:   name,
				Passed: false,
				Error:  "Second argument must be a function",
			})
			return goja.Undefined()
		}

		_, err := fn(goja.Undefined())
		if err != nil {
			testResults = append(testResults, engine.TestResult{
				Name:   name,
				Passed: false,
				Error:  err.Error(),
			})
		} else {
			testResults = append(testResults, engine.TestResult{
				Name:   name,
				Passed: true,
			})
		}
		return goja.Undefined()
	})

	_ = vm.Set("pulse", pulseObj)

	// 2. Expose 'response' object to JS
	respObj := vm.NewObject()
	_ = respObj.Set("status", resp.StatusCode)
	_ = respObj.Set("statusText", resp.StatusText)
	_ = respObj.Set("body", resp.Body)
	_ = respObj.Set("size", resp.Size)
	_ = respObj.Set("json", func(call goja.FunctionCall) goja.Value {
		var parsed interface{}
		if err := json.Unmarshal([]byte(resp.Body), &parsed); err != nil {
			panic(vm.ToValue(fmt.Sprintf("JSON parse error: %v", err)))
		}
		return vm.ToValue(parsed)
	})

	_ = vm.Set("response", respObj)

	// 3. Assertion helper: both global expect(a) and pulse.expect(a)
	expectFn := func(call goja.FunctionCall) goja.Value {
		actualVal := call.Argument(0)
		actual := actualVal.Export()
		actualNum := actualVal.ToFloat()
		matcherObj := vm.NewObject()
		_ = matcherObj.Set("toBe", func(inner goja.FunctionCall) goja.Value {
			expected := inner.Argument(0).Export()
			if fmt.Sprintf("%v", actual) != fmt.Sprintf("%v", expected) {
				panic(vm.ToValue(fmt.Sprintf("Expected %v, but got %v", expected, actual)))
			}
			return goja.Undefined()
		})
		_ = matcherObj.Set("toBeGreaterThan", func(inner goja.FunctionCall) goja.Value {
			expNum := inner.Argument(0).ToFloat()
			if actualNum <= expNum {
				panic(vm.ToValue(fmt.Sprintf("Expected %v > %v", actualNum, expNum)))
			}
			return goja.Undefined()
		})
		_ = matcherObj.Set("toContain", func(inner goja.FunctionCall) goja.Value {
			substr := inner.Argument(0).String()
			actualStr := fmt.Sprintf("%v", actual)
			if !strings.Contains(actualStr, substr) {
				panic(vm.ToValue(fmt.Sprintf("Expected response to contain %q", substr)))
			}
			return goja.Undefined()
		})
		return matcherObj
	}
	_ = vm.Set("expect", expectFn)
	_ = pulseObj.Set("expect", expectFn)

	resolvedScript := resolver.ResolveString(script, updatedVars)
	_, err := vm.RunString(resolvedScript)
	if err != nil {
		return updatedVars, testResults, fmt.Errorf("post-response script error: %w", err)
	}

	return updatedVars, testResults, nil
}
