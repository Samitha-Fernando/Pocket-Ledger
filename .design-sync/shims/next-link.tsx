// Claude Design pages have no Next.js router (and no `process`), so the synced bundle
// swaps next/link for a plain <a>. Wired via .design-sync/tsconfig.json "paths"; the app
// itself still uses the real next/link.
import type { AnchorHTMLAttributes } from "react";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string | { pathname?: string };
  prefetch?: unknown;
  replace?: boolean;
  scroll?: boolean;
};

export default function Link({ href, prefetch: _prefetch, replace: _replace, scroll: _scroll, ...rest }: LinkProps) {
  return <a href={typeof href === "string" ? href : (href.pathname ?? "")} {...rest} />;
}
