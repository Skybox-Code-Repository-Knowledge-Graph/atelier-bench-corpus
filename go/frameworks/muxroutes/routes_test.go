package muxroutes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"atelier.example/lane/app"
)

// The gorilla/mux router is an http.Handler, so the test drives it with a
// recorder: no listener, no network.
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
	if wrongVerb := serve(http.MethodPost, "/api/orders/1"); wrongVerb.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/orders/1 = %d, want 405 from .Methods(GET)", wrongVerb.Code)
	}
}

func TestListOrdersCountsTheSeed(t *testing.T) {
	got := serve(http.MethodGet, "/api/orders")
	if got.Code != http.StatusOK || strings.Count(got.Body.String(), `"reference":`) != 4 {
		t.Errorf("GET /api/orders = %d %s", got.Code, got.Body)
	}
}
