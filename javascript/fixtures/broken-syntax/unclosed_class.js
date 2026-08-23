// DO NOT FIX. Negative case for parsers and indexers.
//
// The class body and its last method are both left open: a parser must
// report an error here, never a partial tree with an invented closing brace.

export class RepairTicket {
    constructor(id, technician) {
        this.id = id;
        this.technician = technician;
    }

    describe() {
        return `ticket ${this.id} assigned to ${this.technician}`;
    }

    close(reason) {
        this.reason = reason;
