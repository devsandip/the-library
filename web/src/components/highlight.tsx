import { highlightRuns } from "@library/core/search";

/** A text with the words a search matched marked (#53), by the API's own word rules. */
export function Highlight({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms?.length) return <>{text}</>;
  return (
    <>
      {highlightRuns(text, terms).map((run, i) =>
        run.hit ? <mark key={i}>{run.text}</mark> : run.text,
      )}
    </>
  );
}
