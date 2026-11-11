package importer

import (
	"encoding/json"
	"fmt"
	"net/url"
	"pulse/pkg/engine"
	"pulse/pkg/storage"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

var validOpenAPIMethods = map[string]bool{
	"get":     true,
	"post":    true,
	"put":     true,
	"patch":   true,
	"delete":  true,
	"options": true,
	"head":    true,
}

var methodOrder = []string{"get", "post", "put", "patch", "delete", "options", "head"}

// parseOpenAPISpecWithFolders detects OpenAPI v2 or v3 (JSON/YAML) and preserves tag-based folders.
func parseOpenAPISpecWithFolders(content string) (bool, ImportResult, error) {
	rootMap, err := decodeStructuredSpec(content)
	if err != nil || rootMap == nil {
		return false, ImportResult{}, nil
	}

	openapiVer := strings.TrimSpace(strVal(rootMap["openapi"]))
	swaggerVer := strings.TrimSpace(strVal(rootMap["swagger"]))

	if strings.HasPrefix(openapiVer, "3.") || strings.HasPrefix(openapiVer, "3") {
		res, err := parseOpenAPIv3Map(rootMap)
		return true, res, err
	}
	if strings.HasPrefix(swaggerVer, "2.") || strings.HasPrefix(swaggerVer, "2") {
		res, err := parseOpenAPIv2Map(rootMap)
		return true, res, err
	}

	// Fallback heuristic if "paths" exists without explicit version field
	if _, hasPaths := rootMap["paths"]; hasPaths {
		if _, hasServers := rootMap["servers"]; hasServers {
			res, err := parseOpenAPIv3Map(rootMap)
			return true, res, err
		}
		if _, hasComponents := rootMap["components"]; hasComponents {
			res, err := parseOpenAPIv3Map(rootMap)
			return true, res, err
		}
		res, err := parseOpenAPIv2Map(rootMap)
		return true, res, err
	}

	return false, ImportResult{}, nil
}

func decodeStructuredSpec(content string) (map[string]interface{}, error) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return nil, fmt.Errorf("empty content")
	}

	if strings.HasPrefix(trimmed, "{") {
		var m map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &m); err != nil {
			return nil, err
		}
		return m, nil
	}

	// Ignore cURL/CSV-like inputs quickly unless YAML key structure is present
	var raw interface{}
	if err := yaml.Unmarshal([]byte(trimmed), &raw); err != nil {
		return nil, err
	}
	normalized := normalizeSpecValue(raw)
	m, ok := normalized.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("not an object document")
	}
	return m, nil
}

func normalizeSpecValue(v interface{}) interface{} {
	switch x := v.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(x))
		for k, val := range x {
			out[k] = normalizeSpecValue(val)
		}
		return out
	case map[interface{}]interface{}:
		out := make(map[string]interface{}, len(x))
		for k, val := range x {
			out[fmt.Sprintf("%v", k)] = normalizeSpecValue(val)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(x))
		for i, item := range x {
			out[i] = normalizeSpecValue(item)
		}
		return out
	default:
		return v
	}
}

