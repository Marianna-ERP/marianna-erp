// ─────────────────────────────────────────────────────────────────────────────
// board.domain.ts — v6.99.55 (BD-1…6, owner ruling 23 Sept)
// THE WEEKLY SHIPMENT BOARD: the dispatcher's spreadsheet as a VIEW over the modules. One row per truck, her 26 columns
// in her six steps, every cell reading from — and writing to — the module that owns it. The board stores nothing.
// ─────────────────────────────────────────────────────────────────────────────

export type Step = 1 | 2 | 3 | 4 | 5 | 6;
export interface BoardCol { key: string; label: string; step: Step; owner: "po" | "so" | "booking" | "unit" | "container" | "shipment" | "inspection" | "invoice"; width?: number; readonly?: boolean; }

export interface BoardRow { id: string; shipment: any; unit: any; legIdx: number; unitIdx: number; po: any; poLines: any[]; so: any; week: { key: string; label: string; monday: string }; cells: Record<string, string>; ready: { steps: Record<number, boolean>; loadable: boolean; closed: boolean }; }

/** BD-4: read her workbook — one tab per week, header row, one row per truck. */
export const HER_HEADERS: Record<string, string> = {
  "Product": "product", "Purchase Price": "purchasePrice", "Sales Price": "salesPrice", "Client": "client", "Foil & stickiers & box": "packaging", "Foil & stickiers & boxes": "packaging", "Foil & stickers & boxes": "packaging",
  "Invoice No": "invoiceNo", "IP": "ip", "ACID": "acid", "Production date/ Controlling person": "controller", "POS": "pos", "POD": "pod", "Supplier name": "supplier",
  "Date of loading": "loadingDate", "Date of unloading": "unloadingDate", "Transport 1/ truck": "truckCarrier", "PLATES": "plates", "Loading place": "loadingPlace", "Driver": "driver",
  "Transport 2/ CTR": "containerCarrier", "Unoading place": "unloadingPlace", "Unloading place": "unloadingPlace", "Time of unloading": "unloadingTime", "Comments": "comments", "Shipping line": "shippingLine", "ETD - ETA": "etdEta",
};
export interface ImportedRow { sheet: string; rowNo: number; cells: Record<string, string>; }
