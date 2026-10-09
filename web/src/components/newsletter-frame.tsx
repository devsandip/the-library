import { useEffect, useRef } from "preact/hooks";

/**
 * Renders sanitized newsletter HTML in a sandboxed srcdoc iframe. No allow-scripts, so nothing in
 * the email runs; allow-same-origin only lets this component measure the content to size the
 * frame. Always a light card, whatever the app theme: emails are designed for white.
 */
const FRAME_STYLE = `
  html { background: #fff; }
  body { margin: 0; padding: 16px; color: #1d1d1b; font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; overflow-wrap: anywhere; }
  img, table, video { max-width: 100% !important; height: auto !important; }
  table { width: auto !important; }
  pre { white-space: pre-wrap; }
  a { color: #2f5d8a; }
`;

export function wrapNewsletter(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><style>${FRAME_STYLE}</style></head><body>${html}</body></html>`;
}

export function NewsletterFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver | undefined>(undefined);

  const fit = () => {
    const frame = ref.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.documentElement) return;
    // border-box sizing: add the frame's own borders or the content overflows by 2px.
    const borders = frame.offsetHeight - frame.clientHeight;
    frame.style.height = `${doc.documentElement.scrollHeight + borders}px`;
  };

  /** Size to content now, and again whenever the content grows (late images, fonts). */
  const onLoad = () => {
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    fit();
    observer.current?.disconnect();
    if ("ResizeObserver" in window) {
      observer.current = new ResizeObserver(fit);
      observer.current.observe(doc.body);
    }
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit));
  };

  useEffect(() => {
    // srcdoc can finish loading before this runs; the onLoad prop covers the usual case.
    if (ref.current?.contentDocument?.readyState === "complete") onLoad();
    return () => observer.current?.disconnect();
  }, [html]);

  return (
    <iframe
      ref={ref}
      class="newsletter-frame"
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerpolicy="no-referrer"
      srcdoc={wrapNewsletter(html)}
      onLoad={onLoad}
    />
  );
}
