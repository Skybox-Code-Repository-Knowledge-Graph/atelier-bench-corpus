"""
The lane-only framework modules of atelier_frameworks/, driven at request level where the
framework offers an in-process test client (FastAPI's TestClient over httpx, Django's test Client;
neither opens a network listener), and every answer is a value of the frozen seed.
"""

import unittest

from django.test import Client
from django.urls import resolve, reverse
from fastapi.testclient import TestClient
from pydantic import ValidationError

from atelier_app.state import seeded_state
from atelier_frameworks.django_site import configure
from atelier_frameworks.fastapi_app import create_api
from atelier_frameworks.orm import low_stock_skus, seeded_session
from atelier_frameworks.schemas import StockAdjustment


class FastApiRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(create_api())

    def test_show_part_serves_the_seeded_row(self) -> None:
        response = self.client.get("/api/parts/BAT-55")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"sku": "BAT-55", "name": "Battery 55Wh", "unit_price_cents": 8900, "stock": 1, "low_stock": True, "movements": 0})
        self.assertEqual(self.client.get("/api/parts/NOPE-00").status_code, 404)

    def test_low_stock_route_reads_through_the_sqlalchemy_model(self) -> None:
        self.assertEqual(self.client.get("/api/parts/low-stock").json(), ["BAT-55", "FAN-A1"])

    def test_adjustment_body_is_validated_by_the_pydantic_model(self) -> None:
        response = self.client.post("/api/parts/BAT-55/adjustments", json={"quantity": 3, "reason": " restock "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual({key: response.json()[key] for key in ("stock", "low_stock", "movements")}, {"stock": 4, "low_stock": False, "movements": 1})
        self.assertEqual(self.client.post("/api/parts/BAT-55/adjustments", json={"quantity": 0, "reason": "recount"}).status_code, 422)
        self.assertEqual(self.client.post("/api/parts/NOPE-00/adjustments", json={"quantity": 1, "reason": "recount"}).status_code, 404)


class SqlAlchemyModelTest(unittest.TestCase):
    def test_low_stock_skus_of_the_seed(self) -> None:
        session = seeded_session(seeded_state().data.parts)
        try:
            self.assertEqual(low_stock_skus(session), ["BAT-55", "FAN-A1"])
        finally:
            session.close()


class PydanticModelTest(unittest.TestCase):
    def test_reason_validator_trims_and_refuses_blank(self) -> None:
        self.assertEqual(StockAdjustment(quantity=2, reason="  recount ").reason, "recount")
        with self.assertRaises(ValidationError):
            StockAdjustment(quantity=2, reason="   ")


class DjangoRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        configure()

    def test_customer_orders_view_serves_the_seed(self) -> None:
        response = Client().get("/customers/1/orders/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"customer": "Ada Byron", "orders": [1, 4]})
        self.assertEqual(Client().get("/customers/9/orders/").status_code, 404)

    def test_named_routes_resolve_to_their_views(self) -> None:
        self.assertEqual(reverse("customer-orders", kwargs={"customer_id": 2}), "/customers/2/orders/")
        self.assertEqual(resolve("/parts/low-stock/").func.__name__, "low_stock_parts")
        self.assertEqual(Client().get("/parts/low-stock/").json(), {"skus": ["BAT-55", "FAN-A1"]})


if __name__ == "__main__":
    unittest.main()
