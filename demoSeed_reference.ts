// v6.32.0 (R7b-5): demo/standalone seed data moved OUT of src/ so CRA no
// longer bundles it (~50 KB). Kept for reference / manual dev seeding only —
// nothing imports this file.

const STANDALONE_POS = [
  { id: 1, number: "PO-2025-0468", status: "Arrived", loadingDate: "2025-10-10", expectedDeliveryDate: "2025-10-13", buyIncoterm: "EXW", flow: "EXP_DDP_EU", requiresSea: false, supplier: { id: 1, name: "Bialski Owoc", country: "Poland", address: "Wojska Polskiego 6F, 96-230 Biala Rawska" }, destinationLocationId: 21, currency: "PLN", fxRate: 1, items: [{ id: 1, product: "Golden Delicious", origin: "Poland", size: "70-80", quality: "I", qty: 19422, unitPrice: 2.80, packaging: "13 kg loose crate" }], linkedShipments: ["SHP-2025-0107"], linkedLots: ["LOT-2026-0091"] },
  { id: 2, number: "PO-2026-0117", status: "Shipped", loadingDate: "2026-05-20", expectedDeliveryDate: "2026-05-30", buyIncoterm: "EXW", flow: "IMP_EXWS_WH", requiresSea: true, supplier: { id: 3, name: "AgriTrade MA", country: "Morocco", address: "Agadir" }, destinationLocationId: 1, currency: "USD", fxRate: 3.8812, items: [{ id: 1, product: "Papryka Kapia", origin: "Morocco", size: "M", quality: "I", qty: 12000, unitPrice: 1.20, packaging: "5 kg carton" }], linkedShipments: ["SHP-2026-0045"], linkedLots: ["LOT-2026-0086"] },
  { id: 3, number: "PO-2026-0121", status: "Confirmed", loadingDate: "2026-06-02", expectedDeliveryDate: "2026-06-05", buyIncoterm: "DDP", flow: "IMP_DDP_WH", requiresSea: false, supplier: { id: 2, name: "FreshFarm ES", country: "Spain", address: "Valencia" }, destinationLocationId: 1, currency: "EUR", fxRate: 4.2531, items: [{ id: 1, product: "Red Bell Pepper", origin: "Spain", size: "L", quality: "I", qty: 8000, unitPrice: 1.85, packaging: "5 kg carton" }], linkedShipments: [], linkedLots: ["LOT-2026-0100"] },
];

const STANDALONE_LOTS = [
  { id: 1, number: "LOT-2026-0091", product: "Golden Delicious", origin: "Poland", size: "70-80", quality: "I", locationId: 6, physicalKg: 19422, expectedKg: 19500, receivedKg: 19422, status: "Loaded", poRef: "PO-2025-0468", packaging: "13 kg loose crate", costs: [], movements: [] },
  { id: 5, number: "LOT-2026-0086", product: "Papryka Kapia", origin: "Morocco", size: "M", quality: "I", locationId: 1, physicalKg: 2500, expectedKg: 8500, receivedKg: 8500, status: "In Stock", poRef: "PO-2026-0117", packaging: "5 kg carton", costs: [], movements: [] },
  { id: 8, number: "LOT-2026-0100", product: "Red Bell Pepper", origin: "Spain", size: "L", quality: "I", locationId: 4, physicalKg: 0, expectedKg: 8000, receivedKg: 0, status: "Expected", poRef: "PO-2026-0121", packaging: "5 kg carton", costs: [], movements: [] },
];

const STANDALONE_SOS = [
  { id: 4, number: "SO-2026-0102", status: "Confirmed", orderDate: "2026-05-20", deliveryDate: "2026-06-10", sellIncoterm: "DAP", client: { id: 4, name: "Biedronka", country: "Poland", address: "Poznan" }, destinationLocationId: 10, currency: "PLN", fxRate: 1, items: [{ id: 1, product: "Red Bell Pepper", origin: "Spain", size: "L", quality: "I", unit: "Kg", qty: 5000, unitPrice: 8.40, sourceType: "PO", sourceRef: "PO-2026-0121", sourceLineId: 1, packaging: "5 kg carton" }], linkedShipments: [] },
  { id: 5, number: "SO-2026-0105", status: "Booked", orderDate: "2026-05-26", deliveryDate: "2026-06-15", sellIncoterm: "DAP", client: { id: 6, name: "Metro Cash & Carry", country: "Poland", address: "Warszawa" }, destinationLocationId: 13, currency: "PLN", fxRate: 1, items: [{ id: 1, product: "Papryka Kapia", origin: "Morocco", size: "M", quality: "I", unit: "Kg", qty: 12000, unitPrice: 6.20, sourceType: "PO", sourceRef: "PO-2026-0117", sourceLineId: 1, packaging: "5 kg carton" }], linkedShipments: [] },
];

