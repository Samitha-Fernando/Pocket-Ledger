/** Asset classes and their default useful life. Safe to use in the browser. */
export const ASSET_CLASSES = {
  VEHICLES: { label: "Vehicles", lifeMonths: 96 },
  ELECTRONICS: { label: "Electronics & phones", lifeMonths: 36 },
  COMPUTERS: { label: "Computers", lifeMonths: 48 },
  FURNITURE: { label: "Furniture", lifeMonths: 84 },
  OTHER: { label: "Other", lifeMonths: 60 },
} as const;
export type AssetClass = keyof typeof ASSET_CLASSES;

export const STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", SOLD: "Sold", DISPOSED: "Scrapped / given away" };
