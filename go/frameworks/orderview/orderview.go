// Package orderview is the payload the lane-only framework route modules
// under frameworks/ answer with, so each module holds only its framework's
// own routing convention: GET /api/orders lists the seeded orders and
// GET /api/orders/{id} shows one.
package orderview

import (
	"strconv"

	"atelier.example/lane/app"
)

// Row is one repair order as the framework routes render it.
type Row struct {
	ID        int    `json:"id"`
	Reference string `json:"reference"`
	Status    string `json:"status"`
}

// List renders every order of the state, in seed order.
func List(state *app.State) []Row {
	rows := make([]Row, 0, len(state.Data.Orders))
	for _, order := range state.Data.Orders {
		rows = append(rows, Row{ID: order.ID, Reference: order.Reference(), Status: order.Status.String()})
	}
	return rows
}

// Find renders the order whose id is the route parameter, or reports false
// when the parameter is not a number or names no order.
func Find(state *app.State, id string) (Row, bool) {
	wanted, err := strconv.Atoi(id)
	if err != nil {
		return Row{}, false
	}
	for _, row := range List(state) {
		if row.ID == wanted {
			return row, true
		}
	}
	return Row{}, false
}

// Missing is the body of a 404 for an unknown order.
func Missing(id string) map[string]string {
	return map[string]string{"error": "repair order " + id + " not found"}
}
