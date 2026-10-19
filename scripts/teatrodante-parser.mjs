import * as cheerio from "cheerio";

export async function collectTeatroDanteEvents(
  source,
  {
    fetchText,
    compact,
    absoluteUrl,
    eventKey
  }
) {
  const html = await fetchText(source.url);
  const $ = cheerio.load(html);
  const rows = [];

  $("p").each((_, element) => {
    const text = compact(
      $(element).text().replace(/\u00a0/g, " "),
      4000
    );

    if (text) {
      rows.push(text);
    }
  });

  const months = {
    gennaio: 0,
    febbraio: 1,
    marzo: 2,
    aprile: 3,
    maggio: 4,
    giugno: 5,
    luglio: 6,
    agosto: 7,
    settembre: 8,
    ottobre: 9,
    novembre: 10,
    dicembre: 11
  };

  const dateRegex =
    /(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(20\d{2}))?\s+(?:alle\s+)?ore\s+(\d{1,2})(?:[.:](\d{2}))?/i;

  const events = [];
  let currentYear = new Date().getUTCFullYear();
  let previousMonth = null;

  for (let index = 0; index < rows.length; index += 1) {
    const match = rows[index].match(dateRegex);

    if (!match) {
      continue;
    }

    const day = Number(match[1]);
    const month = months[match[2].toLowerCase()];
    const explicitYear = match[3]
      ? Number(match[3])
      : null;
    const hour = Number(match[4]);
    const minute = Number(match[5] || 0);

    if (explicitYear) {
      currentYear = explicitYear;
    } else if (
      previousMonth !== null &&
      previousMonth >= 9 &&
      month <= 3
    ) {
      currentYear += 1;
    }

    previousMonth = month;

    let title = compact(
      rows[index].replace(dateRegex, ""),
      300
    );

    let titleIndex = index;

    if (!title) {
      for (
        let nextIndex = index + 1;
        nextIndex < rows.length;
        nextIndex += 1
      ) {
        if (dateRegex.test(rows[nextIndex])) {
          break;
        }

        const candidate = compact(
          rows[nextIndex],
          300
        );

        if (
          candidate &&
          !/^(progetto|ingressi|attivita|attività|spettacoli teatrali|biglietto)/i.test(
            candidate
          )
        ) {
          title = candidate;
          titleIndex = nextIndex;
          break;
        }
      }
    }

    if (!title) {
      continue;
    }

    title = compact(
      title
        .replace(/^[\s,;:'"]+/, "")
        .replace(/[\s,;:'"]+$/, "")
        .replace(/\s*\/\/.*$/, "")
        .replace(
          /\s*\([^)]*20\d{2}[^)]*\)\s*$/,
          ""
        ),
      300
    );

    const descriptionParts = [];

    for (
      let descriptionIndex = titleIndex + 1;
      descriptionIndex < rows.length;
      descriptionIndex += 1
    ) {
      if (dateRegex.test(rows[descriptionIndex])) {
        break;
      }

      descriptionParts.push(
        rows[descriptionIndex]
      );

      if (descriptionParts.length >= 6) {
        break;
      }
    }

    const startsOn = new Date(
      Date.UTC(
        currentYear,
        month,
        day,
        hour,
        minute,
        0
      )
    ).toISOString();

    const event = {
      title,
      city: source.comune || "Campi Bisenzio",
      location: "Teatrodante Carlo Monni",
      starts_on: startsOn,
      ends_on: null,
      description: compact(
        descriptionParts.join(" "),
        4000
      ),
      source_url: source.url,
      image_url:
        absoluteUrl(
          $("meta[property='og:image']")
            .attr("content"),
          source.url
        ) || null,
      family_super: true
    };

    event.import_key = eventKey(event);
    events.push(event);
  }

  const byKey = new Map();

  for (const event of events) {
    byKey.set(event.import_key, event);
  }

  console.log(
    "  Teatrodante normalized events: " +
      byKey.size
  );

  return [...byKey.values()];
}
