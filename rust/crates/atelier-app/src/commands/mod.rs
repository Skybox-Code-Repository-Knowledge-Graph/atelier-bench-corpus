//! Console command parsing and dispatch.
//!
//! The shared command names are `export-report` and `recalculate-inventory`.
//! `report` and `recalculate` are this lane's older spellings of the same two
//! commands and stay accepted.

pub mod export_report;
pub mod recalculate_inventory;

/// Every subcommand the binary accepts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Serve { port: u16 },
    Seed,
    Report { slug: String },
    Recalculate,
    Help,
}

impl Command {
    /// Default port when `serve` is given no argument.
    pub const DEFAULT_PORT: u16 = 8_080;

    /// Parse argv (already stripped of the program name).
    pub fn parse(args: &[String]) -> Command {
        match args.first().map(String::as_str) {
            Some("serve") => Command::Serve {
                port: args
                    .get(1)
                    .and_then(|raw| raw.parse().ok())
                    .unwrap_or(Self::DEFAULT_PORT),
            },
            Some("seed") => Command::Seed,
            Some("export-report" | "report") => Command::Report {
                slug: args
                    .get(1)
                    .cloned()
                    .unwrap_or_else(|| "gross-profit".into()),
            },
            Some("recalculate-inventory" | "recalculate") => Command::Recalculate,
            _ => Command::Help,
        }
    }

    /// Usage text printed by `help` and by an unknown subcommand.
    pub fn usage() -> &'static str {
        "usage: atelier-app <serve [port]|seed|export-report [slug]|recalculate-inventory>"
    }
}
