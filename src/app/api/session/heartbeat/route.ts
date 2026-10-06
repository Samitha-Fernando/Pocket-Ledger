import { getCurrentSession } from "@/lib/auth/session";

// Called by the browser while the person is active. Reading the session
// refreshes its "last active" time; 401 tells the browser to show the lock screen.
export async function POST() {
  const current = await getCurrentSession();
  if (current.state !== "active") return Response.json({ state: current.state }, { status: 401 });
  return Response.json({ state: "active" });
}
