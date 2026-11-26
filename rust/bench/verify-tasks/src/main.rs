//! Self-check for `bench/tasks.json`.
//!
//! ```text
//! cargo run -p bench-verify            # resolve every file+needle pair
//! cargo run -p bench-verify -- --lint  # cargo check + broken-fixture guard
//! ```
//!
//! Exit 0 only when every check passes. Follows `php/bench/verify_tasks.php`
//! for the needle keys both read, so the two lanes print the same lines. This
//! one also checks `optional_sites` and `repeated_sites` (a whole `lines`
//! count of 2 or more), the references counting rule in `notes` (`exact_count`
//! = the `known_sites` entries + the sum of `lines`, no line counted twice),
//! and that every `must_not_include` entry written as text or as a `.*`
//! pattern occurs in the code of the lane's sources, outside comments and
//! string literals.

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
        } else if let Some(site) = doubled_site(root, task) {
            failures.push(format!("{id}: FAIL {site} is counted twice"));
        }

        let exclusions = text_exclusions(task);
        if !exclusions.is_empty() {
            let lines = lane_lines.get_or_insert_with(|| lane_source_lines(root));
            for text in absent_from(&exclusions, lines.as_slice()) {
                failures.push(format!(
                    "{id}: FAIL must_not_include {} (on no code line of the lane's sources)",
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

/// A line two entries of a references key both count, as `file:line`. The
/// counting rule counts a line once, so such a key overstates `exact_count`.
/// A known site counts the first line its needle matches (the needle check
/// reports one that matches more), a repeated site every line it matches.
fn doubled_site(root: &Path, task: &Json) -> Option<String> {
    if task.get("surface").and_then(Json::as_str) != Some("references") {
        return None;
    }

    let expect = task.get("expect")?;
    let mut seen: Vec<(&str, usize)> = Vec::new();
    for (key, limit) in [("known_sites", 1), ("repeated_sites", usize::MAX)] {
        let Some(items) = expect.get(key).and_then(Json::as_array) else {
            continue;
        };
        for (file, needle) in items.iter().filter_map(Json::file_needle) {
            let Ok(content) = std::fs::read_to_string(root.join(file)) else {
                continue;
            };
            let hits = content
                .lines()
                .enumerate()
                .filter(|(_, line)| line.contains(needle))
                .map(|(index, _)| index + 1);
            for line in hits.take(limit) {
                if seen.contains(&(file, line)) {
                    return Some(format!("{file}:{line}"));
                }
                seen.push((file, line));
            }
        }
    }

    None
}

/// The `must_not_include` entries that name a look-alike by its text: plain
/// text, or a pattern whose only wildcard is `.*`. A lane prefix (`php/`), a
/// path and a `path#symbol` are skipped. The look-alike such an entry
/// excludes must exist, so it has to occur on a code line of the lane.
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
        if !spaced && path_like {
            continue;
        }
        texts.push(text);
    }

    texts
}

/// Does `entry` occur on `line`? Each `.*` in it stands for any run of
/// characters, so its literal parts must appear in order; an entry without
/// one is matched as it is.
fn occurs_on(entry: &str, line: &str) -> bool {
    let mut rest = line;
    for part in entry.split(".*") {
        match rest.find(part) {
            Some(at) => rest = &rest[at + part.len()..],
            None => return false,
        }
    }

    true
}

/// The entries that occur on none of `lines`.
fn absent_from<'a>(texts: &[&'a str], lines: &[String]) -> Vec<&'a str> {
    texts
        .iter()
        .copied()
        .filter(|text| !lines.iter().any(|line| occurs_on(text, line)))
        .collect()
}

