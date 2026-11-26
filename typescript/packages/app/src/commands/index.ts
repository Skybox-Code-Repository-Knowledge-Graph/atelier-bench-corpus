/** Console command parsing and dispatch. */

/** Every subcommand the binary accepts. */
export type Command =
    | { readonly kind: "serve"; readonly port: number }
    | { readonly kind: "seed" }
    | { readonly kind: "report"; readonly slug: string }
    | { readonly kind: "recalculate" }
    | { readonly kind: "help" };

/** Default port when `serve` is given no argument. */
export const DEFAULT_PORT = 8080;

/**
 * Parse argv (already stripped of the program name).
 *
 * `export-report` and `recalculate-inventory` are the command names every lane of the corpus
 * shares; `report` and `recalculate` are this lane's own spellings of the same two commands.
 */
export function parseCommand(args: readonly string[]): Command {
    switch (args[0]) {
        case "serve":
            return { kind: "serve", port: Number(args[1] ?? DEFAULT_PORT) || DEFAULT_PORT };
        case "seed":
            return { kind: "seed" };
        case "export-report":
        case "report":
            return { kind: "report", slug: args[1] ?? "gross-profit" };
        case "recalculate-inventory":
        case "recalculate":
            return { kind: "recalculate" };
        default:
            return { kind: "help" };
    }
}

/** Usage text printed by `help` and by an unknown subcommand. */
export function usage(): string {
    return "usage: atelier <serve [port]|seed|export-report [slug]|recalculate-inventory|report [slug]|recalculate>";
}
