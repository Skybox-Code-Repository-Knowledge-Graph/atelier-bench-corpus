"""
Every source file the lane adds is loaded, and every function body in it that does something runs, under this suite
(the `...`-only stubs of abstract and overload declarations, 17 of 566 bodies, have nothing to run)
(issue #223, F.5). The other test files exercise the behaviour the tasks ask about; this one is the
sweep that leaves no file silently wrong: it imports each module found on disk, runs the console
entry point for every command, and calls each breadth class and helper the rest of the suite
never reaches. Measured with sys.settrace over the whole suite: before this file (wave 2), 3 of
192 files were never loaded and 163 function bodies never ran; re-measured in wave 3 over the
201 files of atelier_core, atelier_bench, atelier_app and atelier_frameworks, none.
"""

import contextlib
import importlib
import io
import json
import pkgutil
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from flask import Flask

import atelier_bench.exporters as exporters
import atelier_bench.notifiers as notifiers
import atelier_bench.rules as rules
from atelier_app.__main__ import main
from atelier_app.state import seeded_state
from atelier_bench import report
from atelier_bench.concerns.has_audit import last_audit_of
from atelier_bench.concerns.has_metadata import MetadataBag
from atelier_bench.concerns.has_serialization import to_json, to_pretty_json
from atelier_bench.concerns.has_timestamps import Stamped
from atelier_bench.concerns.has_validation import HasValidation
from atelier_bench.contracts.formatter_contract import format_cell
from atelier_bench.repositories import (
    CustomerRepository,
    InventoryRepository,
    InvoiceRepository,
    OrderRepository,
    PartRepository,
    PaymentRepository,
    TechnicianRepository,
    WarrantyRepository,
)
from atelier_bench.repositories.inventory_repository import Movement
from atelier_bench.repositories.payment_repository import Payment
from atelier_bench.repositories.warranty_repository import Claim
from atelier_bench.services import (
    BacklogService,
    ChurnRiskService,
    CustomerRetentionService,
    InventoryTurnoverService,
    OrderVolumeService,
    PartUsageService,
    PaymentLatencyService,
    ProfitMarginService,
    RevenueService,
    TechnicianLoadService,
    ThroughputService,
    WarrantyClaimService,
)
from atelier_core import Container, Customer, Device, Invoice, Part, Priority, RepairStatus
from atelier_core.billing.formatter import Formatter as BillingFormatter
from atelier_core.contracts.invoice_calculator import is_invoice_calculator
from atelier_core.contracts.repository import size_of
from atelier_core.errors import NotFoundError, ValidationError
from atelier_core.models.label import Label
from atelier_core.models.note import NotableKind, Note
from atelier_core.models.signature import Signature
from atelier_core.observers import AuditingDeviceObserver
from atelier_core.policy import Actor, RepairOrderPolicy
from atelier_core.reporting.formatter import Formatter as ReportingFormatter
from atelier_core.services.standard_invoice_calculator import StandardInvoiceCalculator
from atelier_core.support.intake import DEFAULT_ROUTER, IntakeChannelKind, OnSiteIntake
from atelier_core.support.reference import Reference

LANE_ROOT = Path(__file__).resolve().parent.parent
PACKAGES = ("atelier_core", "atelier_bench", "atelier_app", "atelier_frameworks")


