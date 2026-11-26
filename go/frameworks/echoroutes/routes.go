// Package echoroutes is the lane's echo route module: the order routes are
// registered on a group with the method-named GET, and every handler takes
// an echo.Context and returns an error.
package echoroutes

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"atelier.example/lane/app"
	"atelier.example/lane/frameworks/orderview"
)

// NewRouter registers the two order routes under the /api group.
func NewRouter(state *app.State) *echo.Echo {
	router := echo.New()
	api := router.Group("/api")
	api.GET("/orders", ListOrders(state))
	api.GET("/orders/:id", ShowOrder(state))
	return router
}

// ListOrders answers GET /api/orders.
func ListOrders(state *app.State) echo.HandlerFunc {
	return func(c echo.Context) error {
		return c.JSON(http.StatusOK, orderview.List(state))
	}
}

// ShowOrder answers GET /api/orders/:id.
func ShowOrder(state *app.State) echo.HandlerFunc {
	return func(c echo.Context) error {
		id := c.Param("id")
		row, found := orderview.Find(state, id)
		if !found {
			return c.JSON(http.StatusNotFound, orderview.Missing(id))
		}
		return c.JSON(http.StatusOK, row)
	}
}
