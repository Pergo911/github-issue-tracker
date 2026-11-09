/** The loading state of an Admin screen: a spinner and a catalog message. */
export function Loading({ text }: { text: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-8 text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-border border-t-link motion-reduce:animate-none"
      />
      {text}
    </div>
  );
}
