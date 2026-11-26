//! Self-check for `bench/tasks.json`.
//!
//! ```text
//! cargo run -p bench-verify            # resolve every file+needle pair
//! cargo run -p bench-verify -- --lint  # cargo check + broken-fixture guard
//! ```
//!
//! Exit 0 only when every check passes. Follows `php/bench/verify_tasks.php`
//! for the needle keys both read, so the two lanes print the same lines; this
//! one also checks `optional_sites` and `repeated_sites` (a whole `lines`
//! count of 2 or more), the references counting rule in `notes` (`exact_count`
//! = the `known_sites` entries + the sum of `lines`), and that every
//! `must_not_include` entry written as text occurs on a line of the lane's
//! sources.

mod json;

use json::Json;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// Role a needle plays inside its task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    From,
    Expect,
}

/// One resolvable (file, needle) pair.
#[derive(Debug, Clone)]
struct NeedlePair {
    file: String,
    needle: String,
    role: Role,
    /// How many lines the needle must match: 1, or a repeated site's `lines`
    /// (0 when that count is missing, not a whole number, or below 2).
    lines: usize,
}

/// Nested expect keys that hold arrays of {file, needle} objects, each of
/// which must resolve to exactly one line.
const NESTED_KEYS: [&str; 6] = [
    "known_sites",
    "implementations",
    "known_callers",
    "outgoing_includes",
    "incoming_includes",
    "optional_sites",
];

fn main() -> ExitCode {
    let flags: Vec<String> = std::env::args().skip(1).collect();
    let root = lane_root(&flags);

    if flags.iter().any(|flag| flag == "--lint") {
        return run_lint(&root);
    }

    run_tasks(&root)
}

/// The lane root (`rust/`): `--root <dir>` when given, else resolved the same
/// way whether this was built by cargo or by a bare `rustc src/main.rs`.
fn lane_root(flags: &[String]) -> PathBuf {
    if let Some(index) = flags.iter().position(|flag| flag == "--root") {
        if let Some(dir) = flags.get(index + 1) {
            return PathBuf::from(dir);
        }
    }

    match option_env!("CARGO_MANIFEST_DIR") {
        Some(manifest) => Path::new(manifest)
            .parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(".")),
        None => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    }
}

