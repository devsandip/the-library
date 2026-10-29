import { isReaderDay, readerDay } from "@library/core/days";
import { checkSettingsPatch } from "@library/core/settings";
import { limitMessage, type Limited } from "@library/core/usage";
import { cleanNote, cleanQuote, HIGHLIGHT_MAX, NOTE_MAX } from "@library/core/highlights";
import type {
  PredictionStatus,
  PredictionView,
  Rating,
  ReaderState,
  SearchSort,
  SenderPatch,
  Shelf,
  StoryPatch,
  StoryState,
  View,
} from "@library/core/types";
import { badRequest, HttpError, notFound, tooMany } from "./errors.js";
import type { Services } from "./port.js";

export const API_PREFIX = "/nutgraf/api";

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
const STORY_N = "([1-9][0-9]?)";
const VIEWS: readonly View[] = ["unread", "all", "archived", "saved"];
const READER_STATES: readonly ReaderState[] = ["unread", "read", "archived"];
const STORY_STATES: readonly StoryState[] = ["unread", "read", "archived"];
const STORY_VIEWS: readonly Exclude<View, "saved">[] = ["unread", "all", "archived"];
const SHELVES: readonly Shelf[] = ["news", "learning"];
const SORTS: readonly SearchSort[] = ["best", "newest"];
const PREDICTION_VIEWS: readonly PredictionView[] = ["open", "settled"];
const VERDICTS: readonly Exclude<PredictionStatus, "open">[] = ["right", "wrong", "unclear"];
/** A tune-up proposal's id (#158): `<senderId>.<shelf>`. */
const TUNEUP_ID = new RegExp(`^${SENDER_ID}\\.(news|learning)$`);
/** A prediction's id: `<issueId>.<k>`. */
const PREDICTION_ID = "([A-Za-z0-9_-]{1,64}\\.[1-9][0-9]?)";
/** A highlight's id (#166): `<issueId>.<key>`. */
const HIGHLIGHT_ID = "([A-Za-z0-9_-]{1,64}\\.[0-9a-z]{12})";
/** The Highlights page's `next`: a highlight's `gsi1` sort key, `<createdAt>#<issueId>#<key>`. */
const HIGHLIGHT_CURSOR = /^\d{4}-\d{2}-\d{2}T[0-9:.]{8,12}Z#[A-Za-z0-9_-]{1,64}#[0-9a-z]{12}$/;

const ok = (body: unknown): Response => ({ status: 200, body });

/** One use of a limited feature, or 429 with a plain message once the day's are used (#209). */
async function within(svc: Services, feature: Limited): Promise<void> {
  const { ok: allowed, limit } = await svc.repo.takeUse(feature);
  if (!allowed) throw tooMany(limitMessage(feature, limit));
}

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

/** The paging and filters `/issues` and `/learning` share: limit, senders and topics. */
function listQuery(req: Request) {
  const limit = req.query.limit === undefined ? 30 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw badRequest("limit must be an integer from 1 to 100");
  }
  const senderIds = list(req.query.sender);
  const senderRe = new RegExp(`^${SENDER_ID}$`);
  if (senderIds && (senderIds.length > 50 || !senderIds.every((id) => senderRe.test(id)))) {
    throw badRequest("sender must be up to 50 sender ids, comma-separated");
  }
  const topics = list(req.query.topic);
  if (topics && (topics.length > 20 || topics.some((t) => t.length === 0 || t.length > 60))) {
    throw badRequest("topic must be up to 20 topics of 1 to 60 characters, comma-separated");
  }
  return { limit, cursor: req.query.cursor, senderIds, topics };
}

