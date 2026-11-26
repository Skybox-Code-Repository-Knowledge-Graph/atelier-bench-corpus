package ginroutes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"atelier.example/lane/app"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// A gin engine serves HTTP itself (ServeHTTP), so the test drives it with a recorder:
// no listener, no network.
func serve(method string, target string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	NewRouter(app.SeededState()).ServeHTTP(recorder, httptest.NewRequest(method, target, nil))
	return recorder
}

func TestShowOrderAnswersFromTheSeed(t *testing.T) {
	got := serve(http.MethodGet, "/api/orders/1")
	if got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"reference":"AT-2026-000001"`) {
		t.Errorf("GET /api/orders/1 = %d %s", got.Code, got.Body)
	}
	if missing := serve(http.MethodGet, "/api/orders/99"); missing.Code != http.StatusNotFound || !strings.Contains(missing.Body.String(), "repair order 99 not found") {
		t.Errorf("GET /api/orders/99 = %d %s", missing.Code, missing.Body)
	}
	if wrongVerb := serve(http.MethodPost, "/api/orders/1"); wrongVerb.Code != http.StatusNotFound {
		t.Errorf("POST /api/orders/1 = %d, want gin's 404 for an unregistered method", wrongVerb.Code)
	}
}

func TestListOrdersCountsTheSeed(t *testing.T) {
	got := serve(http.MethodGet, "/api/orders")
	if got.Code != http.StatusOK || strings.Count(got.Body.String(), `"reference":`) != 4 {
		t.Errorf("GET /api/orders = %d %s", got.Code, got.Body)
	}
}
