//! Reaches the breadth components no other test touches: every exporter and
//! notifier, the repositories and services the registry tests skip, the
//! glob-import helper, the timestamp concern and the device observer. The
//! one-file tests from `the_backlog_is_the_three_open_seed_orders` on, and
//! the churn, usage and load checks in the services test, assert values
//! worked out by hand from the frozen seed (or from one stated change to it).

use atelier_bench::concerns::has_timestamps::{HasTimestamps, Stamped};
use atelier_bench::contracts::exporter_contract::ExporterContract;
use atelier_bench::contracts::notifier_contract::NotifierContract;
use atelier_bench::dataset::Dataset;
use atelier_bench::reports::gross_profit_report::GrossProfitReport;
use atelier_bench::repositories::customer_repository::CustomerRepository;
use atelier_bench::repositories::inventory_repository::InventoryRepository;
use atelier_bench::repositories::invoice_repository::InvoiceRepository;
use atelier_bench::repositories::part_repository::PartRepository;
use atelier_bench::repositories::payment_repository::{Payment, PaymentRepository};
use atelier_bench::repositories::technician_repository::TechnicianRepository;
use atelier_bench::repositories::warranty_repository::WarrantyRepository;
use atelier_bench::services::backlog_service::BacklogService;
use atelier_bench::services::churn_risk_service::ChurnRiskService;
use atelier_bench::services::customer_retention_service::CustomerRetentionService;
use atelier_bench::services::inventory_turnover_service::InventoryTurnoverService;
use atelier_bench::services::order_volume_service::OrderVolumeService;
use atelier_bench::services::part_usage_service::PartUsageService;
use atelier_bench::services::payment_latency_service::PaymentLatencyService;
use atelier_bench::services::profit_margin_service::ProfitMarginService;
use atelier_bench::services::technician_load_service::TechnicianLoadService;
use atelier_bench::services::throughput_service::ThroughputService;
use atelier_bench::services::warranty_claim_service::WarrantyClaimService;
use atelier_bench::support::report_glob::rows_for;
use atelier_core::contracts::repository::Repository;
use atelier_core::observers::{AuditingDeviceObserver, DeviceObserver};
use atelier_core::{Customer, Priority};
use chrono::{DateTime, Utc};

/// The frozen seed, built in one place.
fn seed() -> Dataset {
    Dataset::seeded()
}

#[test]
fn every_exporter_renders_the_glob_helper_rows() {
    let rows = rows_for(&GrossProfitReport::new(), &seed());
    let exporters: [Box<dyn ExporterContract>; 8] = [
        Box::new(atelier_bench::exporters::csv_exporter::CsvExporter::default()),
        Box::new(atelier_bench::exporters::html_exporter::HtmlExporter::default()),
        Box::new(atelier_bench::exporters::json_exporter::JsonExporter::default()),
        Box::new(atelier_bench::exporters::markdown_exporter::MarkdownExporter::default()),
        Box::new(atelier_bench::exporters::pdf_exporter::PdfExporter::default()),
        Box::new(atelier_bench::exporters::xlsx_exporter::XlsxExporter::default()),
        Box::new(atelier_bench::exporters::xml_exporter::XmlExporter::default()),
        Box::new(atelier_bench::exporters::yaml_exporter::YamlExporter::default()),
    ];

    assert!(!rows.is_empty());
    for exporter in &exporters {
        assert!(!exporter.export(&rows).is_empty(), "{}", exporter.mime());
    }
}

