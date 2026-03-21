import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PROTECTED_PATHS = ["/dashboard", "/profile", "/settings"];
const PROTECTED_API_PATHS = ["/api/settings"];
const ADMIN_API_PATHS = ["/api/seed", "/api/ingestion"];
const AUTH_PATHS = ["/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  // Redirect authenticated users away from login
  if (AUTH_PATHS.some((p) => pathname.startsWith(p)) && sessionCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Redirect unauthenticated users to login for protected routes
  if (PROTECTED_PATHS.some((p) => pathname.startsWith(p)) && !sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Block unauthenticated access to protected and admin API routes (optimistic
  // cookie check; actual role validation happens in route handlers)
  if ([...PROTECTED_API_PATHS, ...ADMIN_API_PATHS].some((p) => pathname.startsWith(p)) && !sessionCookie) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/login",
    "/api/settings/:path*",
    "/api/seed/:path*",
    "/api/ingestion/:path*",
  ],
};
