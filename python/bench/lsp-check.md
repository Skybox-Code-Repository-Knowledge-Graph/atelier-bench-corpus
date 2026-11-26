# Language-server check (python lane)

Server: pyright 1.1.414 (`pyright==1.1.414` in requirements-dev.txt; the wheel bundles that build and runs it on node).
Command: `python bench/lsp_check.py` from python/ with the lane's venv, which starts the venv's `pyright-langserver --stdio` (rootUri = python/, pythonPath = the venv interpreter).
Keys are never changed to match the server: where the two disagree, the tree decides (README, E.5).

14 tasks: 7 agree, 2 disagree, 5 with no answer from the server.

- `impl-invoice-calculator` (implementation): server has no answer. error -32601: Unhandled method textDocument/implementation
  - Tree: pyright implements no textDocument/implementation, so this surface has no server reading; the key lists the class statements read from the tree (nominal subclasses by their class statements, structural implementors and the virtual subclass by the notes' rules).
- `impl-report-contract` (implementation): server has no answer. error -32601: Unhandled method textDocument/implementation
  - Tree: pyright implements no textDocument/implementation, so this surface has no server reading; the key lists the class statements read from the tree (nominal subclasses by their class statements, structural implementors and the virtual subclass by the notes' rules).
- `impl-repository-generic` (implementation): server has no answer. error -32601: Unhandled method textDocument/implementation
  - Tree: pyright implements no textDocument/implementation, so this surface has no server reading; the key lists the class statements read from the tree (nominal subclasses by their class statements, structural implementors and the virtual subclass by the notes' rules).
- `impl-notifier-contract` (implementation): server has no answer. error -32601: Unhandled method textDocument/implementation
  - Tree: pyright implements no textDocument/implementation, so this surface has no server reading; the key lists the class statements read from the tree (nominal subclasses by their class statements, structural implementors and the virtual subclass by the notes' rules).
- `hover-free-function` (hover): agrees. hover contains 'zero-padded width'
- `hover-frozen-seed` (hover): agrees. hover contains 'Changing these rows changes bench ground truth'
- `hover-proxy-forwarding` (hover): agrees. hover contains 'forward to its Schedule'
- `docsym-repair-order` (document_symbol): disagrees. server lists 39 names against the key's 18; key-only: []; server-only: ['container', 'customer_id', 'device_id', 'id', 'labor_minutes', 'log', 'next_status', 'order', 'part', 'parts', 'priority', 'status']
  - Tree: Key right by the notes' document-symbol rule: every one of its 18 names is in the server's list, and the server-only names are parameters, locals and attributes assigned through self, which the rule excludes (the task is UNSCORABLE in bench/score for this reason, issue #208).
- `docsym-report-registry` (document_symbol): disagrees. server lists 12 names against the key's 8; key-only: []; server-only: ['key', 'name', 'slug']
  - Tree: Key right by the same rule: all 8 key names are listed by the server, and its extra names key, name and slug are parameters (of metric, __getattr__, and report / load_report), which the rule excludes.
- `hierarchy-complete-chain` (call_hierarchy): agrees. every listed callee returned (1 listed, 3 returned)
- `hierarchy-incoming-transition` (call_hierarchy): agrees. every listed call site returned (3 listed, 4 returned)
- `hierarchy-cross-package` (call_hierarchy): agrees. every listed callee returned (1 listed, 5 returned)
- `impl-intake-contract` (implementation): server has no answer. error -32601: Unhandled method textDocument/implementation
  - Tree: pyright implements no textDocument/implementation, so this surface has no server reading; the key lists the class statements read from the tree (nominal subclasses by their class statements, structural implementors and the virtual subclass by the notes' rules).
- `hover-cached-property` (hover): agrees. hover contains 'the second read never runs this body'
