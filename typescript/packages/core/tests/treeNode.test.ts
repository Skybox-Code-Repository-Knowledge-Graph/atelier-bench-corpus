/**
 * Exercises the self-referential TreeNode type (issue #223, checklist F.5). The module holds an
 * interface only, so nothing of it exists at runtime: the checks that bite are the annotations and
 * the expectTypeOf line, which `npm run typecheck` (tsc over every test file) rejects if the type
 * stops holding nodes of its own type.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type { TreeNode } from "../src/support/treeNode";

describe("self-referential tree", () => {
    it("holds children and a parent of its own type", () => {
        const root: TreeNode = { value: "root", children: [] };
        const leaf: TreeNode = { value: "leaf", children: [], parent: root };
        root.children.push(leaf);

        expect(root.children[0]?.parent?.value).toBe("root");
        expectTypeOf(leaf.children).toEqualTypeOf<TreeNode[]>();
        expectTypeOf(leaf.parent).toEqualTypeOf<TreeNode | undefined>();
    });
});
