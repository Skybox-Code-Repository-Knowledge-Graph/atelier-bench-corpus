// Package ginroutes is the lane's gin route module: the order routes are
// registered on a router group with the method-named GET, and the :id
// parameter is read back through the gin.Context.
package ginroutes

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"atelier.example/lane/app"
	"atelier.example/lane/frameworks/orderview"
)

// NewRouter registers the two order routes under the /api group of a gin
// engine without the default logger and recovery middleware.
func NewRouter(state *app.State) *gin.Engine {
	router := gin.New()
	api := router.Group("/api")
	api.GET("/orders", ListOrders(state))
	api.GET("/orders/:id", ShowOrder(state))
	return router
}

// ListOrders answers GET /api/orders.
func ListOrders(state *app.State) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, orderview.List(state))
	}
}

// ShowOrder answers GET /api/orders/:id.
func ShowOrder(state *app.State) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		row, found := orderview.Find(state, id)
		if !found {
			c.JSON(http.StatusNotFound, orderview.Missing(id))
			return
		}
		c.JSON(http.StatusOK, row)
	}
}
