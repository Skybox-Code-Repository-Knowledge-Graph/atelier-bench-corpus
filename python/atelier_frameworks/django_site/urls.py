"""URL configuration: `urlpatterns` maps a path pattern to the view that serves it."""

from django.urls import path

from . import views

urlpatterns = [
    path("customers/<int:customer_id>/orders/", views.customer_orders, name="customer-orders"),
    path("parts/low-stock/", views.low_stock_parts, name="low-stock-parts"),
]
