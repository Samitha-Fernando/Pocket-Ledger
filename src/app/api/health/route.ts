// Used by the desktop launcher to know Pocket Ledger is up (and not some other app on the port).
export function GET() {
  return Response.json({ app: "pocket-ledger", ok: true });
}
