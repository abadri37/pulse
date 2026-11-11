package engine

import (
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"sync"
)

// CookieItem represents a cookie stored in the session jar
type CookieItem struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain"`
	Path     string `json:"path"`
	Secure   bool   `json:"secure"`
	HttpOnly bool   `json:"httpOnly"`
}

// CookieManager wraps http.CookieJar with query and reset capabilities
type CookieManager struct {
	jar http.CookieJar
	mu  sync.RWMutex
}

// NewCookieManager initializes an in-memory cookie jar
func NewCookieManager() *CookieManager {
	jar, _ := cookiejar.New(nil)
	return &CookieManager{
		jar: jar,
	}
}

// GetJar returns the underlying http.CookieJar for net/http
func (cm *CookieManager) GetJar() http.CookieJar {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.jar
}

// GetCookies returns the active cookies for a given URL
func (cm *CookieManager) GetCookies(rawURL string) []CookieItem {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	parsedURL, err := url.Parse(rawURL)
	if err != nil || cm.jar == nil {
		return nil
	}

	httpCookies := cm.jar.Cookies(parsedURL)
	items := make([]CookieItem, len(httpCookies))
	for i, c := range httpCookies {
		items[i] = CookieItem{
			Name:     c.Name,
			Value:    c.Value,
			Domain:   c.Domain,
			Path:     c.Path,
			Secure:   c.Secure,
			HttpOnly: c.HttpOnly,
		}
	}

	return items
}

// Clear resets the cookie jar
func (cm *CookieManager) Clear() {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	jar, _ := cookiejar.New(nil)
	cm.jar = jar
}
