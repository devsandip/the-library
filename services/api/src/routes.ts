import type { Rating, ReaderState, View } from "@library/core/types";
import { badRequest, HttpError, notFound } from "./errors.js";
import type { Services } from "./port.js";

export const API_PREFIX = "/thelibrary/api";

export interface Request {
  method: string;
  /** Path after the API prefix, e.g. "/issues/abc". */
  path: string;
  query: Record<string, string | undefined>;
  body?: string;
}

export interface Response {
  status: number;
  body?: unknown;
}

type Handler = (svc: Services, req: Request, params: string[]) => Promise<Response>;

const ISSUE_ID = "([A-Za-z0-9_-]{1,64})";
const SENDER_ID = "(s[0-9a-f]{12})";
const VIEWS: readonly View[] = ["unread", "all", "archived"];
const READER_STATES: readonly ReaderState[] = ["unread", "read", "archived"];

const ok = (body: unknown): Response => ({ status: 200, body });

function json<T>(req: Request): T {
  if (!req.body) throw badRequest("missing JSON body");
  try {
    return JSON.parse(req.body) as T;
  } catch {
    throw badRequest("body is not valid JSON");
  }
}

function param(params: string[], i: number): string {
  const v = params[i];
  if (v === undefined) throw notFound();
  return v;
}

const routes: { method: string; pattern: RegExp; handler: Handler }[] = [
  {
    method: "GET",
    pattern: /^\/issues$/,
    handler: async (svc, req) => {
      const view = (req.query.view ?? "unread") as View;
      if (!VIEWS.includes(view)) throw badRequest("view must be unread, all or archived");
      const limit = req.query.limit === undefined ? 30 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw badRequest("limit must be an integer from 1 to 100");
      }
      const senderId = req.query.sender;
      if (senderId !== undefined && !new RegExp(`^${SENDER_ID}$`).test(senderId)) {
        throw badRequest("sender is not a sender id");
      }
      return ok(await svc.repo.listIssues(view, { limit, cursor: req.query.cursor, senderId }));
    },
  },
  {
    method: "GET",
    pattern: new RegExp(`^/issues/${ISSUE_ID}$`),
    handler: async (svc, _req, p) => ok(await svc.repo.getIssue(param(p, 0))),
  },
  {
    method: "PATCH",
    pattern: new RegExp(`^/issues/${ISSUE_ID}$`),
    handler: async (svc, req, p) => {
      const { state } = json<{ state?: unknown }>(req);
      if (!READER_STATES.includes(state as ReaderState)) {
        throw badRequest("state must be unread, read or archived");
      }
      return ok(await svc.repo.setState(param(p, 0), state as ReaderState));
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/rating$`),
    handler: async (svc, req, p) => {
      const { value } = json<{ value?: unknown }>(req);
      if (value !== 1 && value !== -1 && value !== 0) throw badRequest("value must be 1, -1 or 0");
      return ok(await svc.repo.setRating(param(p, 0), value as Rating | 0));
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/events$`),
    handler: async (svc, req, p) => {
      const { type } = json<{ type?: unknown }>(req);
      if (type !== "open") throw badRequest("type must be open");
      await svc.repo.logOpen(param(p, 0));
      return { status: 204 };
    },
  },
  {
    method: "GET",
    pattern: /^\/senders$/,
    handler: async (svc) => ok({ items: await svc.repo.listSenders() }),
  },
  {
    method: "GET",
    pattern: new RegExp(`^/senders/${SENDER_ID}$`),
    handler: async (svc, _req, p) => ok(await svc.repo.getSender(param(p, 0))),
  },
  {
    method: "PATCH",
    pattern: new RegExp(`^/senders/${SENDER_ID}$`),
    handler: async (svc, req, p) => {
      const { muted } = json<{ muted?: unknown }>(req);
      if (typeof muted !== "boolean") throw badRequest("muted must be true or false");
      return ok(await svc.repo.setMuted(param(p, 0), muted));
    },
  },
  {
    method: "POST",
    pattern: /^\/ingest$/,
    handler: async (svc) => {
      await svc.startIngest();
      return { status: 202, body: { started: true } };
    },
  },
  {
    method: "GET",
    pattern: /^\/status$/,
    handler: async (svc) => ok(await svc.repo.status()),
  },
];

export async function route(svc: Services, req: Request): Promise<Response> {
  const matches = routes.filter((r) => r.pattern.test(req.path));
  if (!matches.length) throw notFound();
  const r = matches.find((m) => m.method === req.method);
  if (!r) throw new HttpError(405, `method ${req.method} not allowed`);
  const params = (r.pattern.exec(req.path) ?? []).slice(1);
  return r.handler(svc, req, params);
}
