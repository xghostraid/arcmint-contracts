import { getPicture } from "./db.js";
import { IMAGE_URL_MAX_BYTES } from "./picture.js";
import { publicStatus } from "./status.js";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PICTURE_ID = /^pic_[a-f0-9]{16}$/;

export const QUOTE_KEYS = Object.freeze([
  "canPay",
  "launchesOn",
  "paused",
  "userPercent",
  "recipientPercent",
  "holderBalance",
  "houseToken",
  "picturePresent",
  "pictureSource",
  "pictureId",
  "imageUrl",
  "launchesLeftToday",
  "launchesLeftThisHour",
  "name",
  "ticker",
  "description",
  "x",
  "website",
  "wallet",
  "issues",
]);

function rawText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function httpsUrl(value) {
  if (!value || String(value).length > 2000) return null;
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function buildQuote(db, raw = {}, now = new Date()) {
  const args = raw && typeof raw === "object" ? raw : {};
  const issues = [];
  const nameRaw = rawText(args.name);
  const tickerRaw = rawText(args.ticker);
  const descriptionRaw = rawText(args.description);
  const walletRaw = rawText(args.wallet);
  const xRaw = rawText(args.x);
  const websiteRaw = rawText(args.website);
  const pictureIdRaw = rawText(args.picture_id);
  const imageRaw = rawText(args.image_url);

  const name = nameRaw && nameRaw.length <= 32 ? nameRaw : null;
  if (nameRaw && nameRaw.length > 32) issues.push({ field: "name", error: "size" });

  const ticker = tickerRaw && /^[A-Za-z0-9]{1,10}$/.test(tickerRaw) ? tickerRaw : null;
  if (tickerRaw && tickerRaw.length > 10) issues.push({ field: "ticker", error: "size" });
  else if (tickerRaw && !ticker) issues.push({ field: "ticker", error: "format" });

  const description = descriptionRaw && descriptionRaw.length <= 400 ? descriptionRaw : null;
  if (descriptionRaw && descriptionRaw.length > 400) issues.push({ field: "description", error: "size" });

  let wallet = null;
  if (walletRaw) {
    if (walletRaw.length > 44 || walletRaw.length < 32 || !BASE58.test(walletRaw)) {
      issues.push({ field: "wallet", error: "format" });
    } else wallet = walletRaw;
  }

  let x = null;
  if (xRaw) {
    const url = httpsUrl(xRaw);
    if (!url) issues.push({ field: "x", error: "format" });
    else {
      const host = new URL(url).hostname;
      if (!/^(www\.)?(x|twitter)\.com$/.test(host)) issues.push({ field: "x", error: "format" });
      else x = url;
    }
  }

  let website = null;
  if (websiteRaw) {
    website = httpsUrl(websiteRaw);
    if (!website) issues.push({ field: "website", error: "format" });
  }

  let pictureId = null;
  if (pictureIdRaw) {
    if (!PICTURE_ID.test(pictureIdRaw) || !getPicture(db, pictureIdRaw, now)) {
      issues.push({ field: "picture_id", error: "missing" });
    } else {
      pictureId = pictureIdRaw;
    }
  }

  let imageUrl = null;
  if (imageRaw) {
    imageUrl = httpsUrl(imageRaw);
    if (!imageUrl) issues.push({ field: "image_url", error: "format" });
  }

  const picturePresent = Boolean(pictureId || imageUrl);
  const pictureSource = pictureId ? "picture_id" : imageUrl ? "image_url" : null;
  const status = publicStatus(db, now);

  return {
    canPay: false,
    launchesOn: false,
    paused: true,
    userPercent: 50,
    recipientPercent: 50,
    holderBalance: null,
    houseToken: false,
    picturePresent,
    pictureSource,
    pictureId,
    imageUrl,
    launchesLeftToday: status.launchesLeftToday,
    launchesLeftThisHour: status.launchesLeftThisHour,
    name,
    ticker,
    description,
    x,
    website,
    wallet,
    issues,
  };
}

export function quoteText(quote) {
  const picture = quote.picturePresent
    ? (quote.pictureSource === "image_url"
      ? "The picture is the image_url, so this works without the card."
      : `The picture is ${quote.pictureId}.`)
    : "No picture yet. If the card does not render, pass an image_url.";
  return [
    "Launches are paused. Creator fees lock 50% to the named wallet and 50% to the published recipient. There is no house token.",
    picture,
    `A direct image URL may be up to ${IMAGE_URL_MAX_BYTES} bytes.`,
    JSON.stringify(quote),
  ].join("\n");
}

export function panelText(quote) {
  const lead = quote.imageUrl
    ? "image_url is set, so open_picture_panel works without the iframe."
    : "The draft card is open. If this host does not show the iframe, ask for a direct https image URL up to 15 MB and pass it as image_url. Do not invent a picture_id.";
  return `${lead}\n${quoteText(quote)}`;
}