#[test]
fn every_notifier_delivers_on_its_default_channel() {
    let notifiers: [Box<dyn NotifierContract>; 8] = [
        Box::new(atelier_bench::notifiers::discord_notifier::DiscordNotifier::default()),
        Box::new(atelier_bench::notifiers::email_notifier::EmailNotifier::default()),
        Box::new(atelier_bench::notifiers::pager_notifier::PagerNotifier::default()),
        Box::new(atelier_bench::notifiers::push_notifier::PushNotifier::default()),
        Box::new(atelier_bench::notifiers::slack_notifier::SlackNotifier::default()),
        Box::new(atelier_bench::notifiers::sms_notifier::SmsNotifier::default()),
        Box::new(atelier_bench::notifiers::teams_notifier::TeamsNotifier::default()),
        Box::new(atelier_bench::notifiers::webhook_notifier::WebhookNotifier::default()),
    ];

    for notifier in &notifiers {
        let delivery = notifier.send("subject", "body").expect("configured");
        assert_eq!(delivery.channel, notifier.channel());
    }
}

#[test]
fn the_repositories_the_registry_tests_skip_count_their_records() {
    let data = seed();
    let invoices = InvoiceRepository::new(data.invoices.clone());
    let parts = PartRepository::new(data.parts.clone());
    let technicians = TechnicianRepository::new(data.technicians.clone());

    assert_eq!(invoices.count(), data.invoices.len());
    assert_eq!(parts.count(), data.parts.len());
    assert_eq!(technicians.count(), data.technicians.len());
    assert!(InventoryRepository::new(Vec::new()).is_empty());
    assert!(WarrantyRepository::new(Vec::new()).is_empty());
}

#[test]
fn the_services_the_registry_tests_skip_answer_on_the_seed() {
    let mut data = seed();
    let empty = Dataset::default();

    // Every seed customer still has an open order (orders 2, 3 and 4).
    let churn = ChurnRiskService::new();
    assert!(churn.at_risk(&data).is_empty());

    let turnover = InventoryTurnoverService::new();
    assert!(turnover.for_sku(&data, "SCR-13").is_some());
    assert!(turnover.for_sku(&data, "NO-SUCH-SKU").is_none());

    assert_eq!(OrderVolumeService::new().total(&data), data.orders.len());

    // The seed consumes no stock; taking 2 screens and 3 keyboards makes 5.
    let usage = PartUsageService::new();
    assert_eq!(usage.consumed_units(&data), 0);
    assert!(data.parts[0].consume(2));
    assert!(data.parts[2].consume(3));
    assert_eq!(usage.consumed_units(&data), 5);
    assert_eq!(usage.consumed_units(&empty), 0);

    // Nothing is booked on the seed; two of sixteen slots on one of the three
    // technicians averages to 2/16/3.
    let load = TechnicianLoadService::new();
    assert!(load.mean_utilisation(&data).abs() < f64::EPSILON);
    assert_eq!(data.technicians[0].book_next_slot(), Some(0));
    assert_eq!(data.technicians[0].book_next_slot(), Some(1));
    assert!((load.mean_utilisation(&data) - 2.0 / 16.0 / 3.0).abs() < 1e-12);
    assert!(load.mean_utilisation(&empty).abs() < f64::EPSILON);

    // Completing order 3 leaves customer 3 with no open order.
    data.orders[2]
        .complete("bench")
        .expect("order 3 is repairing");
    assert_eq!(churn.at_risk(&data), [3]);
}

#[test]
fn the_backlog_is_the_three_open_seed_orders() {
    let data = seed();
    let backlog = BacklogService::new();

    // Orders 2, 3 and 4 are open; the label reported is the last open
    // order's, and order 4 is still Received.
    assert_eq!(backlog.depth(&data), 3);
    assert_eq!(backlog.deepest_state(&data), Some("Received"));
    assert_eq!(backlog.depth(&Dataset::default()), 0);
}

#[test]
fn retention_is_the_share_of_seed_customers_with_two_orders() {
    let retention = CustomerRetentionService::new();

    // Customer 1 has orders 1 and 4; customers 2 and 3 have one each.
    assert!((retention.rate(&seed()) - 1.0 / 3.0).abs() < 1e-12);
    assert!(retention.rate(&Dataset::default()).abs() < f64::EPSILON);
}