/** A highlight's note (#166): text, or null or nothing for none. */
function noteOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length > NOTE_MAX) {
    throw badRequest(`note must be text of up to ${NOTE_MAX.toLocaleString("en")} characters`);
  }
  return cleanNote(value);
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
      if (!VIEWS.includes(view)) {
        throw badRequest("view must be unread, all, archived or saved");
      }
      const shelf = req.query.shelf as Shelf | undefined;
      if (shelf !== undefined && !SHELVES.includes(shelf)) {
        throw badRequest("shelf must be news or learning");
      }
      return ok(await svc.repo.listIssues(view, { ...listQuery(req), shelf }));
    },
  },
  {
    method: "GET",
    pattern: /^\/learning$/,
    handler: async (svc, req) => {
      const view = (req.query.view ?? "unread") as Exclude<View, "saved">;
      if (!STORY_VIEWS.includes(view)) throw badRequest("view must be unread, all or archived");
      return ok(await svc.repo.listLearning(view, listQuery(req)));
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
      const { state, shelf, saved } = json<{ state?: unknown; shelf?: unknown; saved?: unknown }>(
        req,
      );
      if (state === undefined && shelf === undefined && saved === undefined) {
        throw badRequest("send state, shelf or saved");
      }
      if (state !== undefined && !READER_STATES.includes(state as ReaderState)) {
        throw badRequest("state must be unread, read or archived");
      }
      if (shelf !== undefined && !SHELVES.includes(shelf as Shelf)) {
        throw badRequest("shelf must be news or learning");
      }
      if (saved !== undefined && typeof saved !== "boolean") {
        throw badRequest("saved must be true or false");
      }
      const id = param(p, 0);
      let item =
        state === undefined ? undefined : await svc.repo.setState(id, state as ReaderState);
      if (shelf !== undefined) item = await svc.repo.setShelf(id, shelf as Shelf);
      if (saved !== undefined) item = await svc.repo.setSaved(id, saved);
      return ok(item);
    },
  },
  {
    method: "POST",
    pattern: /^\/ask$/,
    handler: async (svc, req) => {
      const { q } = json<{ q?: unknown }>(req);
      const question = typeof q === "string" ? q.replace(/\s+/g, " ").trim() : "";
      if (question.length < 3 || question.length > 300) {
        throw badRequest("q must be a question of 3 to 300 characters");
      }
      await within(svc, "ask");
      return ok(await svc.ask.ask(question));
    },
  },
  {
    method: "GET",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/related$`),
    handler: async (svc, _req, p) => ok(await svc.related.related(param(p, 0))),
  },
  {
    method: "GET",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories$`),
    handler: async (svc, _req, p) => ok(await svc.repo.stories(param(p, 0))),
  },
  {
    method: "PATCH",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories/${STORY_N}$`),
    handler: async (svc, req, p) => {
      const { state, shelf } = json<{ state?: unknown; shelf?: unknown }>(req);
      if (state === undefined && shelf === undefined) throw badRequest("send state or shelf");
      if (state !== undefined && !STORY_STATES.includes(state as StoryState)) {
        throw badRequest("state must be unread, read or archived");
      }
      if (shelf !== undefined && !SHELVES.includes(shelf as Shelf)) {
        throw badRequest("shelf must be news or learning");
      }
      return ok(
        await svc.repo.setStory(param(p, 0), Number(param(p, 1)), {
          state,
          shelf,
        } as StoryPatch),
      );
    },
  },
  {
    method: "GET",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories/${STORY_N}/timeline$`),
    handler: async (svc, _req, p) => ok(await svc.timelines.get(param(p, 0), Number(param(p, 1)))),
  },
  {
    // Never on its own: only when the reader asks (one Claude call, about half a cent).
    method: "POST",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories/${STORY_N}/timeline$`),
    handler: async (svc, _req, p) => {
      await within(svc, "timeline");
      return ok(await svc.timelines.run(param(p, 0), Number(param(p, 1))));
    },
  },
  {
    method: "GET",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories/${STORY_N}/takes$`),
    handler: async (svc, _req, p) => ok(await svc.takes.get(param(p, 0), Number(param(p, 1)))),
  },
  {
    // Never on its own: only when the reader asks (one Claude call, about a cent).
    method: "POST",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories/${STORY_N}/takes$`),
    handler: async (svc, _req, p) => {
      await within(svc, "takes");
      return ok(await svc.takes.run(param(p, 0), Number(param(p, 1))));
    },
  },
  {
    method: "GET",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories/${STORY_N}/source$`),
    handler: async (svc, _req, p) => ok(await svc.sources.get(param(p, 0), Number(param(p, 1)))),
  },
  {
    // Never on its own: only when the reader asks (a page read and one Claude call). The check
    // runs in the jobs Lambda: 202 while it runs, and GET follows it.
    method: "POST",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories/${STORY_N}/source$`),
    handler: async (svc, _req, p) => {
      await within(svc, "source");
      const res = await svc.sources.run(param(p, 0), Number(param(p, 1)));
      return { status: res.running ? 202 : 200, body: res };
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories/${STORY_N}/follow$`),
    handler: async (svc, _req, p) =>
      ok(await svc.following.follow(param(p, 0), Number(param(p, 1)))),
  },
  {
    method: "DELETE",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/stories/${STORY_N}/follow$`),
    handler: async (svc, _req, p) => {
      await svc.following.unfollow(param(p, 0), Number(param(p, 1)));
      return { status: 204 };
    },
  },
  {
    // Keep a passage of the issue (#166); the same passage again answers the one kept.
    method: "POST",
    pattern: new RegExp(`^/issues/${ISSUE_ID}/highlights$`),
    handler: async (svc, req, p) => {
      const body = json<{ exact?: unknown; prefix?: unknown; suffix?: unknown; note?: unknown }>(
        req,
      );
      for (const k of ["exact", "prefix", "suffix"] as const) {
        if (body[k] !== undefined && typeof body[k] !== "string") {
          throw badRequest(`${k} must be text`);
        }
      }
      const quote = cleanQuote({
        exact: (body.exact as string | undefined) ?? "",
        prefix: body.prefix as string | undefined,
        suffix: body.suffix as string | undefined,
      });
      if (!quote.exact || quote.exact.length > HIGHLIGHT_MAX) {
        throw badRequest(
          `exact must be a passage of 1 to ${HIGHLIGHT_MAX.toLocaleString("en")} characters`,
        );
      }
      return ok(await svc.highlights.add(param(p, 0), quote, noteOf(body.note)));
    },
  },
  {
    method: "GET",
    pattern: /^\/highlights$/,
    handler: async (svc, req) => {
      const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw badRequest("limit must be an integer from 1 to 200");
      }
      const before = req.query.before;
      if (before !== undefined && !HIGHLIGHT_CURSOR.test(before)) {
        throw badRequest("before must be a page's next");
      }
      return ok(await svc.highlights.list(limit, before));
    },
  },
  {
    // Sandip's note on a highlight, or null to clear it.
    method: "PATCH",
    pattern: new RegExp(`^/highlights/${HIGHLIGHT_ID}$`),
    handler: async (svc, req, p) => {
      const body = json<{ note?: unknown }>(req);
      if (!("note" in body)) throw badRequest("send note, or null to clear it");
      return ok(await svc.highlights.note(param(p, 0), noteOf(body.note)));
    },
  },
  {
    method: "DELETE",
    pattern: new RegExp(`^/highlights/${HIGHLIGHT_ID}$`),
    handler: async (svc, _req, p) => {
      await svc.highlights.remove(param(p, 0));
      return { status: 204 };
    },
  },
  {
    method: "GET",
    pattern: /^\/following$/,
    handler: async (svc) => ok(await svc.following.list()),
  },
  {
    method: "POST",
    pattern: /^\/following\/seen$/,
    handler: async (svc) => {
      await svc.following.seen();
      return { status: 204 };
    },
  },
  {
    method: "GET",
    pattern: /^\/search$/,
    handler: async (svc, req) => {
      const q = (req.query.q ?? "").trim();
      if (!q || q.length > 200) throw badRequest("q must be 1 to 200 characters");
      const sort = (req.query.sort ?? "best") as SearchSort;
      if (!SORTS.includes(sort)) throw badRequest("sort must be best or newest");
      return ok(await svc.search.search(q, sort));
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
      if (type !== "open" && type !== "peek") throw badRequest("type must be open or peek");
      const id = param(p, 0);
      await (type === "open" ? svc.repo.logOpen(id) : svc.repo.logPeek(id));
      return { status: 204 };
    },
  },
  {
    method: "GET",
    pattern: /^\/now-reading$/,
    handler: async (svc) => ok(await svc.repo.nowReading()),
  },
  {
    method: "PUT",
    pattern: /^\/now-reading$/,
    handler: async (svc, req) => {
      const { id, position } = json<{ id?: unknown; position?: unknown }>(req);
      if (typeof id !== "string" || !new RegExp(`^${ISSUE_ID}$`).test(id)) {
        throw badRequest("id must be an issue id");
      }
      if (typeof position !== "number" || !(position >= 0 && position <= 1)) {
        throw badRequest("position must be a number from 0 to 1");
      }
      await svc.repo.savePosition(id, position);
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
    pattern: /^\/audit$/,
    handler: async (svc) => ok(await svc.audit.audit()),
  },
  {
    method: "GET",
    pattern: /^\/tuneup$/,
    handler: async (svc) => ok(await svc.tuneup.tuneup()),
  },
  {
    // Not now on a proposed newsletter rule (#158).
    method: "POST",
    pattern: /^\/tuneup\/dismissed$/,
    handler: async (svc, req) => {
      const { id } = json<{ id?: unknown }>(req);
      if (typeof id !== "string" || !TUNEUP_ID.test(id)) {
        throw badRequest("id must be <senderId>.news or <senderId>.learning");
      }
      return ok(await svc.tuneup.dismiss(id));
    },
  },
  {
    method: "GET",
    pattern: /^\/settings$/,
    handler: async (svc) => ok(await svc.settings.get()),
  },
  {
    // Time zone, interests and the line prompts use (#184).
    method: "PATCH",
    pattern: /^\/settings$/,
    handler: async (svc, req) => {
      const checked = checkSettingsPatch(json<unknown>(req));
      if ("error" in checked) throw badRequest(checked.error);
      return ok(await svc.settings.save(checked.patch));
    },
  },
  {
    // Deletes everything the reader has, then their sign-in, in the jobs Lambda (#220).
    method: "DELETE",
    pattern: /^\/account$/,
    handler: async (svc) => ({ status: 202, body: await svc.account.delete() }),
  },
  {
    // Everything Nutgraf keeps for the reader, as one file (#219).
    method: "GET",
    pattern: /^\/export$/,
    handler: async (svc) => ok(await svc.repo.exportData()),
  },
  {
    // The reader's model use by day and feature (#208).
    method: "GET",
    pattern: /^\/usage$/,
    handler: async (svc) => ok(await svc.repo.usage()),
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
    method: "GET",
    pattern: /^\/history$/,
    handler: async (svc, req) => {
      const day = req.query.day ?? readerDay(Date.now(), (await svc.repo.settings()).timeZone);
      if (!isReaderDay(day)) throw badRequest("day must be a date like 2026-10-10");
      return ok(await svc.repo.history(day));
    },
  },
  {
    method: "GET",
    pattern: /^\/predictions$/,
    handler: async (svc, req) => {
      const view = (req.query.view ?? "open") as PredictionView;
      if (!PREDICTION_VIEWS.includes(view)) throw badRequest("view must be open or settled");
      return ok(await svc.predictions.list(view));
    },
  },
  {
    // Sandip's verdict on a prediction (#140), or null to hand it back to the daily settling.
    method: "PATCH",
    pattern: new RegExp(`^/predictions/${PREDICTION_ID}$`),
    handler: async (svc, req, p) => {
      const body = json<{ verdict?: unknown }>(req);
      const verdict = body.verdict;
      if (verdict !== null && !VERDICTS.includes(verdict as (typeof VERDICTS)[number])) {
        throw badRequest("verdict must be right, wrong, unclear or null");
      }
      return ok(
        await svc.predictions.set(param(p, 0), verdict as (typeof VERDICTS)[number] | null),
      );
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