fn run_tasks(root: &Path) -> ExitCode {
    let manifest_path = root.join("bench/tasks.json");
    let raw = match std::fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(error) => {
            eprintln!("FAIL: cannot read {}: {error}", manifest_path.display());

            return ExitCode::FAILURE;
        }
    };

    let document = match json::parse(&raw) {
        Ok(document) => document,
        Err(error) => {
            eprintln!("FAIL: tasks.json is not valid JSON: {error}");

            return ExitCode::FAILURE;
        }
    };

    let Some(tasks) = document.get("tasks").and_then(Json::as_array) else {
        eprintln!("FAIL: tasks.json missing tasks array");

        return ExitCode::FAILURE;
    };

    let mut any_fail = false;
    let mut lane_lines: Option<Vec<String>> = None;

    for task in tasks {
        let Some(id) = task.get("id").and_then(Json::as_str) else {
            eprintln!("FAIL: task missing id");
            any_fail = true;
            continue;
        };

        let pairs = collect_needle_pairs(task);
        let mut from_line: Option<usize> = None;
        let mut expect_resolved = 0usize;
        let mut failures: Vec<String> = Vec::new();

        for pair in &pairs {
            match resolve(root, pair) {
                Ok(line) => match pair.role {
                    Role::From => from_line = Some(line),
                    Role::Expect => expect_resolved += 1,
                },
                Err(reason) => failures.push(format!(
                    "{id}: FAIL {} needle {} ({reason})",
                    pair.file,
                    summarize(&pair.needle)
                )),
            }
        }

        if let Some(problem) = count_problem(task) {
            failures.push(format!("{id}: FAIL {problem}"));
        }

        let exclusions = text_exclusions(task);
        if !exclusions.is_empty() {
            let lines = lane_lines.get_or_insert_with(|| lane_source_lines(root));
            for text in absent_from(&exclusions, lines.as_slice()) {
                failures.push(format!(
                    "{id}: FAIL must_not_include {} (on no line of the lane's sources)",
                    summarize(text)
                ));
            }
        }

        if !failures.is_empty() {
            any_fail = true;
            for failure in failures {
                println!("{failure}");
            }
            continue;
        }

        let from_file = task
            .get("from")
            .and_then(|from| from.get("file"))
            .and_then(Json::as_str)
            .unwrap_or("?");
        let from_display = match from_line {
            Some(line) => format!("{from_file}:{line}"),
            None => format!("{from_file}:?"),
        };

        println!("{id}: OK (from {from_display} -> {expect_resolved} expect needles resolved)");
    }

    if any_fail {
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

/// Resolve one pair to the first of exactly `pair.lines` matching lines (its
/// unique line when `lines` is 1), or explain why it did not.
fn resolve(root: &Path, pair: &NeedlePair) -> Result<usize, String> {
    let path = root.join(&pair.file);
    if !path.is_file() {
        return Err("file missing".to_string());
    }

    if pair.lines == 0 {
        return Err("repeated site needs a whole lines count of 2 or more".to_string());
    }

    let content = std::fs::read_to_string(&path).map_err(|_| "unreadable".to_string())?;
    let hits: Vec<usize> = content
        .lines()
        .enumerate()
        .filter(|(_, line)| line.contains(&pair.needle))
        .map(|(index, _)| index + 1)
        .collect();

    match hits.len() {
        n if n == pair.lines => Ok(hits[0]),
        n if pair.lines == 1 => Err(format!("found {n} times")),
        n => Err(format!("found {n} times, expected {}", pair.lines)),
    }
}

/// Every {file, needle} pair a task carries, in document order.
fn collect_needle_pairs(task: &Json) -> Vec<NeedlePair> {
    let mut pairs = Vec::new();

    if let Some((file, needle)) = task.get("from").and_then(Json::file_needle) {
        pairs.push(NeedlePair {
            file: file.to_string(),
            needle: needle.to_string(),
            role: Role::From,
            lines: 1,
        });
    }

    let Some(expect) = task.get("expect") else {
        return pairs;
    };

    if let Some((file, needle)) = expect.file_needle() {
        pairs.push(NeedlePair {
            file: file.to_string(),
            needle: needle.to_string(),
            role: Role::Expect,
            lines: 1,
        });
    }

    for key in NESTED_KEYS {
        let Some(items) = expect.get(key).and_then(Json::as_array) else {
            continue;
        };

        for item in items {
            if let Some((file, needle)) = item.file_needle() {
                pairs.push(NeedlePair {
                    file: file.to_string(),
                    needle: needle.to_string(),
                    role: Role::Expect,
                    lines: 1,
                });
            }
        }
    }

    if let Some((file, needle)) = expect.get("candidate").and_then(Json::file_needle) {
        pairs.push(NeedlePair {
            file: file.to_string(),
            needle: needle.to_string(),
            role: Role::Expect,
            lines: 1,
        });
    }

    // A repeated site is one needle that matches several identical lines in
    // one file; `lines` says how many, and exactly that many must match.
    if let Some(items) = expect.get("repeated_sites").and_then(Json::as_array) {
        for item in items {
            if let Some((file, needle)) = item.file_needle() {
                pairs.push(NeedlePair {
                    file: file.to_string(),
                    needle: needle.to_string(),
                    role: Role::Expect,
                    lines: repeat_lines(item).unwrap_or(0),
                });
            }
        }
    }

    // Non-needle expect keys (contains, behavior, must_include, min_*, kind,
    // resolution) are ignored by design.
    pairs
}

fn summarize(needle: &str) -> String {
    if needle.chars().count() <= 80 {
        return needle.to_string();
    }

    let head: String = needle.chars().take(77).collect();

    format!("{head}...")
}

/// How many lines a repeated site says its needle matches: a whole number of
/// 2 or more, else `None` (a needle on one line is a known site, not a repeat).
fn repeat_lines(site: &Json) -> Option<usize> {
    site.get("lines")
        .and_then(Json::as_whole)
        .filter(|lines| *lines >= 2)
}

/// The references counting rule in `notes`: `exact_count` is the number of
/// `known_sites` entries plus the sum of every repeated site's `lines`.
/// `None` when the rule holds or the task is not a references task with a
/// stated count.
fn count_problem(task: &Json) -> Option<String> {
    if task.get("surface").and_then(Json::as_str) != Some("references") {
        return None;
    }

    let expect = task.get("expect")?;
    let stated = expect.get("exact_count")?;
    let known = expect
        .get("known_sites")
        .and_then(Json::as_array)
        .map_or(0, <[Json]>::len);
    let repeated_sites = expect
        .get("repeated_sites")
        .and_then(Json::as_array)
        .unwrap_or_default();
    let mut repeated = 0;
    for site in repeated_sites {
        repeated += repeat_lines(site).unwrap_or(0);
    }

    match stated.as_whole() {
        Some(count) if count == known + repeated => None,
        Some(count) => Some(format!(
            "exact_count {count} is not known_sites {known} + repeated lines {repeated}"
        )),
        None => Some("exact_count is not a whole number".to_string()),
    }
}

/// The `must_not_include` entries written as text: not a lane prefix
/// (`php/`), a path, a `path#symbol` or a `.*` pattern. The look-alike such
/// an entry excludes must exist, so the text has to occur on a lane line.
fn text_exclusions(task: &Json) -> Vec<&str> {
    let mut texts = Vec::new();
    let Some(entries) = task
        .get("expect")
        .and_then(|expect| expect.get("must_not_include"))
        .and_then(Json::as_array)
    else {
        return texts;
    };

    for entry in entries {
        let Some(text) = entry.as_str() else {
            continue;
        };
        let spaced = text.chars().any(char::is_whitespace);
        let path_like = text.contains('/') || text.contains('#');
        if text.contains(".*") || (!spaced && path_like) {
            continue;
        }
        texts.push(text);
    }

    texts
}

/// The texts that occur on none of `lines`.
fn absent_from<'a>(texts: &[&'a str], lines: &[String]) -> Vec<&'a str> {
    texts
        .iter()
        .copied()
        .filter(|text| !lines.iter().any(|line| line.contains(*text)))
        .collect()
}

