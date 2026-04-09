import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // This app uses cookie-based locale selection (no /en or /fa path segments).
  // Redirect locale-prefixed paths to the canonical non-prefixed route.
  if (pathname === "/en" || pathname === "/fa" || pathname.startsWith("/en/") || pathname.startsWith("/fa/")) {
    const locale = pathname.startsWith("/fa") ? "fa" : "en";
    const strippedPath = pathname.replace(/^\/(en|fa)(?=\/|$)/, "") || "/";

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = strippedPath;

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set("aether_locale", locale, {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
    });
    return response;
  }

  const isAdminRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/nodes") ||
    pathname.startsWith("/users") ||
    pathname.startsWith("/subscriptions") ||
    pathname.startsWith("/routing") ||
    pathname.startsWith("/analytics") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/plugins");

  if (isAdminRoute) {
    const token = request.cookies.get("aether_token")?.value;
    if (!token) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.svg|.*\\.jpg).*)",
  ],
};
