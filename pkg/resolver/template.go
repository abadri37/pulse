package resolver

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"
)

var variableRegex = regexp.MustCompile(`\{\{([a-zA-Z0-9_$.-]+)\}\}`)

// ResolveString replaces all {{key}} occurrences in the input using the provided variables map and dynamic helpers
func ResolveString(input string, variables map[string]string) string {
	if input == "" {
		return ""
	}

	return variableRegex.ReplaceAllStringFunc(input, func(match string) string {
		key := strings.Trim(match, "{}")
		key = strings.TrimSpace(key)

		// Check built-in dynamic variables
		switch key {
		case "$timestamp":
			return fmt.Sprintf("%d", time.Now().Unix())
		case "$isoTimestamp":
			return time.Now().UTC().Format(time.RFC3339)
		case "$guid", "$uuid":
			return generateUUID()
		case "$randomInt":
			n, _ := rand.Int(rand.Reader, big.NewInt(1000))
			return fmt.Sprintf("%d", n.Int64()+1)
		}

		// Check provided environment variables
		if variables != nil {
			if val, exists := variables[key]; exists {
				return val
			}
		}

		// Keep original placeholder if not found
		return match
	})
}

// generateUUID returns a v4 RFC4122 compliant UUID
func generateUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40 // Version 4
	b[8] = (b[8] & 0x3f) | 0x80 // Variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
