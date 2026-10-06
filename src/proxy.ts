import { NextResponse, type NextRequest } from "next/server";

// Quick first check: no session cookie means "not signed in", so go to the
// sign-in flow. The real checks (valid session, not locked, own data only)
// happen on the server in every page and action via requireUser().

const PUBLIC_PATHS = ["/login", "/setup", "/register", "/lock", "/switch"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (!request.cookies.has("pl_session")) {
    const target = request.cookies.has("pl_device") ? "/switch" : "/login";
    return NextResponse.redirect(new URL(target, request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Skip API routes, Next.js internals and public files (icons, manifest, service worker).
  matcher: ["/((?!api|_next/static|_next/image|pwa-icon|manifest.webmanifest|sw.js|offline.html|icon.svg|favicon.ico).*)"],
};