func parseOpenAPIv3Map(root map[string]interface{}) (ImportResult, error) {
	info := mapVal(root["info"])
	rawTitle := strings.TrimSpace(strVal(info["title"]))
	collName := "Imported OpenAPI v3"
	if rawTitle != "" {
		collName = sanitizeFolderSegment(rawTitle)
	}

	seenFolders := map[string]bool{}
	var folders []string
	appendUniqueFolder(&folders, seenFolders, collName)

	rootBaseURL := extractOpenAPIv3ServerURL(root)
	rootSecurity := sliceVal(root["security"])
	securitySchemes := mapVal(mapVal(root["components"])["securitySchemes"])

	paths := mapVal(root["paths"])
	pathKeys := sortedKeys(paths)

	var requests []storage.SavedRequest
	idx := 0

	for _, rawPath := range pathKeys {
		pathItem := resolveIfRef(root, mapVal(paths[rawPath]))
		if pathItem == nil {
			continue
		}

		pathBaseURL := rootBaseURL
		if pathServers := sliceVal(pathItem["servers"]); len(pathServers) > 0 {
			if s := resolveServerURL(pathServers[0]); s != "" {
				pathBaseURL = s
			}
		}

		pathParams := collectResolvedParams(root, sliceVal(pathItem["parameters"]))

		for _, m := range methodOrder {
			opRaw, exists := pathItem[m]
			if !exists {
				continue
			}
			op := resolveIfRef(root, mapVal(opRaw))
			if op == nil {
				continue
			}
			idx++
			method := strings.ToUpper(m)

			opBaseURL := pathBaseURL
			if opServers := sliceVal(op["servers"]); len(opServers) > 0 {
				if s := resolveServerURL(opServers[0]); s != "" {
					opBaseURL = s
				}
			}

			cleanPath := strings.SplitN(rawPath, "?", 2)[0]
			if !strings.HasPrefix(cleanPath, "/") {
				cleanPath = "/" + cleanPath
			}

			// Merge path-level and operation-level parameters (operation overrides path)
			opParams := collectResolvedParams(root, sliceVal(op["parameters"]))
			mergedParams := mergeParameters(pathParams, opParams)

			var headers []engine.HeaderPair
			var queryParams []engine.ParamPair

			for _, param := range mergedParams {
				pName := strings.TrimSpace(strVal(param["name"]))
				pIn := strings.ToLower(strings.TrimSpace(strVal(param["in"])))
				if pName == "" {
					continue
				}
				sampleVal := extractParamSample(root, param)

				switch pIn {
				case "query":
					queryParams = append(queryParams, engine.ParamPair{
						Key:     pName,
						Value:   sampleVal,
						Enabled: true,
					})
				case "header":
					headers = append(headers, engine.HeaderPair{
						Key:     pName,
						Value:   sampleVal,
						Enabled: true,
					})
				case "path":
					if sampleVal != "" {
						cleanPath = strings.ReplaceAll(cleanPath, "{"+pName+"}", sampleVal)
					}
				}
			}

			// Apply operation or root security schemes when auth headers/params aren't already set
			opSecurity := sliceVal(op["security"])
			if len(opSecurity) == 0 && op["security"] == nil {
				opSecurity = rootSecurity
			}
			headers, queryParams = applyOpenAPIv3Security(root, opSecurity, securitySchemes, headers, queryParams)

			// Parse requestBody
			body := engine.RequestBody{Type: "none", Raw: ""}
			if reqBodyRaw := mapVal(op["requestBody"]); reqBodyRaw != nil {
				reqBody := resolveIfRef(root, reqBodyRaw)
				contentMap := mapVal(reqBody["content"])
				if mediaType, mediaObj := pickPreferredMediaType(contentMap); mediaType != "" {
					if !hasHeaderKey(headers, "Content-Type") {
						headers = append(headers, engine.HeaderPair{
							Key:     "Content-Type",
							Value:   mediaType,
							Enabled: true,
						})
					}
					body = buildOpenAPIv3Body(root, mediaType, resolveIfRef(root, mediaObj))
				}
			}

			fullURL := strings.TrimRight(opBaseURL, "/") + cleanPath
			reqName := strings.TrimSpace(strVal(op["summary"]))
			if reqName == "" {
				reqName = strings.TrimSpace(strVal(op["operationId"]))
			}
			if reqName == "" {
				reqName = fmt.Sprintf("%s %s", method, cleanPath)
			}

			targetCollections := resolveOpenAPITagFolders(collName, op, &folders, seenFolders)
			for _, targetCollection := range targetCollections {
				idx++
				requests = append(requests, storage.SavedRequest{
					ID:             fmt.Sprintf("req_oa3_%d_%d", time.Now().UnixNano(), idx),
					Name:           reqName,
					Collection:     targetCollection,
					Method:         method,
					URL:            fullURL,
					Headers:        headers,
					QueryParams:    queryParams,
					Body:           body,
					LastModifiedAt: time.Now().Unix(),
				})
			}
		}
	}

	return ImportResult{
		CollectionName: collName,
		Folders:        folders,
		Requests:       requests,
	}, nil
}

