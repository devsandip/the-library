import type { Rating, ReaderState, SenderPatch, Shelf, View } from "@library/core/types";
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
const SHELVES: readonly Shelf[] = ["news", "learning"];

const ok = (body: unknown): Response => ({ status: 200, body });

function json<T>(req: Request): T {
  if (!req.body) throw badRequest("missing JSON body");
  try {
    return JSON.parse(req.body) as T;
  } catch {
    throw badRequest("body is not valid JSON");
  }
}

/** A comma-separated query value (HTTP API also joins repeated parameters with commas). */
function list(value: string | undefined): string[] | undefined {
  return value === undefined ? undefined : value.split(",").map((v) => v.trim());
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
      const senderIds = list(req.query.sender);
      const senderRe = new RegExp(`^${SENDER_ID}$`);
      if (senderIds && (senderIds.length > 50 || !senderIds.every((id) => senderRe.test(id)))) {
        throw badRequest("sender must be up to 50 sender ids, comma-separated");
      }
      const shelf = req.query.shelf as Shelf | undefined;
      if (shelf !== undefined && !SHELVES.includes(shelf)) {
        throw badRequest("shelf must be news or learning");
      }
      const topics = list(req.query.topic);
      if (topics && (topics.length > 20 || topics.some((t) => t.length === 0 || t.length > 60))) {
        throw badRequest("topic must be up to 20 topics of 1 to 60 characters, comma-separated");
      }
      return ok(
        await svc.repo.listIssues(view, {
          limit,
          cursor: req.query.cursor,
          senderIds,
          shelf,
          topics,
        }),
      );
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
      const { state, shelf } = json<{ state?: unknown; shelf?: unknown }>(req);
      if (state === undefined && shelf === undefined) throw badRequest("send state or shelf");
      if (state !== undefined && !READER_STATES.includes(state as ReaderState)) {
        throw badRequest("state must be unread, read or archived");
      }
      if (shelf !== undefined && !SHELVES.includes(shelf as Shelf)) {
        throw badRequest("shelf must be news or learning");
      }
      const id = param(p, 0);
      let item =
        state === undefined ? undefined : await svc.repo.setState(id, state as ReaderState);
      if (shelf !== undefined) item = await svc.repo.setShelf(id, shelf as Shelf);
      return ok(item);
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
      const body = json<Record<string, unknown>>(req);
      const patch: SenderPatch = {};
      for (const key of ["muted", "mustRead"] as const) {
        if (body[key] === undefined) continue;
        if (typeof body[key] !== "boolean") throw badRequest(`${key} must be true or false`);
        patch[key] = body[key];
      }
      if (body.shelf !== undefined) {
        if (body.shelf !== null && !SHELVES.includes(body.shelf as Shelf)) {
          throw badRequest("shelf must be news, learning or null");
        }
        patch.shelf = body.shelf as Shelf | null;
      }
      if (!Object.keys(patch).length) throw badRequest("send muted, mustRead or shelf");
      return ok(await svc.repo.updateSender(param(p, 0), patch));
    },
  },
  {
    method: "GET",
    pattern: /^\/topics$/,
    handler: async (svc) => ok({ topics: await svc.repo.listTopics() }),
  },
  {
    method: "GET",
    pattern: /^\/unread-counts$/,
    handler: async (svc) => ok(await svc.repo.unreadCounts()),
  },
  {
    method: "GET",
    pattern: /^\/summary$/,
    handler: async (svc) => ok(await svc.repo.summary()),
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
