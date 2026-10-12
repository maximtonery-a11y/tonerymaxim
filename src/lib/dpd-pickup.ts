type PickupRecord = Record<string, any>;

function record(value: unknown): PickupRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as PickupRecord;
  if (typeof value === "string" && value.length <= 16_000) {
    try { return record(JSON.parse(value)); } catch { /* Older widgets return an address string. */ }
  }
  return {};
}

function scalar(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function first(sources: PickupRecord[], keys: string[]): string {
  for (const source of sources) {
    for (const key of keys) {
      const value = scalar(source[key]);
      if (value) return value;
    }
  }
  return "";
}

function pointFrom(value: PickupRecord): PickupRecord {
  return record(value.pickupPoint || value.parcelShop || value.point || value);
}

/** DPD's documented result string: "ID, street, postcode city country". */
function resultAddress(value: string): PickupRecord {
  const match = value.match(/^([A-Z]{2}[A-Z0-9-]+),\s*(.+),\s*(\d{3}\s?\d{2})\s+(.+?)\s+([A-Z]{2})$/i);
  return match ? { id: match[1], street: match[2], zip: match[3], city: match[4], country: match[5] } : {};
}

/** Shared by the map, restored checkout selections and Woo order preparation. */
export function normalizeDpdPickup(widgetData: unknown, shippingCode = "dpd_pickup") {
  const root = record(widgetData);
  const point = pointFrom(record(root.dpdWidget || root));
  const raw = pointFrom(record(root.raw || root.raw_result || root.data));
  const rawResult = first([root, point], ["pickupPointResult", "raw_result"]);
  const address = record(point.location?.address || point.address);
  const rawAddress = record(raw.location?.address || raw.address);
  const sources = [root, point, address, raw, rawAddress, resultAddress(rawResult)];

  const id = first(sources, ["pickup_id", "id", "pudoId", "pudo_id", "parcelshop_id", "parcelShopId", "pickupPointId", "pickup_point_id"]);
  const name = first(sources, ["pickup_name", "name", "company", "parcelshop_name", "parcelShopName", "pickupPointName", "title"]) || "DPD Pickup miesto";
  const streetName = first(sources, ["street"]);
  const houseNumber = first(sources, ["houseno", "houseNumber", "propertyNumber"]);
  const streetWithNumber = houseNumber && streetName && streetName !== houseNumber && !streetName.endsWith(` ${houseNumber}`)
    ? `${streetName} ${houseNumber}` : streetName;
  const street = first(sources, ["pickup_address", "addressText", "address", "address1", "parcelshop_address", "pickupPointAddress"]) || streetWithNumber;
  const type = first(sources, ["raw_type", "type", "place", "locationType"]).toLowerCase();
  const coordinates = [record(point.location?.coordinates), record(raw.location?.coordinates), ...sources];
  const codAllowed = point.cod_allowed ?? point.codAllowed ?? point.cod ?? point.paymentOptions?.codAllowed ?? root.cod_allowed ?? null;

  return {
    carrier: "DPD",
    delivery_type: shippingCode === "dpd_box" || type === "locker" ? "box" : "pickup",
    pickup_id: id,
    pickup_name: name,
    pickup_address: street,
    pickup_city: first(sources, ["pickup_city", "city", "town", "municipality"]),
    pickup_zip: first(sources, ["pickup_zip", "zip", "zipCode", "postalCode", "postal_code", "postcode"]),
    pickup_country: (first(sources, ["pickup_country", "country", "countryCode", "country_code"]) || "SK").toUpperCase(),
    pickup_lat: first(coordinates, ["pickup_lat", "lat", "latitude", "gpsLat"]),
    pickup_lng: first(coordinates, ["pickup_lng", "lng", "lon", "longitude", "gpsLng"]),
    cod_allowed: codAllowed === null ? null : String(codAllowed) === "1" || codAllowed === true,
    raw_type: type,
    raw_result: rawResult || JSON.stringify(point),
    selected_at: scalar(root.selected_at) || new Date().toISOString(),
  };
}
