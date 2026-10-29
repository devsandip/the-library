import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type {
  NowReadingResponse,
  SenderListResponse,
  StatusResponse,
  TopicListResponse,
  UnreadCountsResponse,
} from "@library/core/types";
import { BASE } from "./config.js";
import { useApp } from "./context.js";
import { useAsync, type AsyncHandle } from "./hooks.js";

/** A Gmail check takes a few seconds; the lists reload this long after asking for one. */
const CHECK_WAIT_MS = 8000;

/**
 * What every view shares: Claude's topics, the senders, the unread tally, the issue to come back
 * to (#44) and the last Gmail check. `refresh()` asks for a check now (pull to refresh); views
 * with lists reload when `epoch` moves on.
 */
export interface Library {
  topics: AsyncHandle<TopicListResponse>;
  senders: AsyncHandle<SenderListResponse>;
  counts: AsyncHandle<UnreadCountsResponse>;
  nowReading: AsyncHandle<NowReadingResponse>;
  status: AsyncHandle<StatusResponse>;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Moves on after each refresh, so lists know to reload. */
  epoch: number;
}

const LibraryCtx = createContext<Library | null>(null);

export function LibraryProvider({ children }: { children: ComponentChildren }) {
  const { api } = useApp();
  const { path } = useLocation();
  const topics = useAsync(() => api.listTopics(), [], "topics");
  const senders = useAsync(() => api.listSenders(), [], "senders");
  const counts = useAsync(() => api.unreadCounts(), [], "counts");
  const nowReading = useAsync(() => api.nowReading(), [], "now-reading");
  const status = useAsync(() => api.status(), [], "status");
  const [refreshing, setRefreshing] = useState(false);
  const [epoch, setEpoch] = useState(0);

  // Reading and starring happen on other views; bring the numbers up to date on a move to
  // another part of the app. Moving within one (J and K on the Mac, a story sheet) does not
  // refetch: opening an issue updates the counts and Continue itself.
  const section = path.slice(BASE.length).split("/")[1] ?? "";
  const last = useRef(section);
  useEffect(() => {
    if (last.current === section) return;
    last.current = section;
    senders.reload();
    counts.reload();
    nowReading.reload();
  }, [section]);

  // Coming back to the app: things may have moved on another device (DEV-03).
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      nowReading.reload();
      counts.reload();
      status.reload();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [nowReading.reload, counts.reload, status.reload]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Only an operator checks the mail now (#224); anyone else's pull reloads the lists.
      if (status.data?.operator) {
        await api.refreshNow();
        await new Promise((r) => setTimeout(r, CHECK_WAIT_MS));
      }
      counts.reload();
      status.reload();
      setEpoch((e) => e + 1);
    } finally {
      setRefreshing(false);
    }
  }, [api, counts.reload, status.reload, status.data?.operator]);

  return (
    <LibraryCtx.Provider
      value={{ topics, senders, counts, nowReading, status, refreshing, refresh, epoch }}
    >
      {children}
    </LibraryCtx.Provider>
  );
}

export function useLibrary(): Library {
  const lib = useContext(LibraryCtx);
  if (!lib) throw new Error("useLibrary outside LibraryProvider");
  return lib;
}

/** Reload a list when a refresh lands. */
export function useOnRefresh(reload: () => void) {
  const { epoch } = useLibrary();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [epoch]);
}
