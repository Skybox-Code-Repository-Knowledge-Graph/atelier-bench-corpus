"""Views: plain functions that take the HttpRequest and the values of the path's converters."""

from __future__ import annotations

from django.http import Http404, HttpRequest, JsonResponse

from atelier_app.state import seeded_state


def customer_orders(request: HttpRequest, customer_id: int) -> JsonResponse:
    data = seeded_state().data
    customer = next((customer for customer in data.customers if customer.id == customer_id), None)
    if customer is None:
        raise Http404(f"unknown customer {customer_id}")
    return JsonResponse({"customer": customer.name, "orders": [order.id for order in data.orders_for(customer_id)]})


def low_stock_parts(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"skus": sorted(part.sku for part in seeded_state().data.low_stock_parts())})
