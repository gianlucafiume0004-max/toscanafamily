import * as cheerio from "cheerio";

export async function collectMuseoGalileoEvents(
  source,
  {
    fetchText,
    compact,
    absoluteUrl,
    eventKey
  }
) {
  const calendarUrl =
    source.url.includes("view=list")
      ? source.url
      : source.url +
        (source.url.includes("?") ? "&" : "?") +
        "view=list";

  const html = await fetchText(calendarUrl);
  const $ = cheerio.load(html);

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

  const dateTimeRegex =
    /(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(20\d{2})\s+(\d{1,2})(?::|\.)(\d{2})(?:\s*-\s*(\d{1,2})(?::|\.)(\d{2}))?/i;

  const eventPathRegex =
    /\/it\/attivita\/calendario\/lista-attivita\/[^?#]+\.html/i;

  const ignoredTitles = [
    "leggi tutto",
    "archivio",
    "tutte le attività",
    "prossime attività",
    "attività concluse"
  ];

  const events = [];
  const processed = new Set();

  $(
    'a[href*="/it/attivita/calendario/lista-attivita/"]'
  ).each((_, element) => {
    const link = $(element);

    const title = compact(
      link.text(),
      300
    );

    const href = link.attr("href");

    if (!title || !href) {
      return;
    }

    if (!eventPathRegex.test(href)) {
      return;
    }

    if (
      ignoredTitles.includes(
        title.toLowerCase()
      )
    ) {
      return;
    }

    if (
      /\b(annullato|annullata|cancellato|cancellata)\b/i.test(
        title
      )
    ) {
      return;
    }

    const sourceUrl = absoluteUrl(
      href,
      calendarUrl
    );

    if (!sourceUrl) {
      return;
    }

    const ancestor = link
      .parents()
      .toArray()
      .find((parent) => {
        const parentText = compact(
          $(parent).text(),
          8000
        );

        return dateTimeRegex.test(parentText);
      });

    if (!ancestor) {
      return;
    }

    const block = $(ancestor);
    const blockText = compact(
      block.text(),
      8000
    );

    const dateMatch =
      blockText.match(dateTimeRegex);

    if (!dateMatch) {
      return;
    }

    const day = Number(dateMatch[1]);
    const month =
      months[dateMatch[2].toLowerCase()];
    const year = Number(dateMatch[3]);

    const startHour = Number(dateMatch[4]);
    const startMinute = Number(dateMatch[5]);

    const endHour = dateMatch[6]
      ? Number(dateMatch[6])
      : null;

    const endMinute = dateMatch[7]
      ? Number(dateMatch[7])
      : null;

    const startsOn = new Date(
      Date.UTC(
        year,
        month,
        day,
        startHour,
        startMinute,
        0
      )
    ).toISOString();

    const endsOn =
      endHour !== null
        ? new Date(
            Date.UTC(
              year,
              month,
              day,
              endHour,
              endMinute || 0,
              0
            )
          ).toISOString()
        : null;

    const description = compact(
      blockText
        .replace(dateTimeRegex, " ")
        .replace(title, " ")
        .replace(/\bEvento Concluso\b/gi, " ")
        .replace(/\bEvento in corso\b/gi, " ")
        .replace(/\bProssimo evento\b/gi, " ")
        .replace(/\bLeggi tutto\b/gi, " "),
      4000
    );

    const imageUrl =
      absoluteUrl(
        block.find("img").first().attr("src"),
        calendarUrl
      ) || null;

    const uniqueKey = [
      title.toLowerCase(),
      startsOn,
      sourceUrl
    ].join("|");

    if (processed.has(uniqueKey)) {
      return;
    }

    processed.add(uniqueKey);

    const familySuper =
      /a tutta scienza/i.test(blockText) ||
      /^(gocce di colore|la scienza delle bolle di sapone|giochiamo con mister g|microscopiche scoperte|pioggia, tuoni e lampi|esploratori si diventa!|le meraviglie dell’aria e del vuoto|gionitus, un astronomo distratto|i colori della luce|gli strumenti di galileo|la magia dei giochi ottici|costruire la scienza|a spasso con galileo|messer guido e i segreti di galileo|esperimenti e meraviglie alla corte dei lorena)$/i.test(
        title
      );

    const event = {
      title,
      city: source.comune || "Firenze",
      location: "Museo Galileo",
      starts_on: startsOn,
      ends_on: endsOn,
      description:
        description ||
        "Attività al Museo Galileo",
      source_url: sourceUrl,
      image_url: imageUrl,
      source_name:
        source.name || "Museo Galileo",
      family_super: familySuper
    };

    event.import_key = eventKey(event);
    events.push(event);
  });

  const byKey = new Map();

  for (const event of events) {
    byKey.set(
      event.import_key,
      event
    );
  }

  console.log(
    "  Museo Galileo normalized events: " +
      byKey.size
  );

  return [...byKey.values()];
}
