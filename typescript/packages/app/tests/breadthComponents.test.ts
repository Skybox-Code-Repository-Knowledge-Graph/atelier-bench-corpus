/**
 * Exercises every breadth component no other test reached (issue #223, checklist F.5): the six
 * exporters, seven notifiers, seven repositories and eleven services beyond the ones
 * breadth.test.ts covers, the three concerns with helpers of their own and the namespace-import
 * fixture (core's self-referential TreeNode is exercised in core/tests/treeNode.test.ts). Every
 * expected value below is worked out by hand from the frozen seed in packages/bench/src/dataset.ts,
 * never read back from the code under test.
 *
 * It lives in the app package because the seeded dataset is reached through seededState().
 */
import { describe, expect, it } from "vitest";

import { seededState } from "@atelier/app";
import { report } from "@atelier/bench";
import { NotifyError } from "@atelier/bench";
import { MetadataBag } from "@atelier/bench/concerns/hasMetadata";
import { toJson, toPrettyJson } from "@atelier/bench/concerns/hasSerialization";
import { Stamped } from "@atelier/bench/concerns/hasTimestamps";
import { HtmlExporter } from "@atelier/bench/exporters/htmlExporter";
import { MarkdownExporter } from "@atelier/bench/exporters/markdownExporter";
import { PdfExporter } from "@atelier/bench/exporters/pdfExporter";
import { XlsxExporter } from "@atelier/bench/exporters/xlsxExporter";
import { XmlExporter } from "@atelier/bench/exporters/xmlExporter";
import { YamlExporter } from "@atelier/bench/exporters/yamlExporter";
import { DiscordNotifier } from "@atelier/bench/notifiers/discordNotifier";
import { EmailNotifier } from "@atelier/bench/notifiers/emailNotifier";
import { PagerNotifier } from "@atelier/bench/notifiers/pagerNotifier";
import { PushNotifier } from "@atelier/bench/notifiers/pushNotifier";
import { SlackNotifier } from "@atelier/bench/notifiers/slackNotifier";
import { TeamsNotifier } from "@atelier/bench/notifiers/teamsNotifier";
import { WebhookNotifier } from "@atelier/bench/notifiers/webhookNotifier";
import { CustomerRepository } from "@atelier/bench/repositories/customerRepository";
import { InventoryRepository } from "@atelier/bench/repositories/inventoryRepository";
import { InvoiceRepository } from "@atelier/bench/repositories/invoiceRepository";
import { PartRepository } from "@atelier/bench/repositories/partRepository";
import { PaymentRepository } from "@atelier/bench/repositories/paymentRepository";
import { TechnicianRepository } from "@atelier/bench/repositories/technicianRepository";
import { WarrantyRepository } from "@atelier/bench/repositories/warrantyRepository";
import { BacklogService } from "@atelier/bench/services/backlogService";
import { ChurnRiskService } from "@atelier/bench/services/churnRiskService";
import { CustomerRetentionService } from "@atelier/bench/services/customerRetentionService";
import { InventoryTurnoverService } from "@atelier/bench/services/inventoryTurnoverService";
import { OrderVolumeService } from "@atelier/bench/services/orderVolumeService";
import { PartUsageService } from "@atelier/bench/services/partUsageService";
import { PaymentLatencyService } from "@atelier/bench/services/paymentLatencyService";
import { ProfitMarginService } from "@atelier/bench/services/profitMarginService";
import { TechnicianLoadService } from "@atelier/bench/services/technicianLoadService";
import { ThroughputService } from "@atelier/bench/services/throughputService";
import { WarrantyClaimService } from "@atelier/bench/services/warrantyClaimService";
import { ruleCount } from "@atelier/bench/support/ruleNamespaceUser";

/** The seed: 3 customers, 4 orders (1 completed, 3 open), 4 parts, 3 technicians, 2 unpaid invoices. */
function data() {
    return seededState().data;
}

/** The gross-profit report's rows on the seed: revenue 58325, part cost 46300, gross profit 12025. */
function grossProfitRows() {
    const found = report("gross-profit");
    if (found === undefined) {
        throw new Error("gross-profit is not registered");
    }

    return found.rows(data());
}

