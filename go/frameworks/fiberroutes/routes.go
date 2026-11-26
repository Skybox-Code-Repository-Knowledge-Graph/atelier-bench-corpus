// Package fiberroutes is the lane's fiber route module: fiber runs on
// fasthttp, not net/http; the order routes are registered on a group with
// the method-named Get, and every handler takes a *fiber.Ctx.
package fiberroutes

import (
	"github.com/gofiber/fiber/v2"

	"atelier.example/lane/app"
	"atelier.example/lane/frameworks/orderview"
)

// NewRouter registers the two order routes under the /api group of a fiber
// app that prints no startup banner.
func NewRouter(state *app.State) *fiber.App {
	router := fiber.New(fiber.Config{DisableStartupMessage: true})
	api := router.Group("/api")
	api.Get("/orders", ListOrders(state))
	api.Get("/orders/:id", ShowOrder(state))
	return router
}

// ListOrders answers GET /api/orders.
func ListOrders(state *app.State) func(*fiber.Ctx) error {
	return func(c *fiber.Ctx) error {
		return c.JSON(orderview.List(state))
	}
}

// ShowOrder answers GET /api/orders/:id.
func ShowOrder(state *app.State) func(*fiber.Ctx) error {
	return func(c *fiber.Ctx) error {
		id := c.Params("id")
		row, found := orderview.Find(state, id)
		if !found {
			return c.Status(fiber.StatusNotFound).JSON(orderview.Missing(id))
		}
		return c.JSON(row)
	}
}
