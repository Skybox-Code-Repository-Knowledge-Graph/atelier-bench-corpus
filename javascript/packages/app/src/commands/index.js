/** Console command parsing and dispatch. */

/**
 * Every subcommand the binary accepts. `export-report` and
 * `recalculate-inventory` are the command names every lane of the corpus
 * shares; `report` and `recalculate` are this lane's own shorter spellings,
 * kept beside them.
 *
 * @typedef {{ kind: "serve", port: number }
 *   | { kind: "seed" }
 *   | { kind: "report", slug: string }
 *   | { kind: "export-report", slug: string, format: "csv" | "json" | "md" }
 *   | { kind: "recalculate" }
 *   | { kind: "recalculate-inventory" }
 *   | { kind: "help" }} Command
 */

/** Default port when `serve` is given no argument. */
export const DEFAULT_PORT = 8080;

/**
 * Parse argv (already stripped of the program name).
 *
 * @param {readonly string[]} args
 * @returns {Command}
 */
export function parseCommand(args) {
    switch (args[0]) {
        case "serve":
            return { kind: "serve", port: Number(args[1] ?? DEFAULT_PORT) || DEFAULT_PORT };
        case "seed":
            return { kind: "seed" };
        case "report":
            return { kind: "report", slug: args[1] ?? "gross-profit" };
        case "export-report":
            return {
                kind: "export-report",
                slug: args[1] ?? "gross-profit",
                format: /** @type {"csv" | "json" | "md"} */ (args[2] ?? "csv"),
            };
        case "recalculate":
            return { kind: "recalculate" };
        case "recalculate-inventory":
            return { kind: "recalculate-inventory" };
        default:
            return { kind: "help" };
    }
}

/**
 * Usage text printed by `help` and by an unknown subcommand.
 *
 * @returns {string}
 */
export function usage() {
    return "usage: atelier <serve [port]|seed|export-report [slug] [csv|json|md]|recalculate-inventory|report [slug]|recalculate>";
}