func parseOpenAPIv2Map(root map[string]interface{}) (ImportResult, error) {
	info := mapVal(root["info"])
	rawTitle := strings.TrimSpace(strVal(info["title"]))
	collName := "Imported OpenAPI v2"
	if rawTitle != "" {
		collName = sanitizeFolderSegment(rawTitle)
	}

	seenFolders := map[string]bool{}
	var folders []string
	appendUniqueFolder(&folders, seenFolders, collName)

	scheme := "http"
	if schemes := sliceVal(root["schemes"]); len(schemes) > 0 {
		if first := strings.TrimSpace(strVal(schemes[0])); first != "" {
			scheme = first
		}
	}
	host := strings.TrimSpace(strVal(root["host"]))
	if host == "" {
		host = "localhost"
	}
	basePath := strings.TrimRight(strVal(root["basePath"]), "/")

	paths := mapVal(root["paths"])
	pathKeys := sortedKeys(paths)

	var requests []storage.SavedRequest
	idx := 0

	for _, rawPath := range pathKeys {
		pathItem := resolveIfRef(root, mapVal(paths[rawPath]))
		if pathItem == nil {
			continue
		}
		cleanPath := strings.SplitN(rawPath, "?", 2)[0]
		if !strings.HasPrefix(cleanPath, "/") {
			cleanPath = "/" + cleanPath
		}

		pathParams := collectResolvedParams(root, sliceVal(pathItem["parameters"]))

		for _, m := range methodOrder {
			opRaw, exists := pathItem[m]
			if !exists {
				continue
			}
			op := resolveIfRef(root, mapVal(opRaw))
			if op == nil {
				continue
			}
			idx++
			method := strings.ToUpper(m)

			var headers []engine.HeaderPair
			var queryParams []engine.ParamPair
			var formParts []string
			body := engine.RequestBody{Type: "none", Raw: ""}

			consumes := sliceVal(op["consumes"])
			if len(consumes) == 0 {
				consumes = sliceVal(root["consumes"])
			}
			contentType := ""
			for _, c := range consumes {
				if s := strings.TrimSpace(strVal(c)); s != "" {
					contentType = s
					headers = append(headers, engine.HeaderPair{Key: "Content-Type", Value: s, Enabled: true})
					break
				}
			}

			opParams := collectResolvedParams(root, sliceVal(op["parameters"]))
			mergedParams := mergeParameters(pathParams, opParams)
			opPath := cleanPath

			for _, param := range mergedParams {
				pName := strings.TrimSpace(strVal(param["name"]))
				pIn := strings.ToLower(strings.TrimSpace(strVal(param["in"])))
				defStr := extractParamSample(root, param)

				switch pIn {
				case "query":
					if pName != "" {
						queryParams = append(queryParams, engine.ParamPair{Key: pName, Value: defStr, Enabled: true})
					}
				case "header":
					if pName != "" {
						headers = append(headers, engine.HeaderPair{Key: pName, Value: defStr, Enabled: true})
					}
				case "path":
					if pName != "" && defStr != "" {
						opPath = strings.ReplaceAll(opPath, "{"+pName+"}", defStr)
					}
				case "formdata":
					if pName != "" {
						formParts = append(formParts, fmt.Sprintf("%s=%s", url.QueryEscape(pName), url.QueryEscape(defStr)))
					}
				case "body":
					bodyType := classifyBodyType(contentType)
					raw := ""
					if schema := mapVal(param["schema"]); schema != nil {
						ex := buildSchemaExample(root, schema, 0, map[string]bool{})
						raw = serializeExampleForBody(ex, bodyType)
					}
					body = engine.RequestBody{Type: bodyType, Raw: raw}
				}
			}

			if len(formParts) > 0 {
				body = engine.RequestBody{Type: "x-www-form-urlencoded", Raw: strings.Join(formParts, "&")}
			}

			reqName := strings.TrimSpace(strVal(op["summary"]))
			if reqName == "" {
				reqName = strings.TrimSpace(strVal(op["operationId"]))
			}
			if reqName == "" {
				reqName = fmt.Sprintf("%s %s", method, opPath)
			}

			targetCollections := resolveOpenAPITagFolders(collName, op, &folders, seenFolders)

			fullURL := fmt.Sprintf("%s://%s%s%s", scheme, host, basePath, opPath)
			for _, targetCollection := range targetCollections {
				idx++
				requests = append(requests, storage.SavedRequest{
					ID:             fmt.Sprintf("req_oa2_%d_%d", time.Now().UnixNano(), idx),
					Name:           reqName,
					Collection:     targetCollection,
					Method:         method,
					URL:            fullURL,
					Headers:        headers,
					QueryParams:    queryParams,
					Body:           body,
					LastModifiedAt: time.Now().Unix(),
				})
			}
		}
	}

	return ImportResult{
		CollectionName: collName,
		Folders:        folders,
		Requests:       requests,
	}, nil
}

