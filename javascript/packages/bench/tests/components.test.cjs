// Every exporter, notifier, repository and service module, loaded and exercised.
//
// Each block walks one packages/bench/src directory and requires every module in
// it; its expectation table must name exactly the files the walk finds, so a new
// component without a test (or a test for a deleted one) fails here. Expected
// values are worked out by hand from the frozen seed in src/dataset.cjs and the
// component source, never copied from a run.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const { Customer, Schedule, makeTechnician } = require("@atelier/core");
const { Dataset, NotifyError } = require("@atelier/bench");
const { toJson, toPrettyJson } = require("@atelier/bench/concerns/hasSerialization.cjs");

const SRC = path.join(__dirname, "..", "src");

/** Every .cjs module in one src directory, required, as [fileName, exportedValue]. */
function componentsIn(dir) {
    return fs
        .readdirSync(path.join(SRC, dir))
        .filter((name) => name.endsWith(".cjs"))
        .sort()
        .map((name) => {
            const exported = Object.values(require(path.join(SRC, dir, name)));
            assert.equal(exported.length, 1, `${dir}/${name} exports one component`);
            return [name, exported[0]];
        });
}

function coversExactly(table, components) {
    assert.deepEqual(Object.keys(table).sort(), components.map(([name]) => name));
}

/** A fresh copy of the frozen seed per case, so one case's mutation never leaks. */
function freshSeed() {
    return Dataset.seeded();
}

describe("exporters", () => {
    // formatCents: sign, whole units, two-digit cents (formatterContract.cjs).
    const rows = [
        { label: "revenue", cents: 58325 },
        { label: "refund", cents: -150 },
    ];
    const expected = {
        "csvExporter.cjs": ["csv", "text/csv", "revenue,583.25\nrefund,-1.50"],
        "htmlExporter.cjs": [
            "html",
            "text/html",
            "<table><tr><td>revenue</td><td>583.25</td></tr><tr><td>refund</td><td>-1.50</td></tr></table>",
        ],
        "jsonExporter.cjs": ["json", "application/json", '[{"label":"revenue","cents":58325},{"label":"refund","cents":-150}]'],
        "markdownExporter.cjs": ["md", "text/markdown", "| label | amount |\n| --- | --- |\n| revenue | 583.25 |\n| refund | -1.50 |"],
        "pdfExporter.cjs": ["pdf", "application/pdf", "%PDF-1.7\n% 2 row(s)\n%%EOF"],
        "xlsxExporter.cjs": [
            "xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "A1=revenue B1=58325;A2=refund B2=-150",
        ],
        "xmlExporter.cjs": ["xml", "application/xml", '<rows><row label="revenue" cents="58325"/><row label="refund" cents="-150"/></rows>'],
        "yamlExporter.cjs": ["yaml", "application/yaml", "- label: revenue\n  cents: 58325\n- label: refund\n  cents: -150"],
    };
    const components = componentsIn("exporters");

    it("has one expectation per exporter module", () => coversExactly(expected, components));

    for (const [name, Exporter] of components) {
        it(`${name} renders the rows in its own format`, () => {
            const [extension, mime, output] = expected[name];
            const exporter = new Exporter();

            assert.equal(exporter.extension, extension);
            assert.equal(exporter.mime, mime);
            assert.equal(exporter.export(rows), output);
            assert.equal(exporter.filename("cash-flow"), `cash-flow.${extension}`);
        });
    }
});

