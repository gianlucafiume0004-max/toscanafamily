import * as cheerio from "cheerio";

export function extractPalazzoLeggendaEvents(
  content,
  {
    postTitle,
    postUrl,
    publishedAt,
    source,
    compact,
    eventKey
  }
) {
  const $ = cheerio.load(
    "<article>" + String(content || "") + "</article>"
  );

  const rows = [];

  $("article p").each((_, element) => {
    const text = compact(
      $(element)
        .text()
        .replace(/\u00a0/g, " "),
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

  const monthPattern =
    /(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/i;

  const fullText = compact(
    [
      postTitle,
      rows.join(" ")
    ].join(" "),
    20000
  );

  const monthMatch =
    String(postTitle || "").match(monthPattern) ||
    fullText.match(monthPattern);

  if (!monthMatch) {
    return [];
  }

  const month =
    months[monthMatch[1].toLowerCase()];

  const publishedDate =
    new Date(publishedAt);

  const yearMatch =
    fullText.match(/\b(20\d{2})\b/);

  const year = yearMatch
    ? Number(yearMatch[1])
    : Number.isNaN(publishedDate.getTime())
      ? new Date().getUTCFullYear()
      : publishedDate.getUTCFullYear();

  const dateRegex =
    /^(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\s+(\d{1,2})(?:\s+ore\s+(\d{1,2})(?:(?:[:.])(\d{2}))?|\s+tutto\s+il\s+giorno)/i;

  const ageYearsRegex =
    /(?:da|dai)\s*(\d{1,2})\s*(?:a|-)\s*(\d{1,2})\s*anni/i;

  const ageMonthsRegex =
    /(?:da|dai)\s*(\d{1,2})\s*(?:a|-)\s*(\d{1,2})\s*mesi/i;

  const ignoredTitles = [
    "speciale",
    "gruppo di lettura",
    "empolichescrive junior",
    "info e prenotazioni",
    "palazzo leggenda"
  ];

  const events = [];
  const processed = new Set();

  for (
    let index = 0;
    index < rows.length;
    index += 1
  ) {
    const dateMatch =
      rows[index].match(dateRegex);

    if (!dateMatch) {
      continue;
    }

    const day = Number(dateMatch[1]);

    const allDay =
      /tutto\s+il\s+giorno/i.test(
        rows[index]
      );

    const hour = allDay
      ? 10
      : Number(dateMatch[2] || 10);

    const minute = allDay
      ? 0
      : Number(dateMatch[3] || 0);

    let title = "";
    let titleIndex = index;

    for (
      let nextIndex = index + 1;
      nextIndex < rows.length;
      nextIndex += 1
    ) {
      if (dateRegex.test(rows[nextIndex])) {
        break;
      }

      const candidate = compact(
        rows[nextIndex]
          .replace(/#\S+/g, " ")
          .replace(
            /^speciale[:\s]+/i,
            ""
          )
          .replace(/\s+/g, " "),
        300
      );

      if (!candidate) {
        continue;
      }

      const normalizedCandidate =
        candidate
          .toLowerCase()
          .replace(/[:.]+$/g, "")
          .trim();

      if (
        ignoredTitles.some(
          (ignored) =>
            normalizedCandidate === ignored
        )
      ) {
        continue;
      }

      if (
        /^(prenotazione|per tutti|da \d|info)/i.test(
          candidate
        )
      ) {
        continue;
      }

      title = candidate;
      titleIndex = nextIndex;
      break;
    }

    if (!title) {
      continue;
    }

    const descriptionParts = [];
    let ageRange = null;

    for (
      let descriptionIndex =
        titleIndex + 1;
      descriptionIndex < rows.length;
      descriptionIndex += 1
    ) {
      const value =
        rows[descriptionIndex];

      if (dateRegex.test(value)) {
        break;
      }

      if (
        /^(gruppo di lettura|empolichescrive|speciale|genitorialita|genitorialità|info e prenotazioni)$/i.test(
          value.replace(/[:.]+$/g, "").trim()
        )
      ) {
        break;
      }

      const yearsMatch =
        value.match(ageYearsRegex);

      const monthsMatch =
        value.match(ageMonthsRegex);

      if (yearsMatch) {
        ageRange =
          Number(yearsMatch[1]) +
          "-" +
          Number(yearsMatch[2]) +
          " anni";
      } else if (monthsMatch) {
        ageRange =
          Number(monthsMatch[1]) +
          "-" +
          Number(monthsMatch[2]) +
          " mesi";
      }

      if (
        !/^(prenotazione consigliata|info e prenotazioni)$/i.test(
          value
        )
      ) {
        descriptionParts.push(value);
      }

      if (
        descriptionParts.length >= 8
      ) {
        break;
      }
    }

    const startsOn = new Date(
      Date.UTC(
        year,
        month,
        day,
        hour,
        minute,
        0
      )
    ).toISOString();

    const uniqueKey = [
      title.toLowerCase(),
      startsOn
    ].join("|");

    if (processed.has(uniqueKey)) {
      continue;
    }

    processed.add(uniqueKey);

    const event = {
      title: compact(
        title
          .replace(/#\S+/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
        300
      ),
      city:
        source.comune || "Empoli",
      location: "Palazzo Leggenda",
      starts_on: startsOn,
      ends_on: null,
      description: compact(
        descriptionParts.join(" "),
        4000
      ),
      source_url: postUrl,
      image_url: null,
      address:
        "Via Luigi Paladini, Empoli",
      source_name: source.name,
      age_range: ageRange,
      family_super: true
    };

    event.import_key =
      eventKey(event);

    events.push(event);
  }

  const byKey = new Map();

  for (const event of events) {
    byKey.set(
      event.import_key,
      event
    );
  }

  return [...byKey.values()];
}
