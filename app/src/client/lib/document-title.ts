import { useEffect } from "react";

/** Sets the browser tab's title for as long as the calling component is mounted. Parts are joined with an en dash. */
export function useDocumentTitle(...parts: string[]): void {
  const title = parts.join(" – ");
  useEffect(() => {
    document.title = title;
  }, [title]);
}
