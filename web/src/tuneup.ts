/**
 * Weekly tune-up (#26, #159) as the app holds it: read when its page opens, kept for the page's
 * life so Library and ⌘K can say how many rules are waiting. Apply and Not now take a proposal off
 * at once; Apply then reads the tune-up again, since the newsletter's stories have moved.
 */
import { useEffect, useState } from "preact/hooks";
import type { TuneupProposal, TuneupResponse } from "@library/core/types";
import type { LibraryApi } from "./api.js";
import { useApp } from "./context.js";

export type TuneupState =
  | { status: "loading" }
  | { status: "ok"; data: TuneupResponse }
  | { status: "error"; error: string };

let state: TuneupState = { status: "loading" };
let reading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function put(next: TuneupState) {
  state = next;
  for (const l of listeners) l();
}

export const tuneupState = () => state;

/** How many proposed rules are waiting, once the tune-up has been read. */
export const waitingCount = (s: TuneupState) =>
  s.status === "ok" ? s.data.proposals.length : undefined;

/** Reads the tune-up again; what is on screen stays meanwhile. */
export function readTuneup(api: LibraryApi): Promise<void> {
  reading ??= api
    .tuneup()
    .then(
      (data) => put({ status: "ok", data }),
      (err: Error) => {
        if (state.status !== "ok") put({ status: "error", error: err.message });
      },
    )
    .finally(() => (reading = undefined));
  return reading;
}

/** The tune-up: read again each time (its page), only if not read yet (Library), or never (⌘K). */
export function useTuneup(read: "again" | "once" | "never" = "again"): {
  state: TuneupState;
  reload: () => Promise<void>;
} {
  const { api } = useApp();
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (read === "again" || (read === "once" && state.status === "loading")) void readTuneup(api);
  }, []);
  return { state, reload: () => readTuneup(api) };
}

/** Takes a proposal off the page, counting it as put off when it is. */
function without(p: TuneupProposal, putOff: boolean) {
  const before = state;
  if (before.status === "ok") {
    const proposals = before.data.proposals.filter((x) => x.id !== p.id);
    const dismissed = before.data.dismissed + (putOff ? 1 : 0);
    put({ status: "ok", data: { ...before.data, proposals, dismissed } });
  }
  return before;
}

/** Apply: the newsletter's "always" setting, which moves its stories. Throws the API's error. */
export async function applyProposal(api: LibraryApi, p: TuneupProposal) {
  const before = without(p, false);
  try {
    await api.updateSender(p.senderId, { shelf: p.shelf });
  } catch (err) {
    put(before);
    throw err;
  }
  void readTuneup(api);
}

/** Not now: hidden until more of the newsletter's stories are moved that way. */
export async function dismissProposal(api: LibraryApi, p: TuneupProposal) {
  const before = without(p, true);
  try {
    put({ status: "ok", data: await api.dismissTuneup(p.id) });
  } catch (err) {
    put(before);
    throw err;
  }
}
