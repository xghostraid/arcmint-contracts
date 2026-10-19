/** A request the user can fix (bad input, insufficient balance, limits); surfaces as HTTP 400. */
export class InputError extends Error {}
