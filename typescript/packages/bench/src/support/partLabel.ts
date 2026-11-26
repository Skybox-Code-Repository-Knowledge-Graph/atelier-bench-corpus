/**
 * Interface declaration merging: two interface declarations of one name in one scope merge into a
 * single type. `sku` is declared by the first one; the second adds a parent and declares `bin`.
 */

/** Something kept on a shelf. */
export interface Stored {
    readonly shelf: string;
}

/** A printed label for a part: what it is. */
export interface PartLabel {
    readonly sku: string;
}

/** The same label: where the part is stored. */
export interface PartLabel extends Stored {
    readonly bin: string;
}

/** The text printed on the label. */
export function labelText(label: PartLabel): string {
    return `${label.sku} @ ${label.bin}`;
}