export const INITIAL_ORDERS = [
  {
    id: 1, number: "PO-2025-0468", status: "Arrived",
    orderDate: "2025-10-10", loadingDate: "2025-10-15", expectedDeliveryDate: "2026-05-20", promisedDateMeans: "Arrival at our warehouse", actualAvailabilityDate: "2026-05-20",
    paymentTerms: "30 days from invoice date", paymentTermsOther: "",
    buyIncoterm: "EXW", flow: "EXP_CIF",
    supplier: SUPPLIERS[0],
    destinationLocationId: 6, requiresSea: true,
    currency: "PLN", fxRate: 1, fxLockedAt: "2025-10-10",
    items: [{ id: 1, product: "Golden Delicious", coloration: "przełamany", origin: "Poland", size: "70-80", quality: "I", unit: "Kg", qty: 19422, pallets: 33, unitPrice: 2.80, currency: "PLN", packaging: "13 kg wooden box" }],
    notes: 'Łuszczka na trzy deski "NO NAME" ; górna warstwa dla kalibrów 70/80 na wytłoczce\nFolia "MARIANNA" & sticker "MARIANNA" na górnej wrastwie',
    linkedShipments: ["SHP-2026-0044"],
    linkedLots: ["LOT-2026-0091"],
    linkedInvoices: ["PINV-2026-0021"],
    variance: { expectedKg: 19500, receivedKg: 19422 },
  },
  {
    id: 2, number: "PO-2026-0112", status: "Draft",
    orderDate: "2026-05-20", loadingDate: "2026-05-28", expectedDeliveryDate: "2026-06-02", promisedDateMeans: "Arrival at our warehouse", actualAvailabilityDate: null,
    paymentTerms: "14 days from invoice date", paymentTermsOther: "",
    buyIncoterm: "DDP", flow: "IMP_DDP_WH",
    supplier: SUPPLIERS[1],
    destinationLocationId: 1, requiresSea: false,
    currency: "EUR", fxRate: 4.2531, fxLockedAt: null,
    items: [{ id: 1, product: "Red Bell Pepper", coloration: "", origin: "Spain", size: "L", quality: "I", unit: "Kg", qty: 5000, unitPrice: 1.85, currency: "EUR", packaging: "5 kg carton" }],
    notes: "",
    linkedShipments: [],
    linkedLots: [],
    linkedInvoices: [],
    variance: null,
  },
  {
    id: 3, number: "PO-2026-0118", status: "Arrived",
    orderDate: "2026-04-22", loadingDate: "2026-05-02", expectedDeliveryDate: "2026-05-15", promisedDateMeans: "Arrival at our warehouse", actualAvailabilityDate: "2026-05-15",
    paymentTerms: "Advance payment", paymentTermsOther: "",
    buyIncoterm: "CIF", flow: "IMP_CIF_WH",
    supplier: SUPPLIERS[2],
    destinationLocationId: 1, requiresSea: true,
    currency: "USD", fxRate: 3.8812, fxLockedAt: "2026-04-22",
    items: [{ id: 1, product: "Carrot", coloration: "", origin: "Morocco", size: "L", quality: "I", unit: "Kg", qty: 24000, unitPrice: 0.55, currency: "USD", packaging: "10 kg mesh bag" }],
    notes: "CIF Gdańsk. Supplier handles sea freight, we customs and inland.",
    linkedShipments: ["SHP-2026-0040"],
    linkedLots: ["LOT-2026-0088"],
    linkedInvoices: ["PINV-2026-0024", "LINV-2026-0010", "CINV-2026-0004"],
    variance: { expectedKg: 24000, receivedKg: 23720 },
  },
  {
    id: 4, number: "PO-2026-0117", status: "Shipped",
    orderDate: "2026-05-05", loadingDate: "2026-05-20", expectedDeliveryDate: "2026-05-30", promisedDateMeans: "Arrival at our warehouse", actualAvailabilityDate: "2026-05-30",
    paymentTerms: "Cash against documents", paymentTermsOther: "",
    buyIncoterm: "EXW", flow: "IMP_EXWS_WH",
    supplier: SUPPLIERS[2],
    destinationLocationId: 1, requiresSea: true,
    currency: "USD", fxRate: 3.8812, fxLockedAt: "2026-05-05",
    items: [{ id: 1, product: "Papryka Kapia", coloration: "", origin: "Morocco", size: "M", quality: "I", unit: "Kg", qty: 12000, pallets: 20, unitPrice: 1.20, currency: "USD", packaging: "5 kg carton" }],
    notes: "EXW Agadir. Container at Gdańsk awaiting customs.",
    linkedShipments: ["SHP-2026-0045"],
    linkedLots: ["LOT-2026-0086"],
    linkedInvoices: [],
    variance: null,
  },
  {
    id: 5, number: "PO-2026-0121", status: "Confirmed",
    orderDate: "2026-05-15", loadingDate: "2026-06-02", expectedDeliveryDate: "2026-06-05", promisedDateMeans: "Arrival at our warehouse", actualAvailabilityDate: null,
    paymentTerms: "30 days from invoice date", paymentTermsOther: "",
    buyIncoterm: "DDP", flow: "IMP_DDP_WH",
    supplier: SUPPLIERS[1],
    destinationLocationId: 1, requiresSea: false,
    currency: "EUR", fxRate: 4.2531, fxLockedAt: "2026-05-15",
    items: [{ id: 1, product: "Red Bell Pepper", coloration: "", origin: "Spain", size: "L", quality: "I", unit: "Kg", qty: 8000, unitPrice: 1.85, currency: "EUR", packaging: "5 kg carton" }],
    notes: "DDP delivery to WH-01 Poznań. Pre-sold from PO source to SO-2026-0102.",
    linkedShipments: [],
    linkedLots: ["LOT-2026-0100"],
    linkedInvoices: [],
    variance: null,
  },
];

export const INIT_ORDERS = [
  {
    id: 1, number: "SO-2026-0094", status: "Delivered",
    orderDate: "2026-01-22", deliveryDate: "2026-01-25", promisedDateMeans: "Delivery to client", actualDeliveryDate: "2026-01-25",
    paymentTerms: "14 days from invoice date", paymentTermsOther: "",
    sellIncoterm: "DAP",
    client: CLIENTS[0],            // Biedronka
    destinationLocationId: 10,     // Biedronka DC Poznań
    currency: "PLN", fxRate: 1, fxLockedAt: "2026-01-22",
    items: [
      { id: 1, product: "Golden Delicious", origin: "Poland", size: "70-80", quality: "I", unit: "Kg", qty: 8000, unitPrice: 0.32,
        sourceType: "STOCK", sourceRef: "LOT-2026-0091B", sourceLineId: null, packaging: "13 kg wooden box" },
    ],
    notes: "Standard weekly order — pallet labels per Biedronka spec PL-FRUIT-A4.",
    linkedInvoices: ["FV2026/01/12"], linkedShipments: ["SHP-2026-0042"],
  },
  {
    id: 2, number: "SO-2026-0088", status: "Invoiced",
    orderDate: "2026-01-15", deliveryDate: "2026-01-20", promisedDateMeans: "Delivery to client", actualDeliveryDate: "2026-01-20",
    paymentTerms: "30 days from invoice date", paymentTermsOther: "",
    sellIncoterm: "DAP",
    client: CLIENTS[1],            // Lidl
    destinationLocationId: 11,
    currency: "PLN", fxRate: 1, fxLockedAt: "2026-01-15",
    items: [
      { id: 1, product: "Golden Delicious", origin: "Poland", size: "70-80", quality: "I", unit: "Kg", qty: 2400, unitPrice: 0.33,
        sourceType: "STOCK", sourceRef: "LOT-2026-0091B", sourceLineId: null, packaging: "13 kg wooden box" },
    ],
    notes: "",
    linkedInvoices: ["FV2026/01/08"], linkedShipments: ["SHP-2026-0038"],
  },
  {
    id: 3, number: "SO-2026-0091", status: "Shipped",
    orderDate: "2026-01-26", deliveryDate: "2026-01-29", promisedDateMeans: "Delivery to client", actualDeliveryDate: "2026-01-29",
    paymentTerms: "21 days from invoice date", paymentTermsOther: "",
    sellIncoterm: "EXW",
    client: CLIENTS[4],            // Euro-Papryka
    destinationLocationId: 1,      // EXW — picked up from our WH
    currency: "PLN", fxRate: 1, fxLockedAt: "2026-01-26",
    items: [
      { id: 1, product: "Papryka Kapia", origin: "Jordania", size: "M", quality: "I", unit: "Kg", qty: 6000, unitPrice: 2.10,
        sourceType: "STOCK", sourceRef: "LOT-2026-0086", sourceLineId: null, packaging: "5 kg carton" },
      { id: 2, product: "Yellow Bell Pepper", origin: "Jordania", size: "L", quality: "I", unit: "Kg", qty: 3600, unitPrice: 2.85,
        sourceType: "STOCK", sourceRef: "LOT-2026-0099", sourceLineId: null, packaging: "5 kg carton" },
      { id: 3, product: "Red Bell Pepper", origin: "Jordania", size: "L", quality: "I", unit: "Kg", qty: 1200, unitPrice: 3.15,
        sourceType: "STOCK", sourceRef: "LOT-2026-0095", sourceLineId: null, packaging: "5 kg carton" },
    ],
    notes: "Papryka Kapia / Żółta / Czerwona — EXW Jabłonna · GM 022 · Origin Jordania.",
    linkedInvoices: ["FV2026/01/15"], linkedShipments: [],
  },
  {
    id: 4, number: "SO-2026-0102", status: "Confirmed",
    orderDate: "2026-05-20", deliveryDate: "2026-06-10", promisedDateMeans: "Delivery to client", actualDeliveryDate: null,
    paymentTerms: "30 days from invoice date", paymentTermsOther: "",
    sellIncoterm: "DAP",
    client: CLIENTS[0],            // Biedronka
    destinationLocationId: 10,
    currency: "PLN", fxRate: 1, fxLockedAt: "2026-05-20",
    items: [
      { id: 1, product: "Red Bell Pepper", origin: "Spain", size: "L", quality: "I", unit: "Kg", qty: 5000, unitPrice: 8.40,
        sourceType: "PO", sourceRef: "PO-2026-0121", sourceLineId: 1, packaging: "5 kg carton" },
    ],
    notes: "Pre-sold from PO. Sea-free direct Spain truck delivery week 24.",
    linkedInvoices: [], linkedShipments: [],
  },
  {
    id: 5, number: "SO-2026-0105", status: "Draft",
    orderDate: "2026-05-26", deliveryDate: "2026-06-15", promisedDateMeans: "Delivery to client", actualDeliveryDate: null,
    paymentTerms: "30 days from invoice date", paymentTermsOther: "",
    sellIncoterm: "DAP",
    client: CLIENTS[2],            // Metro
    destinationLocationId: 13,
    currency: "PLN", fxRate: 1, fxLockedAt: null,
    items: [
      { id: 1, product: "Papryka Kapia", origin: "Morocco", size: "M", quality: "I", unit: "Kg", qty: 12000, unitPrice: 6.20,
        sourceType: "PO", sourceRef: "PO-2026-0117", sourceLineId: 1, packaging: "5 kg carton" },
    ],
    notes: "Tied to Moroccan container PO-2026-0117. Confirm only after vessel arrives Gdańsk.",
    linkedInvoices: [], linkedShipments: [],
  },
];

