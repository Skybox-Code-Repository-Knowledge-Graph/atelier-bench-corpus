/**
 * A method whose return type is a `this is` predicate narrows its own receiver: once
 * `ticket.isRush()` holds, `ticket` is a RushTicket for the rest of the branch, so `label` reads the
 * override and `promisedBy` exists at all.
 */

/** A bench ticket for one order. */
export class Ticket {
    constructor(readonly reference: string) {}

    /** True for a rush ticket; the checker narrows the receiver on it. */
    isRush(): this is RushTicket {
        return this instanceof RushTicket;
    }

    label(): string {
        return `ticket ${this.reference}`;
    }
}

/** A ticket promised by a time of day. */
export class RushTicket extends Ticket {
    constructor(
        reference: string,
        readonly promisedBy: string,
    ) {
        super(reference);
    }

    override label(): string {
        return `rush ticket ${this.reference}`;
    }
}

/** The note printed on a rush ticket, or nothing for a standard one. */
export function rushNote(ticket: Ticket): string | undefined {
    if (!ticket.isRush()) {
        return undefined;
    }

    return `${ticket.label()} by ${ticket.promisedBy}`;
}
