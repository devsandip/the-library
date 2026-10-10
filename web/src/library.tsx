import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";
import { useLocation } from "preact-iso";
import type {
  SenderListResponse,
  TopicListResponse,
  UnreadCountsResponse,
} from "@library/core/types";
import { useApp } from "./context.js";
import { useAsync, type AsyncHandle } from "./hooks.js";

/** What the Mac sidebar and Home both show: Claude's topics, the senders and the unread tally. */
export interface Library {
  topics: AsyncHandle<TopicListResponse>;
  senders: AsyncHandle<SenderListResponse>;
  counts: AsyncHandle<UnreadCountsResponse>;
}

const LibraryCtx = createContext<Library | null>(null);

export function LibraryProvider({ children }: { children: ComponentChildren }) {
  const { api } = useApp();
  const { path } = useLocation();
  const topics = useAsync(() => api.listTopics(), []);
  const senders = useAsync(() => api.listSenders(), []);
  const counts = useAsync(() => api.unreadCounts(), []);

  // Reading and starring happen on other pages; bring the numbers up to date on every move.
  const last = useRef(path);
  useEffect(() => {
    if (last.current === path) return;
    last.current = path;
    senders.reload();
    counts.reload();
  }, [path]);

  return <LibraryCtx.Provider value={{ topics, senders, counts }}>{children}</LibraryCtx.Provider>;
}

export function useLibrary(): Library {
  const lib = useContext(LibraryCtx);
  if (!lib) throw new Error("useLibrary outside LibraryProvider");
  return lib;
}
