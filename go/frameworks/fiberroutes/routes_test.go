package fiberroutes

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"atelier.example/lane/app"
)

// fiber has no ServeHTTP (it runs on fasthttp); its App.Test feeds a request through an
// in-memory connection, so the test still needs no listener and no network.
func serve(t *testing.T, method string, target string) (int, string) {
	t.Helper()
	response, err := NewRouter(app.SeededState()).Test(httptest.NewRequest(method, target, nil))
	if err != nil {
		t.Fatalf("%s %s: %v", method, target, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, string(body)
}

func TestShowOrderAnswersFromTheSeed(t *testing.T) {
	if code, body := serve(t, http.MethodGet, "/api/orders/1"); code != http.StatusOK || !strings.Contains(body, `"reference":"AT-2026-000001"`) {
		t.Errorf("GET /api/orders/1 = %d %s", code, body)
	}
	if code, body := serve(t, http.MethodGet, "/api/orders/99"); code != http.StatusNotFound || !strings.Contains(body, "repair order 99 not found") {
		t.Errorf("GET /api/orders/99 = %d %s", code, body)
	}
	if code, _ := serve(t, http.MethodPost, "/api/orders/1"); code != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/orders/1 = %d, want 405 from Get", code)
	}
}

func TestListOrdersCountsTheSeed(t *testing.T) {
	if code, body := serve(t, http.MethodGet, "/api/orders"); code != http.StatusOK || strings.Count(body, `"reference":`) != 4 {
		t.Errorf("GET /api/orders = %d %s", code, body)
	}
}
