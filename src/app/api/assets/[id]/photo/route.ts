import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { scopedDb } from "@/lib/db/scoped";
import { readPhoto } from "@/lib/uploads";

// Serves an asset photo, only to the signed-in owner of that asset.
export async function GET(_req: Request, ctx: RouteContext<"/api/assets/[id]/photo">) {
  const current = await getCurrentSession();
  if (current.state !== "active") return new Response("Not signed in", { status: 401 });

  const { id } = await ctx.params;
  const asset = await scopedDb(prisma, current.user.id).fixedAsset.findUnique({ where: { id } });
  const photo = asset?.photoPath ? await readPhoto(asset.photoPath) : null;
  if (!photo) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      // Not cached: on a shared computer another user must never see it from cache.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
