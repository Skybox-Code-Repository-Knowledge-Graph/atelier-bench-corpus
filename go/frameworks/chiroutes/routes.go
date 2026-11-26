// Package chiroutes is the lane's chi route module: the order routes are
// mounted with chi's nested Route block, registered with the method-named
// Get, and the path parameter is read back through chi.URLParam.
package chiroutes

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"atelier.example/lane/app"
	"atelier.example/lane/frameworks/orderview"
)

// NewRouter mounts the two order routes under /api/orders on a chi router.
func NewRouter(state *app.State) *chi.Mux {
	router := chi.NewRouter()
	router.Route("/api/orders", func(orders chi.Router) {
		orders.Get("/", ListOrders(state))
		orders.Get("/{id}", ShowOrder(state))
	})
	return router
}

// ListOrders answers GET /api/orders/.
func ListOrders(state *app.State) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		respond(writer, http.StatusOK, orderview.List(state))
	}
}

// ShowOrder answers GET /api/orders/{id}.
func ShowOrder(state *app.State) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		id := chi.URLParam(request, "id")
		row, found := orderview.Find(state, id)
		if !found {
			respond(writer, http.StatusNotFound, orderview.Missing(id))
			return
		}
		respond(writer, http.StatusOK, row)
	}
}

func respond(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}
