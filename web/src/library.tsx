import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";
import { useLocation } from "preact-iso";
import type {
  NowReadingResponse,
  SenderListResponse,
  TopicListResponse,
  UnreadCountsResponse,
} from "@library/core/types";
import { useApp } from "./context.js";
import { useAsync, type AsyncHandle } from "./hooks.js";

/**
 * What the Mac sidebar and Home both show: Claude's topics, the senders, the unread tally and the
 * issue to come back to (#44).
 */
export interface Library {
  topics: AsyncHandle<TopicListResponse>;
  senders: AsyncHandle<SenderListResponse>;
  counts: AsyncHandle<UnreadCountsResponse>;
  nowReading: AsyncHandle<NowReadingResponse>;
}

const LibraryCtx = createContext<Library | null>(null);

export function LibraryProvider({ children }: { children: ComponentChildren }) {
  const { api } = useApp();
  const { path } = useLocation();
  const topics = useAsync(() => api.listTopics(), []);
  const senders = useAsync(() => api.listSenders(), []);
  const counts = useAsync(() => api.unreadCounts(), []);
  const nowReading = useAsync(() => api.nowReading(), []);

  // Reading and starring happen on other pages; bring the numbers up to date on every move.
  const last = useRef(path);
  useEffect(() => {
    if (last.current === path) return;
    last.current = path;
    senders.reload();
    counts.reload();
    nowReading.reload();
  }, [path]);

  // Coming back to the app: the place may have moved on another device.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") nowReading.reload();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [nowReading.reload]);

  return (
    <LibraryCtx.Provider value={{ topics, senders, counts, nowReading }}>
      {children}
    </LibraryCtx.Provider>
  );
}

export function useLibrary(): Library {
  const lib = useContext(LibraryCtx);
  if (!lib) throw new Error("useLibrary outside LibraryProvider");
  return lib;
}
