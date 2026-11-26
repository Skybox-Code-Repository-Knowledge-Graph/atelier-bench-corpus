//! Reaches the breadth components no other test touches: every exporter,
//! every notifier, the repositories and services the registry tests skip,
//! and the glob-import helper.

use atelier_bench::contracts::exporter_contract::ExporterContract;
use atelier_bench::contracts::notifier_contract::NotifierContract;
use atelier_bench::dataset::Dataset;
use atelier_bench::reports::gross_profit_report::GrossProfitReport;
use atelier_bench::repositories::inventory_repository::InventoryRepository;
use atelier_bench::repositories::invoice_repository::InvoiceRepository;
use atelier_bench::repositories::part_repository::PartRepository;
use atelier_bench::repositories::technician_repository::TechnicianRepository;
use atelier_bench::repositories::warranty_repository::WarrantyRepository;
use atelier_bench::services::churn_risk_service::ChurnRiskService;
use atelier_bench::services::inventory_turnover_service::InventoryTurnoverService;
use atelier_bench::services::order_volume_service::OrderVolumeService;
use atelier_bench::services::part_usage_service::PartUsageService;
use atelier_bench::services::technician_load_service::TechnicianLoadService;
use atelier_bench::support::report_glob::rows_for;
use atelier_core::contracts::repository::Repository;

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
    let data = seed();
    let empty = Dataset::default();

    let ids: Vec<u32> = data.customers.iter().map(|c| c.id).collect();
    let at_risk = ChurnRiskService::new().at_risk(&data);
    assert!(at_risk.iter().all(|id| ids.contains(id)));

    let turnover = InventoryTurnoverService::new();
    assert!(turnover.for_sku(&data, "SCR-13").is_some());
    assert!(turnover.for_sku(&data, "NO-SUCH-SKU").is_none());

    assert_eq!(OrderVolumeService::new().total(&data), data.orders.len());
    assert_eq!(PartUsageService::new().consumed_units(&empty), 0);

    let load = TechnicianLoadService::new();
    assert!(load.mean_utilisation(&data).is_finite());
    assert!(load.mean_utilisation(&empty).abs() < f64::EPSILON);
}
