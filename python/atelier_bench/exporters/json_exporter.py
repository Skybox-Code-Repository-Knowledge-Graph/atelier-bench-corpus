"""json exporter: the compact JSON text comes from the HasSerialization concern's `to_json`."""

from __future__ import annotations

from collections.abc import Sequence

from ..concerns.has_serialization import to_json
from ..contracts.report_contract import ReportRow
from ..support.abstract_exporter import AbstractExporter


class JsonExporter(AbstractExporter):
    def __init__(self) -> None:
        super().__init__("json", "application/json")

    def export(self, rows: Sequence[ReportRow]) -> str:
        return to_json([row._asdict() for row in rows])