func resolveSingleTagFolder(
	collName string,
	rawTag string,
	folders *[]string,
	seenFolders map[string]bool,
) string {
	tag := strings.TrimSpace(rawTag)
	if tag == "" {
		return collName
	}

	// Strip redundant root collection prefix (with optional whitespace around separators)
	lowerTag := strings.ToLower(tag)
	lowerRoot := strings.ToLower(collName)
	if strings.HasPrefix(lowerTag, lowerRoot) {
		rest := strings.TrimSpace(tag[len(collName):])
		for _, sep := range []string{"/", "\\", "-", "_", ":"} {
			if strings.HasPrefix(rest, sep) {
				candidate := strings.TrimSpace(rest[len(sep):])
				if candidate != "" {
					tag = candidate
				}
				break
			}
		}
	}

	curPath := collName
	for _, rawSeg := range strings.Split(strings.ReplaceAll(tag, "\\", "/"), "/") {
		trimmed := strings.TrimSpace(rawSeg)
		if trimmed == "" {
			continue
		}
		curPath = curPath + "/" + sanitizeFolderSegment(trimmed)
		appendUniqueFolder(folders, seenFolders, curPath)
	}
	return curPath
}

func resolveOpenAPITagFolders(
	collName string,
	op map[string]interface{},
	folders *[]string,
	seenFolders map[string]bool,
) []string {
	tags := sliceVal(op["tags"])
	if len(tags) == 0 {
		return []string{collName}
	}

	var targets []string
	seenTargets := map[string]bool{}
	for _, t := range tags {
		rawTag := strings.TrimSpace(strVal(t))
		if rawTag == "" {
			continue
		}
		target := resolveSingleTagFolder(collName, rawTag, folders, seenFolders)
		if !seenTargets[target] {
			seenTargets[target] = true
			targets = append(targets, target)
		}
	}
	if len(targets) == 0 {
		return []string{collName}
	}
	return targets
}

func extractOpenAPIv3ServerURL(root map[string]interface{}) string {
	servers := sliceVal(root["servers"])
	for _, s := range servers {
		if u := resolveServerURL(s); u != "" {
			return u
		}
	}
	return "http://localhost"
}

func resolveServerURL(entry interface{}) string {
	srv := mapVal(entry)
	if srv == nil {
		return ""
	}
	rawURL := strings.TrimSpace(strVal(srv["url"]))
	if rawURL == "" {
		return ""
	}

	// Resolve {var} server template variables from variables.<var>.default or enum[0]
	vars := mapVal(srv["variables"])
	for varName, varDefRaw := range vars {
		varDef := mapVal(varDefRaw)
		replacement := strVal(varDef["default"])
		if replacement == "" {
			if enums := sliceVal(varDef["enum"]); len(enums) > 0 {
				replacement = strVal(enums[0])
			}
		}
		if replacement != "" {
			rawURL = strings.ReplaceAll(rawURL, "{"+varName+"}", replacement)
		}
	}

	if strings.HasPrefix(rawURL, "/") {
		return "http://localhost" + strings.TrimRight(rawURL, "/")
	}
	return strings.TrimRight(rawURL, "/")
}

