# rust-analyzer check of the language-server keys

Output of `node bench/lsp-check.mjs --server rust-analyzer` in the `rust` job of `.github/workflows/corpus.yml`,
copied from the job log of the run named below with only the log's timestamp prefixes removed (box E.5,
ruling R5). The script never changes a key. No task disagrees in this run, so no key needed a reading of
the tree against the server; a disagreement in a later run is recorded here with what the tree says.

<!-- lsp-check begin -->
- server: `rust-analyzer 1.96.0 (ac68faa 2026-05-25)`; initialize serverInfo: `rust-analyzer 1.96.0 (ac68faa 2026-05-25)`
- command: `node bench/lsp-check.mjs --server rust-analyzer`, run from the lane root
- run: GitHub Actions run 45894388966, head commit c2ba5c7e4513ae4b92969c23533fede7454c21dc
- workspace quiescent after 7 s (experimental/serverStatus, health ok)
- tasks: 15 (hover 4, document_symbol 2, call_hierarchy 3, implementation 6); agrees 15, disagrees 0, no answer 0

| task | surface | verdict | what the server returned |
| --- | --- | --- | --- |
| impl-invoice-calculator | implementation | agrees | 2 returned, key exact_count 2; every keyed implementation returned, nothing else |
| impl-report-contract | implementation | agrees | 24 returned, key exact_count 24; every keyed implementation returned, nothing else |
| impl-extension-trait-primitive | implementation | agrees | 1 returned, key exact_count 1; every keyed implementation returned, nothing else |
| impl-notifier-contract | implementation | agrees | 8 returned, key exact_count 8; every keyed implementation returned, nothing else |
| hover-free-function | hover | agrees | contains "zero-padded width" |
| hover-macro-generated | hover | agrees | contains "schedule-forwarding inherent methods" |
| hover-frozen-seed | hover | agrees | contains "Changing these rows changes bench ground truth" |
| def-async-trait-method | implementation | agrees | 2 returned, key exact_count 2; every keyed implementation returned, nothing else |
| hover-proxy-forwarding | hover | agrees | contains "forward to its Schedule" |
| docsym-repair-order | document_symbol | agrees | 31 returned, key N = 31, min_symbols 23; same names |
| docsym-report-registry | document_symbol | agrees | 16 returned, key N = 16, min_symbols 12; same names |
| hierarchy-complete-chain | call_hierarchy | agrees | callee crates/atelier-core/src/models/repair_order.rs:69 returned; outgoing: [transition_to crates/atelier-core/src/models/repair_order.rs:69, Err (outside the lane) .../src/result.rs:566, Ok (outside the lane) .../src/result.rs:561] |
| hierarchy-incoming-transition | call_hierarchy | agrees | call crates/atelier-core/src/models/repair_order.rs:86 returned; call crates/atelier-bench/src/dataset.rs:72 returned; call crates/atelier-core/tests/lifecycle.rs:24 returned; 4 callers (min_incoming 3): [complete crates/atelier-core/src/models/repair_order.rs, seeded crates/atelier-bench/src/dataset.rs, walks_the_happy_path crates/atelier-core/tests/lifecycle.rs, refuses_an_illegal_jump crates/atelier-core/tests/lifecycle.rs] |
| hierarchy-cross-package | call_hierarchy | agrees | callee crates/atelier-core/src/events.rs:84 returned; outgoing: [default (outside the lane) .../src/default.rs:139, register crates/atelier-core/src/events.rs:84, new (outside the lane) .../src/sync.rs:424, run crates/atelier-app/src/jobs.rs:21, new crates/atelier-app/src/jobs.rs:16] |
| impl-repository-generic | implementation | agrees | 8 returned, key exact_count 8; every keyed implementation returned, nothing else |
<!-- lsp-check end -->
