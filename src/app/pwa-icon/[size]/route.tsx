import { ImageResponse } from "next/og";

// PNG app icons, drawn in code so there are no image files to maintain.
// /pwa-icon/192, /pwa-icon/512, /pwa-icon/180 (Apple) and /pwa-icon/512-maskable.
const VARIANTS: Record<string, { size: number; maskable: boolean }> = {
  "180": { size: 180, maskable: false },
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "512-maskable": { size: 512, maskable: true },
};

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((size) => ({ size }));
}

export async function GET(_req: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const { size: key } = await ctx.params;
  const variant = VARIANTS[key];
  if (!variant) return new Response("Not found", { status: 404 });
  const { size, maskable } = variant;
  // Maskable icons keep the artwork inside the central "safe zone".
  const inner = maskable ? size * 0.6 : size * 0.8;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: maskable ? "#0f766e" : "transparent",
        }}
      >
        <svg width={inner} height={inner} viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" fill="#0f766e" />
          <path d="M9 10h14M9 15h14M9 20h7" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
          <path d="m18.5 21 2 2 3.5-4" stroke="#ffffff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