func collectResolvedParams(root map[string]interface{}, rawParams []interface{}) []map[string]interface{} {
	var out []map[string]interface{}
	for _, item := range rawParams {
		if m := resolveIfRef(root, mapVal(item)); m != nil {
			out = append(out, m)
		}
	}
	return out
}

func mergeParameters(base, overrides []map[string]interface{}) []map[string]interface{} {
	merged := make([]map[string]interface{}, 0, len(base)+len(overrides))
	indexByKey := make(map[string]int)

	for _, p := range base {
		k := strings.ToLower(strVal(p["in"])) + ":" + strVal(p["name"])
		indexByKey[k] = len(merged)
		merged = append(merged, p)
	}
	for _, p := range overrides {
		k := strings.ToLower(strVal(p["in"])) + ":" + strVal(p["name"])
		if existingIdx, ok := indexByKey[k]; ok {
			merged[existingIdx] = p
		} else {
			indexByKey[k] = len(merged)
			merged = append(merged, p)
		}
	}
	return merged
}

func extractParamSample(root, param map[string]interface{}) string {
	if ex, ok := param["example"]; ok && ex != nil {
		return scalarToString(ex)
	}
	if examples := mapVal(param["examples"]); len(examples) > 0 {
		for _, k := range sortedKeys(examples) {
			exObj := resolveIfRef(root, mapVal(examples[k]))
			if val, ok := exObj["value"]; ok && val != nil {
				return scalarToString(val)
			}
		}
	}
	if def, ok := param["default"]; ok && def != nil {
		return scalarToString(def)
	}
	if schema := mapVal(param["schema"]); schema != nil {
		resolved := resolveIfRef(root, schema)
		if ex, ok := resolved["example"]; ok && ex != nil {
			return scalarToString(ex)
		}
		if def, ok := resolved["default"]; ok && def != nil {
			return scalarToString(def)
		}
		if enums := sliceVal(resolved["enum"]); len(enums) > 0 && enums[0] != nil {
			return scalarToString(enums[0])
		}
	}
	return ""
}

func applyOpenAPIv3Security(
	root map[string]interface{},
	securityReqs []interface{},
	securitySchemes map[string]interface{},
	headers []engine.HeaderPair,
	queryParams []engine.ParamPair,
) ([]engine.HeaderPair, []engine.ParamPair) {
	if len(securityReqs) == 0 || len(securitySchemes) == 0 {
		return headers, queryParams
	}

	firstReq := mapVal(securityReqs[0])
	for _, schemeName := range sortedKeys(firstReq) {
		schemeObj := resolveIfRef(root, mapVal(securitySchemes[schemeName]))
		if schemeObj == nil {
			continue
		}
		secType := strings.ToLower(strVal(schemeObj["type"]))
		switch secType {
		case "http":
			httpScheme := strings.ToLower(strVal(schemeObj["scheme"]))
			if httpScheme == "bearer" && !hasHeaderKey(headers, "Authorization") {
				headers = append(headers, engine.HeaderPair{
					Key:     "Authorization",
					Value:   "Bearer {{token}}",
					Enabled: true,
				})
			} else if httpScheme == "basic" && !hasHeaderKey(headers, "Authorization") {
				headers = append(headers, engine.HeaderPair{
					Key:     "Authorization",
					Value:   "Basic {{credentials}}",
					Enabled: true,
				})
			}
		case "apikey":
			keyName := strings.TrimSpace(strVal(schemeObj["name"]))
			inLoc := strings.ToLower(strVal(schemeObj["in"]))
			if keyName == "" {
				continue
			}
			if inLoc == "header" && !hasHeaderKey(headers, keyName) {
				headers = append(headers, engine.HeaderPair{
					Key:     keyName,
					Value:   "{{" + keyName + "}}",
					Enabled: true,
				})
			} else if inLoc == "query" {
				queryParams = append(queryParams, engine.ParamPair{
					Key:     keyName,
					Value:   "{{" + keyName + "}}",
					Enabled: true,
				})
			}
		}
	}
	return headers, queryParams
}

