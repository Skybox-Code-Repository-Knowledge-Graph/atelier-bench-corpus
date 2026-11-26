// DO NOT FIX. Negative case for parsers and indexers.
//
// TypeScript syntax in a .js file: parameter and return type annotations and
// an `interface` declaration. JavaScript has no type syntax (its only type
// surface is JSDoc), so a JavaScript parser must report an error here, never
// strip the annotations and resolve the rest as if the file were TypeScript.

interface SlotRequest {
    technicianId: number;
}

export function scheduleRepair(order: { id: number }, request: SlotRequest): number {
    const slot: number = request.technicianId * 100 + order.id;

    return slot;
}
