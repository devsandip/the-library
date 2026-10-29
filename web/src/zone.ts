import { READER_TIME_ZONE, readerDay } from "@library/core/days";

/**
 * The reader's time zone (#185): from their settings once the app has started, India until then
 * and for a reader without settings. Every date the app shows and every "today" uses it.
 */
let zone = READER_TIME_ZONE;

export const readerZone = () => zone;

export function setReaderZone(timeZone: string) {
  zone = timeZone;
}

/** Today, YYYY-MM-DD in the reader's time zone. */
export const today = () => readerDay(Date.now(), zone);
