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
export const notFound = (what = "not found") => new HttpError(404, what);
/** A concurrent change (another device) won; the client should refetch. */
export const conflict = () => new HttpError(409, "changed elsewhere, refetch and retry");