describe("notifiers", () => {
    const expected = {
        "discordNotifier.cjs": ["discord", 2000],
        "emailNotifier.cjs": ["email", 65536],
        "pagerNotifier.cjs": ["pager", 512],
        "pushNotifier.cjs": ["push", 1024],
        "slackNotifier.cjs": ["slack", 3000],
        "smsNotifier.cjs": ["sms", 160],
        "teamsNotifier.cjs": ["teams", 4096],
        "webhookNotifier.cjs": ["webhook", 8192],
    };
    const components = componentsIn("notifiers");

    it("has one expectation per notifier module", () => coversExactly(expected, components));

    for (const [name, Notifier] of components) {
        it(`${name} sends up to its byte cap and refuses past it`, () => {
            const [channel, maxBytes] = expected[name];
            const notifier = new Notifier();

            assert.equal(Notifier.CHANNEL, channel);
            assert.equal(notifier.maxBytes, maxBytes);
            assert.deepEqual(notifier.validate(), []);
            // subject + body exactly at the cap is accepted; one byte more is not.
            assert.deepEqual(notifier.send("s", "x".repeat(maxBytes - 1)), { channel, reference: `${channel}:s` });
            assert.throws(() => notifier.send("s", "x".repeat(maxBytes)), NotifyError);
            assert.throws(() => new Notifier("").send("s", "b"), /not configured/);
            assert.deepEqual(new Notifier("").validate(), [{ field: "endpoint", message: "endpoint is empty" }]);
        });
    }
});

describe("repositories", () => {
    // Seed: 3 reachable customers, 4 orders (order 1 completed, 3 open), parts
    // SCR-13 / BAT-55 / KBD-EU / FAN-A1 with ids 1-4, 3 technicians with free
    // 16-slot schedules, 2 unpaid invoices. Movements, payments and claims have no
    // seed rows, so those cases build their own.
    const expected = {
        "customerRepository.cjs": {
            records: (data) => [...data.customers, Customer.seed(4, "Nobody", "")],
            count: 4,
            check: (repo) => assert.deepEqual(repo.reachable().map((customer) => customer.id), [1, 2, 3]),
        },
        "inventoryRepository.cjs": {
            records: () => [
                { id: 1, sku: "BAT-55", delta: 5 },
                { id: 2, sku: "BAT-55", delta: -2 },
                { id: 3, sku: "FAN-A1", delta: 1 },
            ],
            count: 3,
            check: (repo) => {
                assert.equal(repo.netFor("BAT-55"), 3);
                assert.equal(repo.netFor("NONE-0"), 0);
            },
        },
        "invoiceRepository.cjs": {
            records: (data) => {
                data.invoices[0].markPaid();
                return data.invoices;
            },
            count: 2,
            check: (repo) => assert.deepEqual(repo.unpaid().map((invoice) => invoice.id), [2]),
        },
        "orderRepository.cjs": {
            records: (data) => data.orders,
            count: 4,
            check: (repo) => assert.deepEqual(repo.open().map((order) => order.id), [2, 3, 4]),
        },
        "partRepository.cjs": {
            records: (data) => data.parts,
            count: 4,
            check: (repo) => {
                assert.equal(repo.bySku("KBD-EU").id, 3);
                assert.equal(repo.bySku("NONE-0"), undefined);
            },
        },
        "paymentRepository.cjs": {
            records: () => [
                { id: 1, cents: 34900 },
                { id: 2, cents: 1000 },
            ],
            count: 2,
            check: (repo) => assert.equal(repo.settledCents(), 35900),
        },
        "technicianRepository.cjs": {
            records: (data) => [...data.technicians, makeTechnician(4, "Full", new Schedule(0))],
            count: 4,
            check: (repo) => assert.deepEqual(repo.available().map((technician) => technician.id), [1, 2, 3]),
        },
        "warrantyRepository.cjs": {
            records: () => [
                { id: 1, settled: true },
                { id: 2, settled: false },
            ],
            count: 2,
            check: (repo) => assert.deepEqual(repo.pending().map((claim) => claim.id), [2]),
        },
    };
    const components = componentsIn("repositories");

    it("has one expectation per repository module", () => coversExactly(expected, components));

    for (const [name, Repository] of components) {
        it(`${name} finds, lists, counts and answers its own query`, () => {
            const { records, count, check } = expected[name];
            const rows = records(freshSeed());
            const repo = new Repository(rows);

            assert.equal(repo.count(), count);
            assert.equal(repo.all(), rows);
            assert.equal(repo.find(rows[0].id), rows[0]);
            assert.equal(repo.find(99), undefined);
            check(repo);
        });
    }
});

