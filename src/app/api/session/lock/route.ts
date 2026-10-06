import { lockCurrentSession } from "@/lib/auth/session";

// Called by the browser's inactivity timer.
export async function POST() {
  await lockCurrentSession();
  return Response.json({ state: "locked" });
}
