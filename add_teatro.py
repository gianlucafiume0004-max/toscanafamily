from pathlib import Path
p=Path('scripts/update-events.mjs')
s=p.read_text(encoding='utf-8')
m='async function collectSourceEvents(source) {'
f=r'''async function collectTeatroDanteEvents(source) {
  const html = await fetchText(source.url);
  const $ = cheerio.load(html);
  const rows = [];
  $("p").each((_, el) => {
    const t = compact($(el).text().replace(/\u00a0/g, " "), 4000);
    if (t) rows.push(t);
  });
  const months = {gennaio:0,febbraio:1,marzo:2,aprile:3,maggio:4,giugno:5,luglio:6,agosto:7,settembre:8,ottobre:9,novembre:10,dicembre:11};
  const rx = /(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(20\d{2}))?\s+(?:alle\s+)?ore\s+(\d{1,2})(?:[.:](\d{2}))?/i;
  const events = [];
  let year = new Date().getUTCFullYear();
  let prev = null;
  for (let i = 0; i < rows.length; i += 1) {
    const x = rows[i].match(rx);
    if (!x) continue;
    const day = Number(x[1]);
    const month = months[x[2].toLowerCase()];
    if (x[3]) year = Number(x[3]);
    else if (prev !== null && prev >= 9 && month <= 3) year += 1;
    prev = month;
    const hour = Number(x[4]);
    const minute = Number(x[5] || 0);
    let title = compact(rows[i].replace(rx, ""), 300);
    let k = i;
    if (!title && rows[i + 1] && !rx.test(rows[i + 1])) {
      title = compact(rows[i + 1], 300);
      k = i + 1;
    }
    if (!title) continue;
    title = compact(title.replace(/^[\s,;:'"]+|[\s,;:'"]+$/g, "").replace(/\s*\/\/.*$/, "").replace(/\s*\([^)]*20\d{2}[^)]*\)\s*$/, ""), 300);
    const description = compact(rows.slice(k + 1, k + 6).filter(v => !rx.test(v)).join(" "), 4000);
    const event = {title, city: source.comune || "Campi Bisenzio", location: "Teatrodante Carlo Monni", starts_on: new Date(Date.UTC(year, month, day, hour, minute, 0)).toISOString(), ends_on: null, description, source_url: source.url, image_url: absoluteUrl($("meta[property='og:image']").attr("content"), source.url) || null, family_super: true};
    event.import_key = eventKey(event);
    events.push(event);
  }
  const byKey = new Map(events.map(e => [e.import_key, e]));
  console.log("  Teatrodante normalized events: " + byKey.size);
  return [...byKey.values()];
}

'''
r='''async function collectSourceEvents(source) {
  if (String(source.type || "").toLowerCase() === "teatrodante") {
    return await collectTeatroDanteEvents(source);
  }

'''
if m not in s: raise SystemExit('ERRORE: funzione principale non trovata')
if 'async function collectTeatroDanteEvents(source)' not in s: s=s.replace(m,f+m,1)
if 'return await collectTeatroDanteEvents(source);' not in s: s=s.replace(m,r,1)
p.write_text(s,encoding='utf-8')
print('OK: parser aggiunto')
