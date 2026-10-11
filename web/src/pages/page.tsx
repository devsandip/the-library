import type { ComponentChildren } from "preact";
import { useLocation } from "preact-iso";
import type { IssueListItem } from "@library/core/types";
import { goBack } from "../nav.js";
import { issueHref, libraryHref, queueHref } from "../paths.js";

/**
 * A Library page (Search, History, Newsletters, Status, Settings), on either device: on the phone
 * a way back to Library and the screen title; on the Mac, a column under the console's top bar.
 */
export function Page({
  title,
  back = "Library",
  backTo = libraryHref(),
  sub,
  wide,
  children,
  class: cls = "",
}: {
  title: ComponentChildren;
  back?: string;
  backTo?: string;
  sub?: ComponentChildren;
  wide: boolean;
  children: ComponentChildren;
  class?: string;
}) {
  const { route } = useLocation();
  return (
    <section class={`lib-page${wide ? " wide" : ""} ${cls}`}>
      {!wide && (
        <div class="top-bar">
          <button type="button" class="back" onClick={() => goBack(route, backTo)}>
            ‹ {back}
          </button>
        </div>
      )}
      <h1 class="page-title">{title}</h1>
      {sub && <p class="page-sub label">{sub}</p>}
      {children}
    </section>
  );
}

/** Where an issue opens from a Library page: the reader on the phone, the console on the Mac. */
export const openHref = (wide: boolean) => (i: IssueListItem) =>
  wide ? queueHref(i.shelf === "learning" ? "learning" : "news", undefined, i.id) : issueHref(i.id);