/// The code of each line of a Rust source, in order: `//` comments (doc
/// comments included) and `/* */` blocks (nested ones too) are dropped, and
/// string and char literals keep only their quotes, so a look-alike that only
/// a comment or a string quotes is not one a tool can return. Lifetimes stay
/// code. Limit: a `'` opens a char literal only as `'x'` or `'\` followed by
/// an escape; anything else is read as a lifetime or a label.
fn code_lines(content: &str) -> Vec<String> {
    let chars: Vec<char> = content.chars().collect();
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut depth = 0_usize;
    let mut i = 0;

    while let Some(&c) = chars.get(i) {
        let next = chars.get(i + 1).copied();
        if c == '\n' {
            lines.push(std::mem::take(&mut line));
            i += 1;
        } else if depth > 0 {
            match (c, next) {
                ('/', Some('*')) => {
                    depth += 1;
                    i += 2;
                }
                ('*', Some('/')) => {
                    depth -= 1;
                    i += 2;
                }
                _ => i += 1,
            }
        } else if c == '/' && next == Some('/') {
            while chars.get(i).is_some_and(|&c| c != '\n') {
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            depth = 1;
            i += 2;
        } else if c == '"' {
            i = skip_string(&chars, i, &mut line, &mut lines);
        } else if c == '\'' {
            i = skip_char(&chars, i, &mut line);
        } else {
            line.push(c);
            i += 1;
        }
    }
    lines.push(line);

    lines
}

/// Skip the string literal whose opening `"` is at `start`, keeping only its
/// two quotes on `line` (a raw string's opening hashes were already kept as
/// code); returns the index after the literal.
fn skip_string(chars: &[char], start: usize, line: &mut String, lines: &mut Vec<String>) -> usize {
    let mut from = start;
    while from > 0 && chars[from - 1] == '#' {
        from -= 1;
    }
    let hashes = start - from;
    let raw = from > 0 && chars[from - 1] == 'r' && !continues_ident(chars, from - 1);
    let mut i = start + 1;
    line.push('"');

    while let Some(&c) = chars.get(i) {
        if c == '\n' {
            lines.push(std::mem::take(line));
            i += 1;
        } else if c == '\\' && !raw {
            if chars.get(i + 1) == Some(&'\n') {
                lines.push(std::mem::take(line));
            }
            i += 2;
        } else if c == '"' && (!raw || closes_raw(chars, i, hashes)) {
            line.push('"');

            return i + 1 + if raw { hashes } else { 0 };
        } else {
            i += 1;
        }
    }

    i
}

/// Is the `r` at `at` the tail of an identifier rather than a raw-string
/// prefix (`r`, `br` or `cr`)?
fn continues_ident(chars: &[char], at: usize) -> bool {
    let ident = |i: usize| chars[i].is_alphanumeric() || chars[i] == '_';

    match at {
        0 => false,
        1 => ident(0) && !matches!(chars[0], 'b' | 'c'),
        _ => ident(at - 1) && (!matches!(chars[at - 1], 'b' | 'c') || ident(at - 2)),
    }
}

/// Does the `"` at `quote` close a raw string opened with `hashes` hashes?
fn closes_raw(chars: &[char], quote: usize, hashes: usize) -> bool {
    chars
        .get(quote + 1..quote + 1 + hashes)
        .is_some_and(|run| run.iter().all(|&c| c == '#'))
}

/// Skip the char literal whose `'` is at `start`, keeping `''` on `line`, or
/// keep a lifetime's or a label's `'` as code; returns the index after what
/// was read.
fn skip_char(chars: &[char], start: usize, line: &mut String) -> usize {
    if chars.get(start + 1) == Some(&'\\') {
        let mut i = start + 3;
        while chars.get(i).is_some_and(|&c| c != '\'') {
            i += 1;
        }
        line.push_str("''");

        return i + 1;
    }
    if chars.get(start + 2) == Some(&'\'') {
        line.push_str("''");

        return start + 3;
    }
    line.push('\'');

    start + 1
}

/// Every code line of the lane's Rust sources under `crates/` and
/// `fixtures/`, as `code_lines` reads them; `bench/` stays out, or
/// `tasks.json` would match its own entries.
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
                lines.extend(code_lines(&content));
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
    fn an_exclusion_must_occur_on_a_code_line_of_the_lane() {
        let lane = vec![
            "impl Shape for Square {".to_string(),
            "pub struct Left;".to_string(),
        ];
        let probe = task(
            r#"{"expect": {"must_not_include": ["impl Shape for Square", "pub struct Lfet",
                "php/", "src/other.rs", "src/a.rs#Thing",
                "impl .* for Square", "impl .* for Circle"]}}"#,
        );
        let texts = text_exclusions(&probe);

        assert_eq!(texts.len(), 4);
        assert_eq!(texts[2], "impl .* for Square");
        assert_eq!(
            absent_from(&texts, &lane),
            ["pub struct Lfet", "impl .* for Circle"]
        );
        assert!(occurs_on("impl .* for Square", "impl Shape for Square {"));
        assert!(!occurs_on("for .* impl", "impl Shape for Square {"));
        let source = r##"let a = "impl Shape for Circle"; // impl Shape for Line
/* impl Shape for Dot /* nested */
 still a comment */ impl Shape for Square {
let b = r#"impl Shape for Ring"#; let c = '"'; let d = '\''; let e: &'static str = "\
impl Shape for Arc";"##;

        assert_eq!(
            code_lines(source),
            [
                "let a = \"\"; ",
                "",
                " impl Shape for Square {",
                "let b = r#\"\"; let c = ''; let d = ''; let e: &'static str = \"",
                "\";",
            ]
        );
    }

    #[test]
    fn a_line_two_sites_of_a_references_key_count_is_counted_twice() {
        let name = format!("bench-verify-{}", std::process::id());
        let root = std::env::temp_dir().join(name);
        let file = root.join("a.rs");
        std::fs::create_dir_all(&root).expect("temp dir");
        std::fs::write(&file, "a\nb1\nb2\n").expect("fixture");
        let same_entry = task(
            r#"{"surface": "references", "expect": {"known_sites": [
                {"file": "a.rs", "needle": "a"}, {"file": "a.rs", "needle": "a"}]}}"#,
        );
        let overlap = task(
            r#"{"surface": "references", "expect": {
                "known_sites": [{"file": "a.rs", "needle": "b1"}],
                "repeated_sites": [{"file": "a.rs", "needle": "b", "lines": 2}]}}"#,
        );
        let distinct = task(
            r#"{"surface": "references", "expect": {
                "known_sites": [{"file": "a.rs", "needle": "a"}],
                "repeated_sites": [{"file": "a.rs", "needle": "b", "lines": 2}]}}"#,
        );

        let found = [
            doubled_site(&root, &same_entry),
            doubled_site(&root, &overlap),
            doubled_site(&root, &distinct),
        ];
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(found[0].as_deref(), Some("a.rs:1"));
        assert_eq!(found[1].as_deref(), Some("a.rs:2"));
        assert_eq!(found[2], None);
    }
}