def module_names_on_disk() -> list[str]:
    names = []
    for package in PACKAGES:
        for path in sorted((LANE_ROOT / package).rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            parts = path.relative_to(LANE_ROOT).with_suffix("").parts
            names.append(".".join(parts[:-1] if parts[-1] == "__init__" else parts))
    return names


class EveryFileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.state = seeded_state()
        self.data = self.state.data
        self.rows = report("gross-profit").rows(self.data)

    def test_every_module_on_disk_imports(self) -> None:
        on_disk = module_names_on_disk()
        self.assertEqual(len(on_disk), 201)
        walked = set(PACKAGES)
        for package in PACKAGES:
            walked |= {info.name for info in pkgutil.walk_packages(importlib.import_module(package).__path__, f"{package}.")}
        self.assertEqual(sorted(walked), sorted(on_disk))
        for name in on_disk:
            self.assertEqual(importlib.import_module(name).__name__, name)

    def test_console_entry_point_runs_every_command(self) -> None:
        def run(*argv: str) -> str:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(main(list(argv)), 0)
            return out.getvalue()

        self.assertIn("revenue 58325c", run("seed"))
        self.assertEqual(run("report", "gross-profit"), "revenue,583.25\npart cost,463.00\ngross profit,120.25\n")
        self.assertIn("recalculated", run("recalculate"))
        self.assertTrue(run("nope").startswith("usage: atelier"))
        with mock.patch.object(Flask, "run") as flask_run:
            run("serve", "8099")
        flask_run.assert_called_once_with(port=8099)

    def test_every_exporter_exports_the_rows(self) -> None:
        for name in exporters.__all__:
            exporter = getattr(exporters, name)()
            text = exporter.export(self.rows)
            self.assertIsInstance(text, str)
            self.assertNotEqual(text, "")
            self.assertEqual(exporter.filename("gross-profit"), f"gross-profit.{exporter.extension}")
        self.assertEqual(json.loads(exporters.JsonExporter().export(self.rows)), [row._asdict() for row in self.rows])
        self.assertEqual(exporters.PdfExporter().export(self.rows), "%PDF-1.7\n% 3 row(s)\n%%EOF")
        csv = exporters.CsvExporter()
        self.assertEqual((csv.format_percent(0.25), csv.format_count(3), csv.format_cents(-5)), ("25.0%", "3", "-0.05"))

    def test_every_notifier_sends(self) -> None:
        for name in notifiers.__all__:
            notifier = getattr(notifiers, name)()
            delivery = notifier.send("done", "body")
            self.assertEqual(delivery, {"channel": notifier.channel, "reference": f"{notifier.channel}:done"})
            self.assertEqual(notifier.sent_count(), 1)
            self.assertEqual(notifier.bound_sender(), notifier.send)
            self.assertTrue(notifier.is_valid())
            self.assertIsNone(notifier.first_violation())

    def test_every_repository_answers(self) -> None:
        data = self.data
        repositories = [
            (CustomerRepository(data.customers), 3, [customer.id for customer in CustomerRepository(data.customers).reachable()], [1, 2, 3]),
            (InventoryRepository([Movement(1, "SCR-13", -1), Movement(2, "SCR-13", 3)]), 2, InventoryRepository([Movement(1, "SCR-13", -1), Movement(2, "SCR-13", 3)]).net_for("SCR-13"), 2),
            (InvoiceRepository(data.invoices), 2, len(InvoiceRepository(data.invoices).unpaid()), 2),
            (OrderRepository(data.orders), 4, len(OrderRepository(data.orders).open()), 3),
            (PartRepository(data.parts), 4, PartRepository(data.parts).by_sku("KBD-EU").name, "Keyboard EU"),
            (PaymentRepository([Payment(1, 1, 34900), Payment(2, 2, 100)]), 2, PaymentRepository([Payment(1, 1, 34900), Payment(2, 2, 100)]).settled_cents(), 35000),
            (TechnicianRepository(data.technicians), 3, len(TechnicianRepository(data.technicians).available()), 3),
            (WarrantyRepository([Claim(1, 3), Claim(2, 1, settled=True)]), 2, [claim.id for claim in WarrantyRepository([Claim(1, 3), Claim(2, 1, settled=True)]).pending()], [1]),
        ]
        for repository, count, extra, expected in repositories:
            module = importlib.import_module(type(repository).__module__)
            self.assertIs(module.as_repository(repository), repository)
            self.assertEqual(repository.count(), count)
            self.assertEqual(size_of(repository), count)
            self.assertEqual(len(repository.all()), count)
            self.assertIs(repository.find(1), repository.all()[0])
            self.assertIsNone(repository.find(99))
            self.assertEqual(extra, expected)

    def test_every_service_answers(self) -> None:
        data = self.data
        self.assertEqual(BacklogService().depth(data), 3)
        self.assertEqual(ChurnRiskService().at_risk(data), [])
        self.assertAlmostEqual(CustomerRetentionService().rate(data), 1 / 3)
        self.assertEqual(InventoryTurnoverService().for_sku(data, "SCR-13"), 0.0)
        self.assertIsNone(InventoryTurnoverService().for_sku(data, "NOPE"))
        self.assertEqual((OrderVolumeService().total(data), OrderVolumeService().for_customer(data, 1)), (4, 2))
        self.assertEqual(PartUsageService().consumed_units(data), 0)
        self.assertEqual(PaymentLatencyService().days(data), 7.0)
        self.assertAlmostEqual(ProfitMarginService().ratio(data), 12025 / 58325)
        self.assertEqual(RevenueService().total_cents(data), 58325)
        self.assertEqual(TechnicianLoadService().mean_utilisation(data), 0.0)
        self.assertEqual(ThroughputService().completed(data), 1)
        self.assertEqual(WarrantyClaimService().count(data), 1)
        service = RevenueService()
        with service.audited("export"):
            pass
        entry = service.audit("export")
        self.assertEqual((entry["actor"], entry["action"]), ("revenue", "export"))
        self.assertEqual((service.audit_actor(), service.last_audit(), service.audit_depth()), ("revenue", "export", 1))
        self.assertIsNone(last_audit_of([]))

    def test_report_mixins_answer(self) -> None:
        monthly = report("monthly-revenue")
        self.assertEqual(monthly.total(self.data), 583.25)
        self.assertFalse(monthly.is_empty(self.data))
        self.assertEqual((monthly.cache_key(), monthly.ttl_seconds(), monthly.is_cacheable()), ("reports:monthly-revenue", 300, True))
        self.assertEqual((monthly.cache_key_for("rows"), monthly.cache_ttl()), ("reports:rows", 300))
        self.assertEqual((monthly.log_target(), monthly.log_line("built")), ("monthly-revenue", "[monthly-revenue] built"))
        self.assertEqual((monthly.metadata(), monthly.meta("missing"), monthly.meta_keys()), ({}, None, []))
        bag = MetadataBag().set("owner", "finance")
        self.assertEqual((bag.meta("owner"), bag.meta_keys()), ("finance", ["owner"]))

    def test_concerns_nothing_else_reaches(self) -> None:
        self.assertEqual(to_json({"a": [1, 2]}), '{"a":[1,2]}')
        self.assertEqual(to_pretty_json({"a": 1}), '{\n    "a": 1\n}')
        stamped = Stamped({"order": 1})
        epoch = datetime.fromtimestamp(Stamped.FROZEN_EPOCH_SECONDS, tz=timezone.utc)
        self.assertEqual((stamped.created_at(), stamped.updated_at()), (epoch, None))
        self.assertEqual(stamped.age_seconds(epoch + timedelta(seconds=90)), 90)
        self.assertEqual(stamped.expires_at(300), epoch + timedelta(seconds=300))
        self.assertEqual((HasValidation().validate(), HasValidation().is_valid()), ([], True))

    def test_core_helpers_nothing_else_reaches(self) -> None:
        data = self.data
        amount = data.invoices[0].total
        self.assertEqual((amount.euros, repr(amount), hash(amount) == hash(data.invoices[0].total)), (349, "Money(34900)", True))
        self.assertTrue((amount - amount).is_zero())
        self.assertTrue(amount.minus(amount).is_zero())
        self.assertEqual((format_cell(amount), format_cell(1.5), format_cell(3), format_cell("x")), ("349.00", "1.50", "3", "x"))
        self.assertEqual(BillingFormatter("EUR").line(2, "screen", amount), "2 x screen = 349.00 EUR")
        self.assertEqual(ReportingFormatter("nl").locale_tag(), "nl")
        container = Container.with_invoice_calculator(StandardInvoiceCalculator())
        self.assertTrue(is_invoice_calculator(container.invoice_calculator()))
        self.assertTrue(data.technicians[0].forwards("next_slot"))
        self.assertFalse(NotFoundError("part", "X").status_code >= 500)
        self.assertTrue(NotFoundError("part", "X").client_visible)
        self.assertEqual((ValidationError("body", "empty").field, ValidationError("body", "empty").status_code), ("body", 422))
        self.assertEqual([customer.is_reachable() for customer in data.customers], [True, True, True])
        self.assertFalse(Customer(9, "Nobody", "").is_reachable())
        self.assertEqual([device.is_warranty_eligible() for device in data.devices], [True, True, False])
        invoice = Invoice(9, 1, amount)
        self.assertEqual((invoice.mark_paid(), invoice.mark_paid(), invoice.outstanding().is_zero()), (True, False, True))
        label = Label(1, "urgent")
        self.assertEqual(label.attached_ids([{"label_id": 1, "kind": "order", "record_id": 4}, {"label_id": 2, "kind": "order", "record_id": 5}], "order"), [4])
        self.assertEqual(Note(1, NotableKind.PART, 1, "battery swollen", "nel").excerpt(8), "battery…")
        part = Part(9, "TST-1", "Test part", amount, stock=2)
        self.assertEqual((part.extended_price(2).cents, part.consume(3), part.consume(2), part.stock), (69800, False, True, 0))
        self.assertEqual((Signature(1, 1, "Ada").is_captured(), Signature(2, 1, "Ada", "M0 0").is_captured()), (False, True))
        observer = AuditingDeviceObserver()
        observer.created(data.devices[0])
        observer.deleted(data.devices[0])
        self.assertEqual(len(observer.lines), 2)
        self.assertTrue(observer.lines[0].startswith("device.created "))
        policy = RepairOrderPolicy()
        order = data.orders[1]
        self.assertEqual((policy.can_view(Actor(order.customer_id, "customer"), order), policy.can_view(Actor(99, "customer"), order)), (True, False))
        self.assertEqual((policy.can_transition(Actor(1, "technician"), order), policy.can_transition(Actor(1, "customer"), order)), (True, False))
        self.assertEqual((RepairStatus.COLLECTED.is_terminal(), RepairStatus.RECEIVED.is_terminal()), (True, False))
        self.assertEqual((Priority.RUSH.is_expedited(), Priority.STANDARD.is_expedited()), (True, False))
        self.assertEqual(Reference.next(Reference.FIRST_NUMBER), 2)
        self.assertEqual(data.part("BAT-55").name, "Battery 55Wh")
        self.assertIsNone(data.part("NOPE"))
        self.assertEqual(rules.RuleRegistry.rule("rounding").key, "rounding")
        self.assertEqual(OnSiteIntake().accept("AT-2026-000049"), "visit AT-2026-000049")
        self.assertEqual(len(DEFAULT_ROUTER.kinds()), 4)
        self.assertEqual(Device.KINDS["laptop"].__name__, "Laptop")
        self.assertIs(IntakeChannelKind("on-site"), IntakeChannelKind.ON_SITE)


if __name__ == "__main__":
    unittest.main()