func pickPreferredMediaType(contentMap map[string]interface{}) (string, map[string]interface{}) {
	if len(contentMap) == 0 {
		return "", nil
	}
	keys := sortedKeys(contentMap)
	priorities := []func(string) bool{
		func(k string) bool { return strings.EqualFold(k, "application/json") },
		func(k string) bool { return strings.Contains(strings.ToLower(k), "json") },
		func(k string) bool { return strings.EqualFold(k, "application/x-www-form-urlencoded") },
		func(k string) bool { return strings.Contains(strings.ToLower(k), "xml") },
		func(k string) bool { return strings.EqualFold(k, "text/plain") },
	}
	for _, matcher := range priorities {
		for _, k := range keys {
			if matcher(k) {
				return k, mapVal(contentMap[k])
			}
		}
	}
	return keys[0], mapVal(contentMap[keys[0]])
}

func classifyBodyType(mediaType string) string {
	lower := strings.ToLower(mediaType)
	switch {
	case strings.Contains(lower, "x-www-form-urlencoded"), strings.Contains(lower, "multipart/form-data"):
		return "x-www-form-urlencoded"
	case strings.Contains(lower, "xml"):
		return "xml"
	case strings.Contains(lower, "text/plain"):
		return "raw"
	default:
		return "json"
	}
}

func buildOpenAPIv3Body(root map[string]interface{}, mediaType string, mediaObj map[string]interface{}) engine.RequestBody {
	bodyType := classifyBodyType(mediaType)
	if mediaObj == nil {
		return engine.RequestBody{Type: bodyType, Raw: ""}
	}

	var exampleVal interface{}
	if ex, ok := mediaObj["example"]; ok && ex != nil {
		exampleVal = ex
	} else if examples := mapVal(mediaObj["examples"]); len(examples) > 0 {
		for _, k := range sortedKeys(examples) {
			exObj := resolveIfRef(root, mapVal(examples[k]))
			if val, ok := exObj["value"]; ok && val != nil {
				exampleVal = val
				break
			}
		}
	} else if schema := mapVal(mediaObj["schema"]); schema != nil {
		exampleVal = buildSchemaExample(root, schema, 0, map[string]bool{})
	}

	return engine.RequestBody{
		Type: bodyType,
		Raw:  serializeExampleForBody(exampleVal, bodyType),
	}
}

func serializeExampleForBody(exampleVal interface{}, bodyType string) string {
	if exampleVal == nil {
		return ""
	}
	if bodyType == "x-www-form-urlencoded" {
		if obj, ok := exampleVal.(map[string]interface{}); ok {
			keys := sortedKeys(obj)
			parts := make([]string, 0, len(keys))
			for _, k := range keys {
				parts = append(parts, fmt.Sprintf("%s=%s", url.QueryEscape(k), url.QueryEscape(scalarToString(obj[k]))))
			}
			return strings.Join(parts, "&")
		}
	}
	if s, isStr := exampleVal.(string); isStr {
		return s
	}
	if b, err := json.MarshalIndent(exampleVal, "", "  "); err == nil {
		return string(b)
	}
	return fmt.Sprintf("%v", exampleVal)
}