/// Every line of the lane's Rust sources under `crates/` and `fixtures/`;
/// `bench/` stays out, or `tasks.json` would match its own entries.
fn lane_source_lines(root: &Path) -> Vec<String> {
    let mut lines = Vec::new();
    let mut pending = vec![root.join("crates"), root.join("fixtures")];

    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&path) {
                lines.extend(content.lines().map(str::to_string));
            }
        }
    }

    lines
}

/// `--lint`: the whole workspace must compile, and every broken fixture must
/// still fail to compile.
fn run_lint(root: &Path) -> ExitCode {
    let check = Command::new("cargo")
        .args(["check", "--workspace", "--all-targets", "--quiet"])
        .current_dir(root)
        .status();

    match check {
        Ok(status) if status.success() => println!("lint: OK (cargo check --workspace)"),
        Ok(status) => {
            println!("lint: FAIL (cargo check exited {status})");

            return ExitCode::FAILURE;
        }
        Err(error) => {
            println!("lint: FAIL (cargo not runnable: {error})");

            return ExitCode::FAILURE;
        }
    }

    let fixtures = root.join("fixtures/broken-syntax");
    let Ok(entries) = std::fs::read_dir(&fixtures) else {
        println!("lint: FAIL (missing {})", fixtures.display());

        return ExitCode::FAILURE;
    };

    let mut checked = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }

        let compiled = Command::new("rustc")
            .args([
                "--edition",
                "2024",
                "--crate-type",
                "lib",
                "--emit",
                "metadata",
                "-o",
            ])
            .arg("/dev/null")
            .arg(&path)
            .output();

        match compiled {
            Ok(output) if output.status.success() => {
                println!("lint: FAIL ({} compiled; it must not)", path.display());

                return ExitCode::FAILURE;
            }
            Ok(_) => checked += 1,
            Err(error) => {
                println!("lint: FAIL (rustc not runnable: {error})");

                return ExitCode::FAILURE;
            }
        }
    }

    println!("lint: OK ({checked} broken fixture(s) still refuse to compile)");

    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(raw: &str) -> Json {
        json::parse(raw).expect("test task parses")
    }

    #[test]
    fn a_references_count_is_the_known_sites_plus_the_repeated_lines() {
        let consistent = task(
            r#"{"surface": "references", "expect": {"exact_count": 3,
                "known_sites": [{"file": "a.rs", "needle": "x"}],
                "repeated_sites": [{"file": "a.rs", "needle": "y", "lines": 2}]}}"#,
        );
        let over = task(
            r#"{"surface": "references", "expect": {"exact_count": 2,
                "known_sites": [{"file": "a.rs", "needle": "x"}]}}"#,
        );
        let fraction = task(r#"{"surface": "references", "expect": {"exact_count": 1.5}}"#);
        let other = task(r#"{"surface": "implementation", "expect": {"exact_count": 9}}"#);

        assert_eq!(count_problem(&consistent), None);
        assert_eq!(
            count_problem(&over).as_deref(),
            Some("exact_count 2 is not known_sites 1 + repeated lines 0")
        );
        assert_eq!(
            count_problem(&fraction).as_deref(),
            Some("exact_count is not a whole number")
        );
        assert_eq!(count_problem(&other), None);
    }

    #[test]
    fn a_repeated_site_needs_a_whole_lines_count_of_two_or_more() {
        let sites = task(r#"[{"lines": 2}, {"lines": 6}, {"lines": 1}, {"lines": 6.7}, {}]"#);
        let counts: Vec<Option<usize>> = sites
            .as_array()
            .expect("array")
            .iter()
            .map(repeat_lines)
            .collect();
        let one_line = task(
            r#"{"expect": {"repeated_sites": [{"file": "a.rs", "needle": "y", "lines": 1}]}}"#,
        );

        assert_eq!(counts, [Some(2), Some(6), None, None, None]);
        assert_eq!(collect_needle_pairs(&one_line)[0].lines, 0);
    }

    #[test]
    fn a_text_exclusion_must_occur_on_a_lane_line() {
        let lane = vec![
            "impl Shape for Square {".to_string(),
            "pub struct Left;".to_string(),
        ];
        let probe = task(
            r#"{"expect": {"must_not_include": ["impl Shape for Square", "pub struct Lfet",
                "php/", "src/other.rs", "src/a.rs#Thing", "impl .* for Circle"]}}"#,
        );
        let texts = text_exclusions(&probe);

        assert_eq!(texts, ["impl Shape for Square", "pub struct Lfet"]);
        assert_eq!(absent_from(&texts, &lane), ["pub struct Lfet"]);
    }
}
