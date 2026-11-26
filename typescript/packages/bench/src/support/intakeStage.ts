/**
 * Enum declaration merging: two `enum` declarations of one name in one scope merge into one enum.
 * `Received` is declared only by the second one.
 */

/** Where a device is between the booking and the bench: booked, then received in the shop. */
export enum IntakeStage { Booked = "booked" }
export enum IntakeStage { Received = "received" }

/** True once the device is on the bench. */
export function onBench(stage: IntakeStage): boolean {
    return stage === IntakeStage.Received;
}
