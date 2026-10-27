import { useEffect, useRef } from "preact/hooks";
import type { IssueListItem } from "@library/core/types";
import { useIssueActions, type IssueChange } from "./actions.js";
import { useApp } from "./context.js";
import { useAsync } from "./hooks.js";
import { useLibrary } from "./library.js";
import { useReadingPlace } from "./components/now-reading.js";

/**
 * One open issue, on either device. Opening it marks it read and makes it the Continue item
 * (rules 18 and 19); the place is kept as a share of the issue while it scrolls (#44) and put
 * back on the next visit. The actions change it here and tell the list beside it (`onChange`).
 * A visit that starts on one of its stories (`onStory`: from Learning, #81) reads that story, not
 * the issue, so the issue keeps its state.
 */
export function useOpenIssue(
  id: string,
  onChange?: (id: string, change: Partial<IssueListItem>) => void,
  onStory = false,
) {
  const { api } = useApp();
  const { counts, nowReading } = useLibrary();
  const issue = useAsync(() => api.getIssue(id), [id]);
  const opened = useRef<string | undefined>(undefined);
  const latest = useRef(onChange);
  latest.current = onChange;

  // A new issue starts at its top (its place, if any, is put back once the newsletter fits).
  useEffect(() => {
    scrollTo(0, 0);
  }, [id]);

  // Opening marks the issue read (and logs the open) once per visit.
  useEffect(() => {
    const data = issue.data;
    if (!data || opened.current === data.id) return;
    opened.current = data.id;
    // The open also points Continue at this issue (#44).
    void api.logOpen(data.id).then(nowReading.reload, () => undefined);
    if (onStory) return;
    if (data.state === "unread") {
      issue.set({ ...data, state: "read" });
      latest.current?.(data.id, { state: "read" });
      void api.setState(data.id, "read").then(counts.reload, () => undefined);
    }
  }, [issue.data]);

  const onFit = useReadingPlace(id, issue.data?.position, (issueId, place, keepalive) => {
    // The Continue pill keeps up; a finished issue leaves it.
    nowReading.set((cur) => {
      const n = cur.nowReading;
      if (n?.issue.id !== issueId) return cur;
      return place >= 1
        ? {}
        : { nowReading: { ...n, position: place, at: new Date().toISOString() } };
    });
    const pointed = nowReading.data?.nowReading?.issue.id === issueId;
    void api.savePosition(issueId, place, keepalive).then(
      // A place saved in another issue moves Continue to it.
      () => !pointed && place < 1 && nowReading.reload(),
      () => undefined,
    );
  });

  const patch = (issueId: string, change: IssueChange) => {
    if (issueId === id) issue.set((d) => ({ ...d, ...change }));
    latest.current?.(issueId, change);
  };
  const actions = useIssueActions({ patch });
  return { issue, onFit, actions };
}
