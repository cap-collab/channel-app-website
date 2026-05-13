/**
 * One-shot scraper for VPN Radio (virtualpublic.net) show pages.
 *
 * Trick: VPN's user-facing URL https://www.virtualpublic.net/<slug> renders an empty
 * shell — Squarespace's SPA router replaces the content client-side. But the SAME
 * Squarespace site serves the FULL pre-rendered HTML at /<slug>/index. We fetch that.
 *
 * Usage: npx tsx scripts/scrape-vpn.ts
 * Output: scripts/output/vpn-raw.json
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SHOW_SLUGS = [
  "suite-serenade",
  "soft-terrain",
  "surrealchemistry",
  "jes-grew",
  "etc-radio",
  "love-affair-radio",
  "palm-reader",
  "room-service",
  "cathedral-cove",
];

interface ScrapedShow {
  showUrl: string;
  iframeUrl: string;
  showName: string | null;
  djName: string | null;
  recurrenceText: string | null;
  bio: string | null;
  photoUrl: string | null;
  socials: { instagram: string | null; soundcloud: string | null };
  rawBodyText: string;
}

function stripHtml(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  // decode common entities
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function extractMeta(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  return m ? m[1] : null;
}

async function scrapeOne(slug: string): Promise<ScrapedShow> {
  const iframeUrl = `https://www.virtualpublic.net/${slug}/index`;
  const showUrl = `https://www.virtualpublic.net/${slug}`;

  const response = await fetch(iframeUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${iframeUrl}`);
  }
  const html = await response.text();

  // Extract og:image
  const photoUrl = extractMeta(html, "og:image") || null;

  // Title minus " — VPN Radio"
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const rawTitle = titleMatch ? stripHtml(titleMatch[1]).replace(/\s*[—\-]\s*VPN Radio\s*$/i, "").trim() : "";
  const showName = rawTitle || null;

  // Visible text. Use everything AFTER the last occurrence of "Cloud Studies" — that's the last
  // nav item; content starts right after.
  const visible = stripHtml(html);
  const lastNav = visible.lastIndexOf("Cloud Studies");
  const contentText = lastNav >= 0 ? visible.slice(lastNav + "Cloud Studies".length).trim() : visible;

  // "Hosted by: <DJ>" up to the recurrence keyword
  const hostedByMatch = contentText.match(
    /Hosted by[:\s]+(.+?)(?=\s+(?:Monthly|Weekly|Bi[- ]?weekly|Bimonthly|Every|First|Second|Third|Fourth|Last|1st|2nd|3rd|4th)\b)/i
  );
  const djName = hostedByMatch ? hostedByMatch[1].trim() : null;

  // Recurrence: keyword + everything up to am/pm/timezone
  const recurrenceMatch = contentText.match(
    /(?:Monthly|Weekly|Bi[- ]?weekly|Bimonthly|Every\s+(?:other\s+)?\w+|(?:First|Second|Third|Fourth|Last|1st|2nd|3rd|4th)\s+\w+s?)[^.\n]{0,140}?(?:AM|PM|am|pm|EST|PST|PDT|EDT|CT|CDT|CST|UTC|GMT)/
  );
  const recurrenceText = recurrenceMatch ? recurrenceMatch[0].trim() : null;

  // Bio: text between the recurrence line and Instagram/Soundcloud/MOST RECENT/No results found
  let bio: string | null = null;
  if (recurrenceText) {
    const after = contentText.slice(contentText.indexOf(recurrenceText) + recurrenceText.length).trim();
    const bioMatch = after.match(/^(.*?)(?=\s+(?:Instagram|Soundcloud|MOST RECENT|Most Recent|No results found)\b)/);
    bio = bioMatch ? bioMatch[1].trim() : null;
    if (bio && bio.length < 10) bio = null;
  }

  // Social links — extract <a href> tags whose anchor text is exactly "Instagram" or "Soundcloud",
  // not the site-wide footer link to the VPN station.
  const linkRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]{1,40})<\/a>/gi;
  const links: { href: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    links.push({ href: m[1], text: stripHtml(m[2]) });
  }
  const instagram =
    links.find(
      (l) => l.text.toLowerCase() === "instagram" && /instagram\.com/i.test(l.href) && !/vpn\.radio/i.test(l.href)
    )?.href || null;
  const soundcloud =
    links.find(
      (l) =>
        l.text.toLowerCase() === "soundcloud" &&
        /soundcloud\.com/i.test(l.href) &&
        !/virtualpublicnetwork/i.test(l.href)
    )?.href || null;

  return {
    showUrl,
    iframeUrl,
    showName,
    djName,
    recurrenceText,
    bio,
    photoUrl,
    socials: { instagram, soundcloud },
    rawBodyText: contentText.slice(0, 2000),
  };
}

async function main() {
  console.log(`Scraping ${SHOW_SLUGS.length} VPN show pages...\n`);

  const results: ScrapedShow[] = [];
  for (const slug of SHOW_SLUGS) {
    process.stdout.write(`  ${slug} ... `);
    try {
      const result = await scrapeOne(slug);
      results.push(result);
      const ok = result.showName && result.djName && result.recurrenceText;
      console.log(
        ok
          ? `OK (dj="${result.djName}", recurrence="${result.recurrenceText}")`
          : `partial (showName=${!!result.showName}, dj=${!!result.djName}, recurrence=${!!result.recurrenceText})`
      );
    } catch (error) {
      console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
      results.push({
        showUrl: `https://www.virtualpublic.net/${slug}`,
        iframeUrl: `https://www.virtualpublic.net/${slug}/index`,
        showName: null,
        djName: null,
        recurrenceText: null,
        bio: null,
        photoUrl: null,
        socials: { instagram: null, soundcloud: null },
        rawBodyText: "",
      });
    }
  }

  const outPath = resolve(__dirname, "output", "vpn-raw.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(results, null, 2), "utf8");

  const ok = results.filter((r) => r.showName && r.djName && r.recurrenceText).length;
  console.log(`\nDone. ${ok}/${results.length} fully parsed. Output: ${outPath}`);
}

main().catch((error) => {
  console.error("Scraper failed:", error);
  process.exit(1);
});
