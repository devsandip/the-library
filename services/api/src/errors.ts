export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
/** No reader on the request: the token named nobody (#179). */
export const unauthorized = () => new HttpError(401, "no reader");
/** A daily limit reached (#209): the reader is told plainly, and the day's next start. */
export const tooMany = (message: string) => new HttpError(429, message);
/** The reader is not allowed this (#224): operators only. */
export const forbidden = (message: string) => new HttpError(403, message);
export const notFound = (what = "not found") => new HttpError(404, what);
/** A concurrent change (another device) won; the client should refetch. */
export const conflict = () => new HttpError(409, "changed elsewhere, refetch and retry");