describe("exporters", () => {
    const rows = grossProfitRows();

    it("render the same rows in each format", () => {
        expect(new HtmlExporter().export(rows)).toBe(
            "<table><tr><td>revenue</td><td>583.25</td></tr><tr><td>part cost</td><td>463.00</td></tr><tr><td>gross profit</td><td>120.25</td></tr></table>",
        );
        expect(new MarkdownExporter().export(rows).split("\n")).toEqual([
            "| label | amount |",
            "| --- | --- |",
            "| revenue | 583.25 |",
            "| part cost | 463.00 |",
            "| gross profit | 120.25 |",
        ]);
        expect(new PdfExporter().export(rows)).toBe("%PDF-1.7\n% 3 row(s)\n%%EOF");
        expect(new XlsxExporter().export(rows)).toBe("A1=revenue B1=58325;A2=part cost B2=46300;A3=gross profit B3=12025");
        expect(new XmlExporter().export(rows)).toBe(
            '<rows><row label="revenue" cents="58325"/><row label="part cost" cents="46300"/><row label="gross profit" cents="12025"/></rows>',
        );
        expect(new YamlExporter().export(rows)).toBe(
            "- label: revenue\n  cents: 58325\n- label: part cost\n  cents: 46300\n- label: gross profit\n  cents: 12025",
        );
    });

    it("name files and media types per format", () => {
        const cases = [
            [new HtmlExporter(), "html", "text/html"],
            [new MarkdownExporter(), "md", "text/markdown"],
            [new PdfExporter(), "pdf", "application/pdf"],
            [new XlsxExporter(), "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
            [new XmlExporter(), "xml", "application/xml"],
            [new YamlExporter(), "yaml", "application/yaml"],
        ] as const;
        for (const [exporter, extension, mime] of cases) {
            expect(exporter.filename("gross-profit")).toBe(`gross-profit.${extension}`);
            expect(exporter.mime).toBe(mime);
        }
        expect(new PdfExporter().formatPercent(0.2062)).toBe("20.6%");
        expect(new PdfExporter().formatCents(-5)).toBe("-0.05");
    });
});

describe("notifiers", () => {
    const cases = [
        [new DiscordNotifier(), "discord", 2000],
        [new EmailNotifier(), "email", 65536],
        [new PagerNotifier(), "pager", 512],
        [new PushNotifier(), "push", 1024],
        [new SlackNotifier(), "slack", 3000],
        [new TeamsNotifier(), "teams", 4096],
        [new WebhookNotifier(), "webhook", 8192],
    ] as const;

    it("deliver on their own channel and refuse a payload over their cap", () => {
        for (const [notifier, channel, maxBytes] of cases) {
            expect(notifier.send("ready", "AT-2026-000001")).toEqual({ channel, reference: `${channel}:ready` });
            expect(notifier.maxBytes).toBe(maxBytes);
            expect(notifier.isValid()).toBe(true);
            expect(() => notifier.send("s", "x".repeat(maxBytes))).toThrow(NotifyError);
        }
    });

    it("report an empty endpoint as a violation", () => {
        const unconfigured = new WebhookNotifier("");

        expect(unconfigured.firstViolation()).toEqual({ field: "endpoint", message: "endpoint is empty" });
        expect(() => unconfigured.send("s", "b")).toThrow(/not configured/);
    });
});

describe("repositories", () => {
    it("read the seeded customers, invoices, parts and technicians", () => {
        const seed = data();
        const customers = new CustomerRepository(seed.customers);
        const invoices = new InvoiceRepository(seed.invoices);
        const parts = new PartRepository(seed.parts);
        const technicians = new TechnicianRepository(seed.technicians);

        expect(customers.count()).toBe(3);
        expect(customers.find(2)?.name).toBe("Grace Hopper");
        expect(customers.reachable()).toHaveLength(3);
        expect(invoices.unpaid()).toHaveLength(2);
        expect(invoices.find(2)?.total.cents).toBe(23425);
        expect(parts.bySku("KBD-EU")?.name).toBe("Keyboard EU");
        expect(parts.all()).toHaveLength(4);
        expect(technicians.available()).toHaveLength(3);
        expect(technicians.find(3)?.name).toBe("Sam");
    });

    it("read stock movements, payments and warranty claims they are given", () => {
        const movements = new InventoryRepository([
            { id: 1, sku: "SCR-13", delta: 4 },
            { id: 2, sku: "SCR-13", delta: -1 },
            { id: 3, sku: "BAT-55", delta: 2 },
        ]);
        const payments = new PaymentRepository([
            { id: 1, invoiceId: 1, cents: 34900 },
            { id: 2, invoiceId: 2, cents: 10000 },
        ]);
        const claims = new WarrantyRepository([
            { id: 1, repairOrderId: 3, settled: false },
            { id: 2, repairOrderId: 1, settled: true },
        ]);

        expect(movements.netFor("SCR-13")).toBe(3);
        expect(movements.find(3)?.sku).toBe("BAT-55");
        expect(payments.settledCents()).toBe(44900);
        expect(payments.count()).toBe(2);
        expect(claims.pending().map((claim) => claim.repairOrderId)).toEqual([3]);
        expect(new WarrantyRepository().count()).toBe(0);
    });
});

describe("services", () => {
    it("compute their figures from the seed", () => {
        const seed = data();

        expect(new BacklogService().depth(seed)).toBe(3);
        expect(new ChurnRiskService().atRisk(seed)).toEqual([]);
        expect(new CustomerRetentionService().rate(seed)).toBeCloseTo(1 / 3);
        expect(new OrderVolumeService().total(seed)).toBe(4);
        expect(new OrderVolumeService().forCustomer(seed, 1)).toBe(2);
        expect(new PaymentLatencyService().days(seed)).toBe(7);
        expect(new ProfitMarginService().ratio(seed)).toBeCloseTo(12025 / 58325);
        expect(new ThroughputService().completed(seed)).toBe(1);
        expect(new WarrantyClaimService().count(seed)).toBe(1);
        expect(new TechnicianLoadService().meanUtilisation(seed)).toBe(0);
        expect(new PartUsageService().consumedUnits(seed)).toBe(0);
        expect(new InventoryTurnoverService().forSku(seed, "NOPE-00")).toBeUndefined();
    });

    it("follow stock consumption and bookings", () => {
        const seed = data();
        seed.part("KBD-EU")?.consume(2);
        seed.technicians[0]?.bookSlot(0);

        expect(new PartUsageService().consumedUnits(seed)).toBe(2);
        expect(new InventoryTurnoverService().forSku(seed, "KBD-EU")).toBeCloseTo(2 / 5);
        expect(new TechnicianLoadService().meanUtilisation(seed)).toBeCloseTo(1 / 16 / 3);
    });

    it("audit under their own name", () => {
        const services = [
            [new BacklogService(), "backlog"],
            [new ChurnRiskService(), "churn-risk"],
            [new CustomerRetentionService(), "customer-retention"],
            [new InventoryTurnoverService(), "inventory-turnover"],
            [new OrderVolumeService(), "order-volume"],
            [new PartUsageService(), "part-usage"],
            [new PaymentLatencyService(), "payment-latency"],
            [new ProfitMarginService(), "profit-margin"],
            [new TechnicianLoadService(), "technician-load"],
            [new ThroughputService(), "throughput"],
            [new WarrantyClaimService(), "warranty-claim"],
        ] as const;
        for (const [service, name] of services) {
            service.record("swept");
            expect(service.audit("swept").actor).toBe(name);
            expect(service.lastAudit()).toBe("swept");
        }
    });
});

describe("concerns, fixtures and types", () => {
    it("keep metadata in insertion order", () => {
        const bag = new MetadataBag().set("b", "2").set("a", "1");

        expect(bag.metaKeys()).toEqual(["b", "a"]);
        expect(bag.meta("a")).toBe("1");
        expect(bag.metadata().size).toBe(2);
    });

    it("serialise any value", () => {
        expect(toJson({ cents: 12025 })).toBe('{"cents":12025}');
        expect(toJson(undefined)).toBe("null");
        expect(toPrettyJson([1])).toBe("[\n    1\n]");
    });

    it("stamp payloads at the frozen epoch", () => {
        const stamped = new Stamped("payload");

        expect(stamped.createdAt().toISOString()).toBe("2026-07-16T08:00:00.000Z");
        expect(stamped.updatedAt()).toBeUndefined();
        expect(stamped.ageSeconds(new Date("2026-07-16T08:01:00Z"))).toBe(60);
        expect(stamped.expiresAt(3600).toISOString()).toBe("2026-07-16T09:00:00.000Z");
    });

    it("reads one member off a namespace import", () => {
        expect(ruleCount()).toBe(48);
    });
});
