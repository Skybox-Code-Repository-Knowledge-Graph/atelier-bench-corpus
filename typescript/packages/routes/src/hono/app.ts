/** Hono app: routes are registered on the app with a method call naming the handler. */

import { Hono } from "hono";

import { showOrder } from "./orders";

export const app = new Hono();

app.get("/api/hono/orders/:reference", showOrder);