export const INIT_COUNTERPARTIES = [
  {
    id: 1, type: "Supplier", name: "Białski Owoc", country: "Poland",
    address: "ul. Kolejowa 35, 96-230 Biała Rawska",
    nip: "8351595299", vatEuId: "PL8351595299",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Long-term apple supplier — 13kg wooden box format",
    linkedDocs: ["PO-2025-0468"],
    contacts: [
      { id: 1, name: "Aneta Głowala", role: "Sales", email: "aneta@bialskiowoc.pl", phone: "+48 600 111 222", isPrimary: true, notes: "" },
      { id: 2, name: "Krzysztof Bialski", role: "Director", email: "k.bialski@bialskiowoc.pl", phone: "", isPrimary: false, notes: "Decision maker on pricing" },
    ],
  },
  {
    id: 2, type: "Supplier", name: "FreshFarm ES", country: "Spain",
    address: "Calle Major 12, Valencia",
    nip: "B12345678", vatEuId: "ESB12345678",
    defaultCurrency: "EUR", paymentTerms: "14 days from invoice date",
    notes: "Bell peppers — 5kg carton",
    linkedDocs: ["PO-2026-0112"],
    contacts: [
      { id: 1, name: "Carlos Ruiz", role: "Sales", email: "c.ruiz@freshfarmes.com", phone: "+34 961 234 567", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 3, type: "Supplier", name: "AgriTrade MA", country: "Morocco",
    address: "Route de Casablanca, Agadir",
    nip: "MA-200123", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Advance payment",
    notes: "Tomatoes, courgettes — winter season",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Youssef Idrissi", role: "Sales", email: "y.idrissi@agritrade.ma", phone: "", isPrimary: true, notes: "" },
      { id: 2, name: "Fatima El Khattabi", role: "Quality", email: "quality@agritrade.ma", phone: "+212 528 845 100", isPrimary: false, notes: "Phytosanitary docs" },
    ],
  },
  {
    id: 4, type: "Client", name: "Biedronka", country: "Poland",
    address: "ul. Górecka 1, 60-201 Poznań",
    nip: "7792308495", vatEuId: "PL7792308495",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Discount chain — strict delivery windows",
    linkedDocs: ["SO-2026-0094"],
    contacts: [
      { id: 1, name: "Marek Nowak", role: "Buyer", email: "zamowienia@biedronka.pl", phone: "+48 61 850 1000", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 5, type: "Client", name: "Lidl Polska", country: "Poland",
    address: "ul. Świdnicka 12, 41-508 Chorzów",
    nip: "6272685925", vatEuId: "PL6272685925",
    defaultCurrency: "PLN", paymentTerms: "14 days from invoice date",
    notes: "",
    linkedDocs: ["SO-2026-0088"],
    contacts: [
      { id: 1, name: "Anna Wiśniewska", role: "Buyer", email: "fresh@lidl.pl", phone: "+48 32 604 8000", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 6, type: "Client", name: "Metro Cash & Carry", country: "Poland",
    address: "ul. Metrobus 1, 02-274 Warszawa",
    nip: "5210088510", vatEuId: "PL5210088510",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Piotr Zając", role: "Buyer", email: "p.zajac@metro.pl", phone: "", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 7, type: "Client", name: "Fresco Import GmbH", country: "Germany",
    address: "Marktstraße 44, 20357 Hamburg",
    nip: "DE234567890", vatEuId: "DE234567890",
    defaultCurrency: "EUR", paymentTerms: "30 days from invoice date",
    notes: "EU reverse-charge VAT applies",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Klaus Weber", role: "Buyer", email: "orders@fresco-import.de", phone: "+49 40 123 456", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 8, type: "Client", name: '"Euro-Papryka" Paweł Myziak', country: "Poland",
    address: "ul. Piękna 13, 05-555 Tarczyn, Wola Przypkowska",
    nip: "7981158890", vatEuId: "PL7981158890",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "",
    linkedDocs: ["SO-2026-0091"],
    contacts: [
      { id: 1, name: "Paweł Myziak", role: "Director", email: "biuro@euro-papryka.pl", phone: "", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 9, type: "Carrier", name: "Trans-Logistics PL", country: "Poland",
    address: "ul. Transportowa 5, 02-001 Warszawa",
    nip: "5213456789", vatEuId: "PL5213456789",
    defaultCurrency: "PLN", paymentTerms: "14 days from invoice date",
    services: ["Road"],
    notes: "Direct road carrier — domestic & EU trucking",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Tomasz Mazur", role: "Logistics", email: "dispatch@trans-logistics.pl", phone: "+48 22 555 8800", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 10, type: "Carrier", name: "EuroFreight GmbH", country: "Germany",
    address: "Hafenstraße 12, 20359 Hamburg",
    nip: "DE876543210", vatEuId: "DE876543210",
    defaultCurrency: "EUR", paymentTerms: "30 days from invoice date",
    services: ["Road"],
    notes: "German road operator — cross-border PL/DE/BeNeLux",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Lukas Hoffmann", role: "Logistics", email: "ops@eurofreight.de", phone: "+49 40 876 5432", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 15, type: "Forwarder", name: "Raben Logistics PL", country: "Poland",
    address: "ul. Zbożowa 1, 62-023 Gądki",
    nip: "7820210577", vatEuId: "PL7820210577",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    services: ["Road", "Sea", "Customs"],
    notes: "Main forwarder for Gdańsk-routed imports. Books containers + arranges inland trucking + handles customs paperwork.",
    linkedDocs: ["PO-2026-0118"],
    contacts: [
      { id: 1, name: "Joanna Krawczyk", role: "Operations", email: "j.krawczyk@raben.pl", phone: "+48 61 898 5200", isPrimary: true, notes: "Account manager for Marianna" },
      { id: 2, name: "Bartosz Nowak", role: "Sales", email: "b.nowak@raben.pl", phone: "", isPrimary: false, notes: "Sea freight bookings" },
    ],
  },
  {
    id: 16, type: "Forwarder", name: "DSV Solutions Polska", country: "Poland",
    address: "ul. Logistyczna 4, 05-090 Raszyn",
    nip: "5252222333", vatEuId: "PL5252222333",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    services: ["Road", "Sea", "Air", "Customs", "Warehousing"],
    notes: "Multi-modal forwarder — used for Hamburg & Algeciras routes. Also offers transit warehousing.",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Piotr Sobieski", role: "Operations", email: "p.sobieski@dsv.pl", phone: "+48 22 333 4400", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 17, type: "Forwarder", name: "Pekaes SA", country: "Poland",
    address: "ul. Spedycyjna 2, 03-310 Warszawa",
    nip: "5260250289", vatEuId: "PL5260250289",
    defaultCurrency: "PLN", paymentTerms: "14 days from invoice date",
    services: ["Road", "Customs"],
    notes: "Road forwarder — strong on intra-EU routes, also handles export customs",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Robert Adamski", role: "Operations", email: "r.adamski@pekaes.pl", phone: "+48 22 460 3000", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 18, type: "Carrier", name: "MSC Mediterranean Shipping", country: "Switzerland",
    address: "Chemin Rieu 12-14, 1208 Geneva",
    nip: "", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Advance payment",
    services: ["Sea"],
    notes: "Direct shipping line — used occasionally when forwarder doesn't have rates",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "MSC Poland Office", role: "Sales", email: "bookings.pl@msc.com", phone: "+48 58 765 4300", isPrimary: true, notes: "Booking through Gdynia office" },
    ],
  },
  {
    // Multi-role example — same legal entity buys produce from us AND rents us their fleet AND lets us use their cold-storage
    id: 19, type: "Client", additionalTypes: ["Carrier", "Warehouse"],
    name: "Polfrost Logistyka", country: "Poland",
    address: "ul. Mroźna 4, 80-298 Gdańsk",
    nip: "5832914455", vatEuId: "PL5832914455",
    defaultCurrency: "PLN", paymentTerms: "21 days from invoice date",
    services: ["Road", "Warehousing"],
    finance: { bankName: "mBank SA", accountNumber: "PL12 1140 2004 0000 3502 0987 6543", swift: "BREXPLPW" },
    notes: "Wears three hats: buys leftover stock from us at discount, runs reefer trucks we sometimes hire, and rents us pallet positions in their Gdańsk cold store.",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Krzysztof Wiśniewski", role: "Director", email: "k.wisniewski@polfrost.pl", phone: "+48 58 712 4400", isPrimary: true, notes: "Single point of contact across all three relationships" },
      { id: 2, name: "Magdalena Polak", role: "Operations", email: "m.polak@polfrost.pl", phone: "", isPrimary: false, notes: "Day-to-day for warehouse + dispatch" },
    ],
  },
  {
    id: 11, type: "Broker", name: "CustomsPro Sp. z o.o.", country: "Poland",
    address: "ul. Celna 4, 02-100 Warszawa",
    nip: "5252111222", vatEuId: "PL5252111222",
    defaultCurrency: "PLN", paymentTerms: "14 days from invoice date",
    notes: "Customs broker — advances phytosanitary fees (37 PLN/cert)",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Magdalena Kowal", role: "Operations", email: "m.kowal@customspro.pl", phone: "+48 22 633 4500", isPrimary: true, notes: "" },
      { id: 2, name: "Jan Wójcik", role: "Finance", email: "billing@customspro.pl", phone: "", isPrimary: false, notes: "Monthly invoices" },
    ],
  },
  {
    id: 12, type: "Broker", name: "Hartmann Broker", country: "Germany",
    address: "Hafenstraße 8, 20359 Hamburg",
    nip: "DE-9876543", vatEuId: "DE987654321",
    defaultCurrency: "EUR", paymentTerms: "30 days from invoice date",
    notes: "Preferred customs broker for Hamburg port",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Stefan Hartmann", role: "Operations", email: "s.hartmann@hartmann-customs.de", phone: "+49 40 123 456", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 13, type: "Warehouse", name: "WH-01 Poznań (Logipark)", country: "Poland",
    address: "ul. Magazynowa 1, 60-001 Poznań",
    nip: "7779988877", vatEuId: "PL7779988877",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Cold storage — monthly invoice allocated by kg-days",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Roman Lewandowski", role: "Operations", email: "wh01@logipark.pl", phone: "+48 61 800 1234", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 14, type: "Warehouse", name: "WH-02 Warszawa (ColdStore)", country: "Poland",
    address: "ul. Chłodna 50, 00-872 Warszawa",
    nip: "5251122334", vatEuId: "PL5251122334",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Beata Sienkiewicz", role: "Operations", email: "ops@coldstore.pl", phone: "+48 22 887 6543", isPrimary: true, notes: "" },
    ],
  },

  // ─── BASELINE TEST SET (for end-to-end testing of the logistics flow) ──────
  {
    id: 51, type: "Supplier", name: "Owoce Polska Sp. z o.o.", country: "Poland",
    address: "ul. Sadownicza 12, 96-200 Rawa Mazowiecka",
    nip: "8361122334", vatEuId: "PL8361122334",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Baseline test supplier — Polish apples & pears, 13 kg wooden box",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Marek Kowalczyk", role: "Sales", email: "marek@owocepolska.pl", phone: "+48 601 234 567", isPrimary: true, notes: "Primary contact for loadings" },
    ],
  },
  {
    id: 52, type: "Client", name: "Nile Fresh Imports", country: "Egypt",
    address: "14 El Horreya Road, Alexandria",
    nip: "EG-204556789", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Prepaid / TT before shipment",
    notes: "Baseline test client — Egyptian importer, receives at Alexandria Port (CIF)",
    contacts: [
      { id: 1, name: "Ahmed Hassan", role: "Purchasing", email: "ahmed@nilefresh.eg", phone: "+20 100 555 1234", isPrimary: true, notes: "Speaks EN/AR" },
    ],
  },
  {
    id: 53, type: "Carrier", name: "PolTrans Drogowy", country: "Poland",
    address: "ul. Transportowa 8, 02-672 Warszawa",
    nip: "5262233445", vatEuId: "PL5262233445",
    defaultCurrency: "PLN", paymentTerms: "30 days after CMR",
    services: ["Road"],
    notes: "Baseline test road carrier — reefer trucks, PL & EU",
    contacts: [
      { id: 1, name: "Janusz Wójcik", role: "Dispatch", email: "dyspozytor@poltrans.pl", phone: "+48 22 612 3456", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 54, type: "Forwarder", name: "Adriatica Forwarding S.r.l.", country: "Italy",
    address: "Via del Porto 22, 30175 Marghera VE",
    nip: "IT-09887766554", vatEuId: "IT09887766554",
    defaultCurrency: "EUR", paymentTerms: "30 days from invoice date",
    services: ["Sea", "Road", "Customs"],
    notes: "Baseline test forwarder — Italian sea + inland, container bookings",
    contacts: [
      { id: 1, name: "Giulia Ferrari", role: "Operations", email: "g.ferrari@adriatica-fwd.it", phone: "+39 041 555 7788", isPrimary: true, notes: "" },
    ],
  },

  // ── Additional baseline test parties (round 2) ──
  {
    id: 55, type: "Client", name: "Cairo Fresh Trading", country: "Egypt",
    address: "El Obour Market, Cairo",
    nip: "EG-301229988", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Prepaid / TT before shipment",
    notes: "Baseline test client — Cairo wholesaler, receives at Damietta / Port Said",
    contacts: [
      { id: 1, name: "Mostafa Saleh", role: "Purchasing", email: "mostafa@cairofresh.eg", phone: "+20 122 444 7788", isPrimary: true, notes: "EN/AR" },
    ],
  },
  {
    id: 56, type: "Client", name: "Delta Produce Co.", country: "Egypt",
    address: "Industrial Zone, Damietta",
    nip: "EG-302554411", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "CAD — cash against documents",
    notes: "Baseline test client — Damietta importer, reefer containers",
    contacts: [
      { id: 1, name: "Hany Fawzy", role: "Imports", email: "hany@deltaproduce.eg", phone: "+20 100 778 2211", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 57, type: "Supplier", name: "Alex Agro Export", country: "Egypt",
    address: "Agricultural Road, Beheira (Alexandria area)",
    nip: "EG-205667788", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "30% advance, 70% against BL copy",
    notes: "Baseline test supplier — Egyptian citrus & potatoes, ships from Alexandria/Damietta",
    contacts: [
      { id: 1, name: "Tarek El-Sayed", role: "Sales", email: "tarek@alexagro.eg", phone: "+20 111 223 3445", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 58, type: "Supplier", name: "Nile Valley Farms", country: "Egypt",
    address: "Nubaria, Beheira Governorate",
    nip: "EG-206334455", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Prepaid 50% / 50% on loading",
    notes: "Baseline test supplier — Egyptian grapes, onions, oranges",
    contacts: [
      { id: 1, name: "Sherif Ramadan", role: "Export Manager", email: "sherif@nilevalley.eg", phone: "+20 109 556 6778", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 59, type: "Supplier", name: "Sadowniczy Eksport Sp. z o.o.", country: "Poland",
    address: "ul. Grójecka 110, 05-600 Grójec",
    nip: "7972244668", vatEuId: "PL7972244668",
    defaultCurrency: "PLN", paymentTerms: "21 days from invoice date",
    notes: "Baseline test supplier — Polish apples (Grójec region), 13 kg box",
    contacts: [
      { id: 1, name: "Krzysztof Lewandowski", role: "Sales", email: "k.lewandowski@sadowniczy.pl", phone: "+48 605 112 334", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 60, type: "Supplier", name: "Warzywa Polskie S.A.", country: "Poland",
    address: "ul. Ogrodnicza 5, 96-100 Skierniewice",
    nip: "8361177553", vatEuId: "PL8361177553",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Baseline test supplier — Polish vegetables (cabbage, carrots, onions)",
    contacts: [
      { id: 1, name: "Agnieszka Nowak", role: "Sales", email: "a.nowak@warzywapolskie.pl", phone: "+48 601 778 990", isPrimary: true, notes: "" },
    ],
  },
];

export const INIT_LOTS = [
  // EXPORT — apples (CIF) — currently in port transit
  {
    id: 1, number: "LOT-2026-0091", product: "Golden Delicious", quality: "I", size: "70-80", origin: "Poland",
    flow: "EXP_CIF",
    poRef: "PO-2025-0468",
    locationId: 6, // Gdańsk Port
    expectedKg: 19500,
    receivedKg: 19422,      // what came in when received
    physicalKg: 19422,      // still physically present (in port transit, not yet dispatched)
    damagedKg: 0,
    packaging: "13 kg wooden box",
    status: "In Transit",
    arrivalDate: "2026-05-20", productionDate: "2026-05-18",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",         source: "PINV-2026-0021", amount: 54381.60, currency: "PLN", pln: 54381.60 },
      { type: "freight",  label: "Inland freight (LINV)",   source: "LINV-2026-0008", amount: 2400.00,  currency: "PLN", pln: 2400.00 },
      { type: "customs",  label: "Export customs + phyto",  source: "CINV-2026-0003", amount: 187.00,   currency: "PLN", pln: 187.00 },
    ],
    movements: [
      { id: 1, date: "2026-05-19", type: "IN",       qtyKg: 19422, fromId: 3, toId: 3, note: "Loaded at producer, expected 19,500 kg" },
      { id: 2, date: "2026-05-20", type: "TRANSFER", qtyKg: 19422, fromId: 3, toId: 6, note: "Trucked to Gdańsk port" },
    ],
    notes: "EXW producer Białski Owoc. Sold CIF to overseas client. Vessel ETA destination: 2026-06-12.",
  },

  // Apples in our WH — has heavy SO reservations from seed SOs 1 & 2 (Biedronka + Lidl)
  // SO-2026-0094 (Delivered, 8000 kg) and SO-2026-0088 (Invoiced, 2400 kg) — both Shipped+, so they DON'T count vs liveAvailable
  // (their physical departure should have already been recorded via SHIP_OUT movements — see below)
  {
    id: 2, number: "LOT-2026-0091B", product: "Golden Delicious", quality: "I", size: "70-80", origin: "Poland",
    flow: "IMP_DDP_WH",
    poRef: "PO-2025-0470",
    locationId: 1, // WH-01 Poznań
    expectedKg: 22800,
    receivedKg: 22800,
    physicalKg: 12400,  // 22800 received − 8000 (SO-94) − 2400 (SO-88) shipped out = 12400 left physically
    damagedKg: 0,
    packaging: "13 kg wooden box",
    status: "In Stock",
    arrivalDate: "2026-04-28", productionDate: "2026-04-25",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",         source: "PINV-2026-0019", amount: 11400.00, currency: "PLN", pln: 11400.00 },
      { type: "storage",  label: "Storage May 1-26 (alloc)", source: "WINV-2026-0002", amount: 386.00,   currency: "PLN", pln: 386.00 },
    ],
    movements: [
      { id: 1, date: "2026-04-28", type: "IN",       qtyKg: 22800, fromId: 3, toId: 1, note: "DDP delivery from Białski" },
      { id: 2, date: "2026-01-25", type: "SHIP_OUT", qtyKg: 8000,  fromId: 1, toId: 8, note: "Shipped for SO-2026-0094 (Biedronka DC Poznań)" },
      { id: 3, date: "2026-01-20", type: "SHIP_OUT", qtyKg: 2400,  fromId: 1, toId: 9, note: "Shipped for SO-2026-0088 (Lidl DC Chorzów)" },
    ],
    notes: "Apple lot for retailer chains. 12,400 kg still physically present.",
  },

  // Import carrots — In Stock, partially damaged
  {
    id: 3, number: "LOT-2026-0088", product: "Carrot", quality: "I", size: "60-100", origin: "Morocco",
    flow: "IMP_CIF_WH",
    poRef: "PO-2026-0118",
    locationId: 1,
    expectedKg: 24000,
    receivedKg: 23720,
    physicalKg: 23420,  // received 23720 − 300 damaged write-off = 23420 physically
    damagedKg: 300,
    packaging: "10 kg mesh bag",
    status: "In Stock",
    arrivalDate: "2026-05-15", productionDate: "2026-05-05",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",                source: "PINV-2026-0024", amount: 4350.00,  currency: "EUR", pln: 18505.00 },
      { type: "freight",  label: "Port→WH freight (LINV)",         source: "LINV-2026-0010", amount: 1800.00,  currency: "PLN", pln: 1800.00 },
      { type: "customs",  label: "Import duties + VAT + phyto",    source: "CINV-2026-0004", amount: 2310.00,  currency: "PLN", pln: 2310.00 },
      { type: "storage",  label: "Storage May 1-15 (allocated)",   source: "WINV-2026-0002", amount: 142.00,   currency: "PLN", pln: 142.00 },
    ],
    movements: [
      { id: 1, date: "2026-05-14", type: "IN",       qtyKg: 23720, fromId: 5, toId: 6, note: "Arrived Gdańsk port from Morocco" },
      { id: 2, date: "2026-05-15", type: "TRANSFER", qtyKg: 23720, fromId: 6, toId: 1, note: "Customs cleared, trucked to WH-01" },
      { id: 3, date: "2026-05-22", type: "DAMAGE",   qtyKg: 300,   fromId: 1, toId: 1, note: "Quality check — 300 kg molded, write-off" },
    ],
    notes: "Expected 24,000 kg, received 23,720 (−280 kg, 1.2% variance). Will split across 3–4 retailers.",
  },

  // Import tomato — Shipped Out (whole lot delivered direct to Biedronka)
  {
    id: 4, number: "LOT-2026-0089", product: "Tomato Round", quality: "I", size: "M", origin: "Spain",
    flow: "IMP_CIF_DIR",
    poRef: "PO-2026-0120",
    locationId: 8, // Biedronka DC Poznań — direct flow, never our WH
    expectedKg: 18000,
    receivedKg: 17940,
    physicalKg: 0,  // entire lot dispatched direct
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "Shipped Out",
    arrivalDate: "2026-05-23", productionDate: "2026-05-10",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",                source: "PINV-2026-0025", amount: 8400.00,  currency: "EUR", pln: 35820.00 },
      { type: "freight",  label: "Port→client freight (LINV)",     source: "LINV-2026-0012", amount: 1450.00,  currency: "PLN", pln: 1450.00 },
      { type: "customs",  label: "Import customs (CINV)",          source: "CINV-2026-0005", amount: 1620.00,  currency: "PLN", pln: 1620.00 },
    ],
    movements: [
      { id: 1, date: "2026-05-21", type: "IN",       qtyKg: 17940, fromId: 4, toId: 6, note: "Arrived Gdańsk from Spain" },
      { id: 2, date: "2026-05-22", type: "TRANSFER", qtyKg: 17940, fromId: 6, toId: 8, note: "Customs cleared, direct to Biedronka" },
      { id: 3, date: "2026-05-23", type: "SHIP_OUT", qtyKg: 17940, fromId: 8, toId: 8, note: "POD signed at Biedronka DC Poznań" },
    ],
    notes: "Direct flow — never entered our WH. Full container sold to single client.",
  },

  // Papryka Kapia — heavy SO reservations from active SOs
  // SO-2026-0091 (Shipped, 6000 kg) — already departed, doesn't count vs liveAvailable
  // Result: 8500 received − 6000 SHIP_OUT = 2500 physically present, no pre-dispatch reservations → liveAvailable = 2500
  {
    id: 5, number: "LOT-2026-0086", product: "Papryka Kapia", quality: "I", size: "M", origin: "Jordania",
    flow: "IMP_EXWS_WH",
    poRef: "PO-2026-0117",
    locationId: 1, // moved into our WH after customs
    expectedKg: 8500,
    receivedKg: 8500,
    physicalKg: 2500,
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "In Stock",
    arrivalDate: "2026-01-22", productionDate: "2026-01-18",
    costs: [
      { type: "purchase", label: "Purchase EXW (PINV)",            source: "PINV-2026-0008", amount: 8800.00,  currency: "USD", pln: 34155.00 },
      { type: "freight",  label: "Producer→port truck (LINV)",    source: "LINV-2026-0003", amount: 2100.00,  currency: "PLN", pln: 2100.00 },
      { type: "customs",  label: "Import duties + phyto",          source: "CINV-2026-0002", amount: 985.00,   currency: "PLN", pln: 985.00 },
    ],
    movements: [
      { id: 1, date: "2026-01-19", type: "IN",       qtyKg: 8500, fromId: 5, toId: 5, note: "Loaded at producer Agadir (EXW)" },
      { id: 2, date: "2026-01-20", type: "TRANSFER", qtyKg: 8500, fromId: 5, toId: 6, note: "Arrived Gdańsk" },
      { id: 3, date: "2026-01-22", type: "TRANSFER", qtyKg: 8500, fromId: 6, toId: 1, note: "Customs cleared, trucked to WH-01" },
      { id: 4, date: "2026-01-29", type: "SHIP_OUT", qtyKg: 6000, fromId: 1, toId: 14, note: "Shipped for SO-2026-0091 (Euro-Papryka)" },
    ],
    notes: "Origin Jordania. 2,500 kg still physically present in WH-01.",
  },

  // Red Bell Pepper — small remainder, post-shipout to Euro-Papryka
  {
    id: 6, number: "LOT-2026-0095", product: "Red Bell Pepper", quality: "I", size: "L", origin: "Jordania",
    flow: "IMP_DDP_WH",
    poRef: "PO-2026-0115",
    locationId: 2, // WH-02 Warszawa
    expectedKg: 2300,
    receivedKg: 2300,
    physicalKg: 1100,  // 2300 − 1200 (SO-91) shipped = 1100
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "In Stock",
    arrivalDate: "2026-01-26", productionDate: "2026-01-22",
    costs: [
      { type: "purchase", label: "Purchase DDP (PINV)",            source: "PINV-2026-0007", amount: 9250.00,  currency: "EUR", pln: 39341.18 },
    ],
    movements: [
      { id: 1, date: "2026-01-26", type: "IN",       qtyKg: 2300, fromId: 4, toId: 2, note: "DDP delivery from FreshFarm ES" },
      { id: 2, date: "2026-01-29", type: "SHIP_OUT", qtyKg: 1200, fromId: 2, toId: 14, note: "Shipped for SO-2026-0091 (Euro-Papryka)" },
    ],
    notes: "1,100 kg remaining for further allocation.",
  },

  // Yellow Bell Pepper — small remainder after Euro-Papryka
  {
    id: 7, number: "LOT-2026-0099", product: "Yellow Bell Pepper", quality: "I", size: "L", origin: "Jordania",
    flow: "IMP_DDP_WH",
    poRef: "PO-2026-0116",
    locationId: 2,
    expectedKg: 4200,
    receivedKg: 4200,
    physicalKg: 600,  // 4200 − 3600 (SO-91) = 600
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "In Stock",
    arrivalDate: "2026-01-26", productionDate: "2026-01-22",
    costs: [
      { type: "purchase", label: "Purchase DDP (PINV)",            source: "PINV-2026-0006", amount: 12000.00, currency: "EUR", pln: 51037.20 },
    ],
    movements: [
      { id: 1, date: "2026-01-26", type: "IN",       qtyKg: 4200, fromId: 4, toId: 2, note: "DDP delivery from FreshFarm ES" },
      { id: 2, date: "2026-01-29", type: "SHIP_OUT", qtyKg: 3600, fromId: 2, toId: 14, note: "Shipped for SO-2026-0091 (Euro-Papryka)" },
    ],
    notes: "600 kg remaining.",
  },

  // Expected lot (just-confirmed PO, not yet shipped)
  {
    id: 8, number: "LOT-2026-0100", product: "Red Bell Pepper", quality: "I", size: "L", origin: "Spain",
    flow: "IMP_DDP_WH",
    poRef: "PO-2026-0121",
    locationId: 4,
    expectedKg: 8000,
    receivedKg: 0,
    physicalKg: 0,
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "Expected",
    arrivalDate: "2026-06-05", productionDate: null,
    costs: [
      { type: "purchase", label: "Purchase DDP (PINV — expected)", source: "PO-2026-0121", amount: 14800.00, currency: "EUR", pln: 62945.88 },
    ],
    movements: [],
    notes: "PO confirmed, supplier loading week of 2026-06-02. Expected DDP arrival 2026-06-05.",
  },
];

export const INIT_SHIPMENTS = [
  {
    id: 1,
    number: "SHP-2025-0107",
    transportOrderNo: "07/10/2025.1",
    mode: "Road",
    purpose: "PO_EXPORT",
    status: "Confirmed",
    poRefs: ["PO-2025-0468"],
    soRefs: [],
    lotRefs: ["LOT-2026-0091"],
    carrierId: 1001,
    forwarderId: null,
    brokerId: 22,
    vehicleCount: 1,
    costResponsibility: "Marianna",
    loadingDate: "2025-10-10",
    expectedDeliveryDate: "2025-10-13",
    actualLoadingDate: null,
    actualDeliveryDate: null,
    originLocationId: 3,
    destinationLocationId: 21,
    customsClearance: "AM sped s.c., Slomczyn 81, 05-600 Grojec",
    temperatureMinC: 2,
    temperatureMaxC: 4,
    confirmationStatus: "Generated",
    confirmationSentAt: null,
    billingStatus: "Not ready",
    notes: "Facsimile road order: Biala Rawska -> Venice Cold Stores. Clean reefer trailer required.",
    legs: [
      { id: 1, mode: "Road", status: "Confirmed", fromLocationId: 3, toLocationId: 21, carrierId: 1001, plannedPickupDate: "2025-10-10", plannedDeliveryDate: "2025-10-13T09:00", vehiclePlate: "", trailerPlate: "", driverName: "", driverPhone: "", temperatureMinC: 2, temperatureMaxC: 4, costAmount: 1700, costCurrency: "EUR", costFxRate: 4.25, costPLN: 7225, notes: "One refrigerated truck. Delivery by 09:00." },
    ],
    goods: [
      { id: 1, poRef: "PO-2025-0468", soRef: "", lotRef: "LOT-2026-0091", product: "Jablko", origin: "Poland", quality: "I", size: "70-80", packaging: "13 kg loose crate", qtyKg: 19422, grossKg: 22500, pallets: 21, description: "21 pallets: 20 x 1200x1000 + 1 x 1200x800" },
    ],
    costs: [
      { id: 1, type: "road_freight", supplierId: 1001, amount: 1700, currency: "EUR", fxRate: 4.25, amountPLN: 7225, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "Freight from facsimile" },
    ],
    documents: [
      { id: 1, type: "Transport order", ref: "07/10/2025.1", status: "Generated", date: "2025-10-07", notes: "Based on carrier order template" },
      { id: 2, type: "CMR", ref: "", status: "Required", date: "", notes: "Original confirmed CMR required for payment" },
      { id: 3, type: "OCP policy", ref: "", status: "Required", date: "", notes: "Carrier insurance" },
    ],
    terms: STANDARD_ROAD_TERMS,
  },
  {
    id: 2,
    number: "SHP-2026-0045",
    transportOrderNo: "SHP-2026-0045",
    mode: "Multimodal",
    purpose: "PO_IMPORT",
    status: "Loaded",
    poRefs: ["PO-2026-0117"],
    soRefs: ["SO-2026-0105"],
    lotRefs: ["LOT-2026-0086"],
    carrierId: null,
    forwarderId: 15,
    brokerId: 11,
    vehicleCount: 1,
    costResponsibility: "Marianna",
    loadingDate: "2026-05-20",
    expectedDeliveryDate: "2026-05-30",
    actualLoadingDate: "2026-05-20",
    actualDeliveryDate: null,
    originLocationId: 5,
    destinationLocationId: 1,
    customsClearance: "CustomsPro / Gdansk",
    temperatureMinC: 5,
    temperatureMaxC: 8,
    confirmationStatus: "Sent",
    confirmationSentAt: "2026-05-18T09:30:00",
    billingStatus: "Not ready",
    notes: "EXW Morocco. Forwarder combines container and inland handling. BL and container captured after sailing.",
    legs: [
      { id: 1, mode: "Road", status: "Delivered", fromLocationId: 5, toLocationId: 23, carrierId: 9, plannedPickupDate: "2026-05-20", plannedDeliveryDate: "2026-05-20", actualPickupDate: "2026-05-20", actualDeliveryDate: "2026-05-20", vehiclePlate: "MA-74231", trailerPlate: "MA-RF-108", driverName: "Youssef A.", driverPhone: "+212 600 000 111", temperatureMinC: 5, temperatureMaxC: 8, costAmount: 2100, costCurrency: "PLN", costFxRate: 1, costPLN: 2100, notes: "Producer to port warehouse" },
      { id: 2, mode: "Sea", status: "Loaded", fromLocationId: 23, toLocationId: 6, forwarderId: 15, plannedPickupDate: "2026-05-22", plannedDeliveryDate: "2026-05-30", containerNumber: "MSCU1234567", sealNumber: "SL998877", bookingNumber: "RAB-AGD-0522", blNumber: "BL-MA-2026-7781", shippingLine: "MSC", costAmount: 1850, costCurrency: "USD", costFxRate: 3.8812, costPLN: 7180.22, notes: "Container leg to Gdansk" },
      { id: 3, mode: "Road", status: "Planned", fromLocationId: 6, toLocationId: 1, carrierId: 9, plannedPickupDate: "2026-05-30", plannedDeliveryDate: "2026-05-30", vehiclePlate: "", trailerPlate: "", driverName: "", driverPhone: "", temperatureMinC: 5, temperatureMaxC: 8, costAmount: 1450, costCurrency: "PLN", costFxRate: 1, costPLN: 1450, notes: "Port to WH-01 after customs" },
    ],
    goods: [
      { id: 1, poRef: "PO-2026-0117", soRef: "SO-2026-0105", lotRef: "LOT-2026-0086", product: "Papryka Kapia", origin: "Morocco", quality: "I", size: "M", packaging: "5 kg carton", qtyKg: 12000, grossKg: 12800, pallets: 20, description: "Moroccan pepper, reefer container" },
    ],
    costs: [
      { id: 1, type: "pre_carriage", supplierId: 9, amount: 2100, currency: "PLN", fxRate: 1, amountPLN: 2100, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "Supplier to port (road carrier)" },
      { id: 2, type: "sea_freight", supplierId: 15, amount: 1850, currency: "USD", fxRate: 3.8812, amountPLN: 7180.22, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "Sea leg" },
      { id: 3, type: "customs", supplierId: 11, amount: 985, currency: "PLN", fxRate: 1, amountPLN: 985, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "Import duties / phyto expected" },
    ],
    documents: [
      { id: 1, type: "Booking", ref: "RAB-AGD-0522", status: "Received", date: "2026-05-18", notes: "Forwarder booking" },
      { id: 2, type: "Container", ref: "MSCU1234567 / SL998877", status: "Received", date: "2026-05-22", notes: "Container and seal" },
      { id: 3, type: "BL", ref: "BL-MA-2026-7781", status: "Received", date: "2026-05-23", notes: "Bill of lading" },
    ],
    terms: STANDARD_ROAD_TERMS,
  },
  {
    id: 3,
    number: "SHP-2026-0060",
    transportOrderNo: "SHP-2026-0060",
    mode: "Road",
    purpose: "SO_DELIVERY",
    status: "Booked",
    poRefs: ["PO-2026-0121"],
    soRefs: ["SO-2026-0102"],
    lotRefs: ["LOT-2026-0100"],
    carrierId: 17,
    forwarderId: null,
    brokerId: null,
    vehicleCount: 1,
    costResponsibility: "Marianna",
    loadingDate: "2026-06-05",
    expectedDeliveryDate: "2026-06-10",
    actualLoadingDate: null,
    actualDeliveryDate: null,
    originLocationId: 1,
    destinationLocationId: 10,
    customsClearance: "Not required - EU road",
    temperatureMinC: 6,
    temperatureMaxC: 8,
    confirmationStatus: "Not sent",
    confirmationSentAt: null,
    billingStatus: "Not ready",
    notes: "Delivery from Spanish PO to Biedronka after arrival. Use once stock/lot is available.",
    legs: [
      { id: 1, mode: "Road", status: "Booked", fromLocationId: 1, toLocationId: 10, carrierId: 17, plannedPickupDate: "2026-06-05", plannedDeliveryDate: "2026-06-10", vehiclePlate: "", trailerPlate: "", driverName: "", driverPhone: "", temperatureMinC: 6, temperatureMaxC: 8, costAmount: 1450, costCurrency: "PLN", costFxRate: 1, costPLN: 1450, notes: "WH-01 to Biedronka" },
    ],
    goods: [
      { id: 1, poRef: "PO-2026-0121", soRef: "SO-2026-0102", lotRef: "LOT-2026-0100", product: "Red Bell Pepper", origin: "Spain", quality: "I", size: "L", packaging: "5 kg carton", qtyKg: 5000, grossKg: 5400, pallets: 10, description: "Sales delivery for Biedronka" },
    ],
    costs: [
      { id: 1, type: "road_freight", supplierId: 17, amount: 1450, currency: "PLN", fxRate: 1, amountPLN: 1450, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "Agreed road freight" },
    ],
    documents: [
      { id: 1, type: "Transport order", ref: "", status: "Required", date: "", notes: "Generate and send to carrier" },
      { id: 2, type: "CMR", ref: "", status: "Required", date: "", notes: "Required for billing" },
    ],
    terms: STANDARD_ROAD_TERMS,
  },

  {
    id: 4,
    number: "SHP-2026-0070",
    transportOrderNo: "SHP-2026-0070",
    mode: "Multimodal",
    purpose: "PO_IMPORT",
    status: "Arrived",
    poRefs: ["PO-2026-0130"],
    soRefs: [],
    lotRefs: ["LOT-2026-0108"],
    carrierId: 17,
    forwarderId: 16,
    brokerId: 11,
    vehicleCount: 9,
    costResponsibility: "Marianna",
    loadingDate: "2026-06-12",
    expectedDeliveryDate: "2026-07-03",
    actualLoadingDate: "2026-06-12",
    actualDeliveryDate: null,
    originLocationId: 23,
    destinationLocationId: 1,
    customsClearance: "CustomsPro Sp. z o.o. - Gdansk port clearance",
    temperatureMinC: 7,
    temperatureMaxC: 10,
    confirmationStatus: "Sent",
    confirmationSentAt: "2026-06-10T09:30:00.000Z",
    billingStatus: "Ready for supplier invoice",
    notes: "Scenario for multiple transport units: 4 sea containers of potatoes arrive at Gdansk port, then the same cargo is split over 5 road trucks due to EU road weight limits.",
    legs: [
      {
        id: 1,
        mode: "Sea",
        status: "Arrived",
        fromLocationId: 23,
        toLocationId: 6,
        forwarderId: 16,
        plannedPickupDate: "2026-06-12",
        plannedDeliveryDate: "2026-07-01",
        costAmount: 7200,
        costCurrency: "USD",
        costFxRate: 3.9,
        costPLN: 28080,
        notes: "Four reefer containers Morocco -> Gdansk",
        vehicles: [
          { id: 1, mode: "Sea", qtyKg: 27000, pallets: 0, containerNumber: "DSVU2400011", sealNumber: "SL240001", bookingNumber: "DSV-POT-2400", blNumber: "BL-POT-2400-1", shippingLine: "MSC", notes: "Container 1/4" },
          { id: 2, mode: "Sea", qtyKg: 27000, pallets: 0, containerNumber: "DSVU2400012", sealNumber: "SL240002", bookingNumber: "DSV-POT-2400", blNumber: "BL-POT-2400-1", shippingLine: "MSC", notes: "Container 2/4" },
          { id: 3, mode: "Sea", qtyKg: 27000, pallets: 0, containerNumber: "DSVU2400013", sealNumber: "SL240003", bookingNumber: "DSV-POT-2400", blNumber: "BL-POT-2400-1", shippingLine: "MSC", notes: "Container 3/4" },
          { id: 4, mode: "Sea", qtyKg: 27000, pallets: 0, containerNumber: "DSVU2400014", sealNumber: "SL240004", bookingNumber: "DSV-POT-2400", blNumber: "BL-POT-2400-1", shippingLine: "MSC", notes: "Container 4/4" },
        ],
      },
      {
        id: 2,
        mode: "Road",
        status: "Booked",
        fromLocationId: 6,
        toLocationId: 1,
        carrierId: 17,
        plannedPickupDate: "2026-07-02",
        plannedDeliveryDate: "2026-07-03",
        temperatureMinC: 7,
        temperatureMaxC: 10,
        costAmount: 5900,
        costCurrency: "PLN",
        costFxRate: 1,
        costPLN: 5900,
        notes: "Five truck split from port to WH-01 due to weight limits",
        vehicles: [
          { id: 11, mode: "Road", qtyKg: 21600, pallets: 18, truckPlate: "WX 2401A", trailerPlate: "WX 2401T", driverName: "Driver 1", driverPhone: "+48 500 000 001", notes: "Truck 1/5" },
          { id: 12, mode: "Road", qtyKg: 21600, pallets: 18, truckPlate: "WX 2402A", trailerPlate: "WX 2402T", driverName: "Driver 2", driverPhone: "+48 500 000 002", notes: "Truck 2/5" },
          { id: 13, mode: "Road", qtyKg: 21600, pallets: 18, truckPlate: "WX 2403A", trailerPlate: "WX 2403T", driverName: "Driver 3", driverPhone: "+48 500 000 003", notes: "Truck 3/5" },
          { id: 14, mode: "Road", qtyKg: 21600, pallets: 18, truckPlate: "WX 2404A", trailerPlate: "WX 2404T", driverName: "Driver 4", driverPhone: "+48 500 000 004", notes: "Truck 4/5" },
          { id: 15, mode: "Road", qtyKg: 21600, pallets: 18, truckPlate: "WX 2405A", trailerPlate: "WX 2405T", driverName: "Driver 5", driverPhone: "+48 500 000 005", notes: "Truck 5/5" },
        ],
      },
    ],
    goods: [
      { id: 1, poRef: "PO-2026-0130", soRef: "", lotRef: "LOT-2026-0108", product: "Potato", origin: "Morocco", quality: "I", size: "50+", packaging: "25 kg bags", qtyKg: 108000, grossKg: 111000, pallets: 90, description: "4 containers split into 5 EU-compliant road trucks" },
    ],
    costs: [
      { id: 1, type: "sea_freight", supplierId: 16, amount: 7200, currency: "USD", fxRate: 3.9, amountPLN: 28080, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "Sea freight for 4 containers" },
      { id: 2, type: "on_carriage", supplierId: 17, amount: 5900, currency: "PLN", fxRate: 1, amountPLN: 5900, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "5 trucks from Gdansk port to WH-01" },
      { id: 3, type: "customs", supplierId: 11, amount: 980, currency: "PLN", fxRate: 1, amountPLN: 980, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "Customs documents" },
    ],
    documents: [
      { id: 1, type: "Transport order", ref: "SHP-2026-0070", status: "Sent", date: "2026-06-10", notes: "Bilingual order sent to forwarder/carrier" },
      { id: 2, type: "BL", ref: "BL-POT-2400-1", status: "Received", date: "2026-06-13", notes: "One BL covering four containers" },
      { id: 3, type: "CMR", ref: "", status: "Required", date: "", notes: "Five CMRs expected, one per road truck" },
    ],
    terms: STANDARD_ROAD_TERMS,
  },

];

