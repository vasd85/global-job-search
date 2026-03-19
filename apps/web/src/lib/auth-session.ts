import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Get the current session in a server component or server action.
 * Returns null if no valid session exists.
 */
export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

/**
 * Get the current session, redirecting to /login if unauthenticated.
 * Use in server components that require authentication.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * Require admin role, redirecting to / if not admin.
 * Use in server components that require admin access.
 */
export async function requireAdmin() {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    redirect("/");
  }
  return session;
}