func buildSchemaExample(root, schema map[string]interface{}, depth int, visited map[string]bool) interface{} {
	if schema == nil || depth > 5 {
		return nil
	}
	if ref := strVal(schema["$ref"]); ref != "" {
		if visited[ref] {
			return nil
		}
		visited[ref] = true
		defer delete(visited, ref)
		target := resolveRef(root, ref)
		if target == nil {
			return nil
		}
		return buildSchemaExample(root, target, depth+1, visited)
	}

	if ex, ok := schema["example"]; ok && ex != nil {
		return ex
	}
	if exList := sliceVal(schema["examples"]); len(exList) > 0 && exList[0] != nil {
		return exList[0]
	}
	if def, ok := schema["default"]; ok && def != nil {
		return def
	}
	if enums := sliceVal(schema["enum"]); len(enums) > 0 && enums[0] != nil {
		return enums[0]
	}

	if allOf := sliceVal(schema["allOf"]); len(allOf) > 0 {
		combined := make(map[string]interface{})
		for _, sub := range allOf {
			if subEx, ok := buildSchemaExample(root, mapVal(sub), depth+1, visited).(map[string]interface{}); ok {
				for k, v := range subEx {
					combined[k] = v
				}
			}
		}
		if len(combined) > 0 {
			return combined
		}
	}
	for _, combKey := range []string{"oneOf", "anyOf"} {
		if variants := sliceVal(schema[combKey]); len(variants) > 0 {
			if v := buildSchemaExample(root, mapVal(variants[0]), depth+1, visited); v != nil {
				return v
			}
		}
	}

	schemaType := strings.ToLower(strVal(schema["type"]))
	if schemaType == "" {
		// OpenAPI 3.1 allows type: ["string", "null"]
		if types := sliceVal(schema["type"]); len(types) > 0 {
			for _, t := range types {
				ts := strings.ToLower(strVal(t))
				if ts != "null" && ts != "" {
					schemaType = ts
					break
				}
			}
		}
	}

	if _, hasProps := schema["properties"]; hasProps || schemaType == "object" {
		props := mapVal(schema["properties"])
		obj := make(map[string]interface{}, len(props))
		for _, propName := range sortedKeys(props) {
			val := buildSchemaExample(root, mapVal(props[propName]), depth+1, visited)
			if val == nil {
				val = ""
			}
			obj[propName] = val
		}
		return obj
	}

	if schemaType == "array" || schema["items"] != nil {
		itemSchema := mapVal(schema["items"])
		if itemEx := buildSchemaExample(root, itemSchema, depth+1, visited); itemEx != nil {
			return []interface{}{itemEx}
		}
		return []interface{}{}
	}

	switch schemaType {
	case "integer":
		return 0
	case "number":
		return 0.0
	case "boolean":
		return true
	case "string":
		switch strings.ToLower(strVal(schema["format"])) {
		case "email":
			return "user@example.com"
		case "uuid":
			return "{{$uuid}}"
		case "date-time":
			return "{{$isoTimestamp}}"
		case "date":
			return "2026-01-01"
		case "uri", "url":
			return "https://example.com"
		default:
			return "string"
		}
	default:
		return nil
	}
}

func resolveIfRef(root, obj map[string]interface{}) map[string]interface{} {
	if obj == nil {
		return nil
	}
	seen := map[string]bool{}
	cur := obj
	for {
		ref := strings.TrimSpace(strVal(cur["$ref"]))
		if ref == "" || seen[ref] {
			return cur
		}
		seen[ref] = true
		target := resolveRef(root, ref)
		if target == nil {
			return cur
		}
		cur = target
	}
}

func resolveRef(root map[string]interface{}, ref string) map[string]interface{} {
	if !strings.HasPrefix(ref, "#/") {
		return nil
	}
	parts := strings.Split(ref[2:], "/")
	var cur interface{} = root
	for _, rawPart := range parts {
		part := strings.NewReplacer("~1", "/", "~0", "~").Replace(rawPart)
		m, ok := cur.(map[string]interface{})
		if !ok {
			return nil
		}
		cur = m[part]
	}
	return mapVal(cur)
}

func hasHeaderKey(headers []engine.HeaderPair, target string) bool {
	for _, h := range headers {
		if strings.EqualFold(h.Key, target) {
			return true
		}
	}
	return false
}

func sortedKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func mapVal(v interface{}) map[string]interface{} {
	m, _ := v.(map[string]interface{})
	return m
}

func sliceVal(v interface{}) []interface{} {
	s, _ := v.([]interface{})
	return s
}

func strVal(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func scalarToString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}
