import * as cheerio from "cheerio";

export async function collectBibliotecheFirenzeEvents(
  source,
  {
    fetchText,
    compact,
    eventKey
  }
) {
  const html = await fetchText(source.url);
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

  const dateRegex =
    /^(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(20\d{2})$/i;

  const timeRegex =
    /(\d{1,2})(?::|\.)(\d{2})/;

  const baseUrl =
    new URL(source.url).origin;

  const events = [];
  const processed = new Set();

  let currentDate = null;

  $("body *").each((_, element) => {
    const current = $(element);

    if (current.children().length === 0) {
      const leafText = compact(
        current.text(),
        150
      );

      const dateMatch =
        leafText.match(dateRegex);

      if (dateMatch) {
        currentDate = {
          day: Number(dateMatch[1]),
          month:
            months[
              dateMatch[2].toLowerCase()
            ],
          year: Number(dateMatch[3])
        };
      }
    }

    if (!current.hasClass("timeline-item")) {
      return;
    }

    if (!currentDate) {
      return;
    }

    const titleLink = current
      .find(".timeline-event-title a")
      .first();

    const title = compact(
      titleLink.text(),
      300
    );

    const relativeUrl =
      titleLink.attr("href");

    if (!title || !relativeUrl) {
      return;
    }

    if (
      /\b(annullata|annullato|cancellata|cancellato)\b/i.test(
        title
      )
    ) {
      return;
    }

    const sourceUrl = new URL(
      relativeUrl,
      baseUrl
    ).href;

    const timeText = compact(
      current
        .find(".timeline-event")
        .first()
        .text(),
      100
    );

    const timeMatch =
      timeText.match(timeRegex);

    if (!timeMatch) {
      return;
    }

    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);

    const location = compact(
      current
        .find(".timeline-event-location")
        .first()
        .text()
        .replace(/^Biblioteca:\s*/i, ""),
      300
    );

    const description = compact(
      current
        .find(".timeline-event-attendee")
        .first()
        .text(),
      4000
    );

    const startsOn = new Date(
      Date.UTC(
        currentDate.year,
        currentDate.month,
        currentDate.day,
        hour,
        minute,
        0
      )
    ).toISOString();

    const uniqueKey = [
      title.toLowerCase(),
      startsOn,
      location.toLowerCase()
    ].join("|");

    if (processed.has(uniqueKey)) {
      return;
    }

    processed.add(uniqueKey);

    const event = {
      title,
      city: source.comune || "Firenze",
      location:
        location ||
        "Biblioteche Comunali Firenze",
      starts_on: startsOn,
      ends_on: null,
      description,
      source_url: sourceUrl,
      image_url: null,
      source_name:
        source.name ||
        "Biblioteche Comunali Firenze"
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
    "  Biblioteche Firenze normalized events: " +
      byKey.size
  );

  return [...byKey.values()];
}
