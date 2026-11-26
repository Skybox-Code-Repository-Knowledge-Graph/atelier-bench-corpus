// Package muxroutes is the lane's gorilla/mux route module: routes are
// registered with HandleFunc and narrowed with .Methods, and the path
// parameter is read back through mux.Vars.
package muxroutes

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"

	"atelier.example/lane/app"
	"atelier.example/lane/frameworks/orderview"
)

// NewRouter registers the two order routes on a gorilla/mux router.
func NewRouter(state *app.State) *mux.Router {
	router := mux.NewRouter()
	router.HandleFunc("/api/orders", ListOrders(state)).Methods(http.MethodGet)
	router.HandleFunc("/api/orders/{id}", ShowOrder(state)).Methods(http.MethodGet)
	return router
}

// ListOrders answers GET /api/orders.
func ListOrders(state *app.State) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		respond(writer, http.StatusOK, orderview.List(state))
	}
}

// ShowOrder answers GET /api/orders/{id}.
func ShowOrder(state *app.State) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		id := mux.Vars(request)["id"]
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
