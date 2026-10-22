import { join } from "node:path";

export const FIXTURES = join(import.meta.dirname, "fixtures");
export const CONSUMER = join(FIXTURES, "consumer");

/** Stands in for firebase-admin's Timestamp: same two methods the codec uses. */
export class FakeTimestamp {
  #date;
  constructor(date) {
    this.#date = date;
  }
  static fromDate(date) {
    return new FakeTimestamp(date);
  }
  toDate() {
    return this.#date;
  }
}