#[test]
fn payment_latency_is_three_and_a_half_days_per_unpaid_seed_invoice() {
    let mut data = seed();
    let latency = PaymentLatencyService::new();

    assert!((latency.days(&data) - 7.0).abs() < f64::EPSILON);
    assert!(data.invoices[0].mark_paid());
    assert!((latency.days(&data) - 3.5).abs() < f64::EPSILON);
}

#[test]
fn the_profit_margin_is_seed_revenue_less_part_cost_over_revenue() {
    let margin = ProfitMarginService::new();

    // Revenue 34_900 + 23_425 = 58_325 cents; part lines 19_900 + 2 x 8_900
    // + 6_400 + 2_200 = 46_300 cents.
    let expected = (58_325.0 - 46_300.0) / 58_325.0;
    assert!((margin.ratio(&seed()) - expected).abs() < 1e-12);
    assert!(margin.ratio(&Dataset::default()).abs() < f64::EPSILON);
}

#[test]
fn throughput_counts_the_completed_seed_orders() {
    let mut data = seed();
    let throughput = ThroughputService::new();

    assert_eq!(throughput.completed(&data), 1);
    data.orders[2]
        .complete("bench")
        .expect("order 3 is repairing");
    assert_eq!(throughput.completed(&data), 2);
}

#[test]
fn warranty_claims_count_the_seed_orders_taken_in_under_warranty() {
    let mut data = seed();
    let claims = WarrantyClaimService::new();

    assert_eq!(claims.count(&data), 1);
    data.orders[0].priority = Priority::Warranty;
    assert_eq!(claims.count(&data), 2);
}

#[test]
fn the_customer_repository_finds_seed_customers_and_drops_the_unreachable() {
    let mut records = seed().customers;
    records.push(Customer::new(4, "Walk-in", ""));
    let customers = CustomerRepository::new(records);
    let reachable: Vec<u32> = customers
        .reachable()
        .iter()
        .map(|customer| customer.id)
        .collect();

    assert_eq!(reachable, [1, 2, 3]);
    assert_eq!(
        customers.find(2).map(|customer| customer.name.as_str()),
        Some("Grace Hopper")
    );
    assert!(customers.find(9).is_none());
    assert_eq!(customers.count(), 4);
}

#[test]
fn the_payment_repository_settles_what_the_seed_invoices_total() {
    let payments: Vec<Payment> = seed()
        .invoices
        .iter()
        .map(|invoice| Payment {
            id: invoice.id,
            invoice_id: invoice.id,
            cents: invoice.total.cents(),
        })
        .collect();
    let repository = PaymentRepository::new(payments);

    assert_eq!(repository.settled_cents(), 58_325);
    assert_eq!(
        repository.find(2).map(|payment| payment.cents),
        Some(23_425)
    );
    assert!(repository.find(3).is_none());
    assert_eq!(repository.count(), 2);
}

#[test]
fn a_frozen_stamp_carries_the_corpus_epoch() {
    let stamped = Stamped::frozen(seed().orders.len());
    let later = DateTime::<Utc>::from_timestamp(1_784_188_890, 0).expect("valid instant");

    assert_eq!(stamped.payload, 4);
    assert_eq!(
        stamped.created_at().to_rfc3339(),
        "2026-07-16T08:00:00+00:00"
    );
    assert_eq!(stamped.updated_at(), None);
    assert_eq!(stamped.age_seconds(later), 90);
}

#[test]
fn the_auditing_observer_logs_seed_device_creations_and_deletions() {
    let data = seed();
    let observer = AuditingDeviceObserver::default();

    observer.created(&data.devices[0]);
    observer.updated(&data.devices[1]);
    observer.deleted(&data.devices[2]);

    let lines = observer.lines.lock().expect("lock not poisoned");
    assert_eq!(
        *lines,
        [
            "device.created Framework 13 (SER-0001)",
            "device.deleted Apple MBP 14"
        ]
    );
}