describe("services", () => {
    // Seed numbers: revenue 34900 + 23425 = 58325 cents; part cost 19900 + 2 x 8900
    // + 6400 + 2200 = 46300; customer 1 owns orders 1 and 4, customers 2 and 3 one
    // each; order 3 is the only warranty order; nothing is consumed or booked yet.
    const expected = {
        "backlogService.cjs": { run: (service, data) => service.depth(data), value: 3 },
        "churnRiskService.cjs": {
            // Every customer has an open order, so only a customer with no orders at all is at risk.
            run: (service, data) => {
                data.customers.push(Customer.seed(4, "Dana Scott", "dana@example.test"));
                return service.atRisk(data);
            },
            value: [4],
        },
        "customerRetentionService.cjs": { run: (service, data) => service.rate(data), value: 1 / 3 },
        "inventoryTurnoverService.cjs": {
            // SCR-13 starts at stock 4; consuming 1 leaves stock 3 with 1 consumed.
            run: (service, data) => {
                data.part("SCR-13").consume(1);
                return [service.forSku(data, "SCR-13"), service.forSku(data, "NONE-0")];
            },
            value: [1 / 3, undefined],
        },
        "orderVolumeService.cjs": {
            run: (service, data) => [service.total(data), service.forCustomer(data, 1)],
            value: [4, 2],
        },
        "partUsageService.cjs": {
            run: (service, data) => {
                data.part("SCR-13").consume(1);
                data.part("KBD-EU").consume(2);
                return service.consumedUnits(data);
            },
            value: 3,
        },
        "paymentLatencyService.cjs": {
            // 3.5 days per unpaid invoice; invoice 1 paid leaves one.
            run: (service, data) => {
                data.invoices[0].markPaid();
                return service.days(data);
            },
            value: 3.5,
        },
        "profitMarginService.cjs": { run: (service, data) => service.ratio(data), value: (58325 - 46300) / 58325 },
        "revenueService.cjs": {
            run: (service, data) => [service.totalCents(data), service.metricSweep(data).length],
            value: [58325, 16],
        },
        "technicianLoadService.cjs": {
            // One booked slot of 16 on one of three technicians: (1/16 + 0 + 0) / 3.
            run: (service, data) => {
                data.technicians[0].bookSlot(0);
                return service.meanUtilisation(data);
            },
            value: 1 / 48,
        },
        "throughputService.cjs": { run: (service, data) => service.completed(data), value: 1 },
        "warrantyClaimService.cjs": {
            // The seed has one rush (order 2) and one warranty order (order 3); making
            // order 4 a warranty job gives warranty 2, rush 1, standard 1, so a count
            // of the wrong priority cannot pass.
            run: (service, data) => {
                data.orders[3].priority = "warranty";
                return service.count(data);
            },
            value: 2,
        },
    };
    const components = componentsIn("services");

    it("has one expectation per service module", () => coversExactly(expected, components));

    for (const [name, Service] of components) {
        it(`${name} computes its figure from the seed`, () => {
            const { run, value } = expected[name];
            const service = new Service();

            assert.equal(service.name, Service.NAME);
            assert.deepEqual(run(service, freshSeed()), value);
            assert.equal(service.audit("checked").actor, Service.NAME);
        });
    }
});

describe("serialization concern", () => {
    it("renders any value as compact or indented JSON", () => {
        assert.equal(toJson({ slug: "cash-flow", rows: 2 }), '{"slug":"cash-flow","rows":2}');
        assert.equal(toJson(undefined), "null");
        assert.equal(toPrettyJson({ slug: "cash-flow" }), '{\n    "slug": "cash-flow"\n}');
        assert.equal(toPrettyJson(undefined), "null");
    });
});
