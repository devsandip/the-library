import { useRoute } from "preact-iso";
import { IssueReader } from "../components/issue-reader.js";
import { useMedia, WIDE } from "../media.js";

export function Issue() {
  const { params } = useRoute();
  const wide = useMedia(WIDE);
  return <IssueReader id={params.id ?? ""} wide={wide} standalone />;
}
