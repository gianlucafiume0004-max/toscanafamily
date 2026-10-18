import fs from "node:fs";

const file = "scripts/update-events.mjs";
let text = fs.readFileSync(file, "utf8");

const marker = `const startMinute = Number(
  startTimeMatch?.[2] || 0
);`;

const debug = `const startMinute = Number(
  startTimeMatch?.[2] || 0
);

console.log(
  "RSS TIME:",
  feedTitle,
  "hour=",
  startTimeMatch?.[1],
  "minute=",
  startTimeMatch?.[2],
  "parsed=",
  startHour + ":" + startMinute
);`;

if (!text.includes("RSS TIME:")) {
  text = text.replace(marker, debug);
  fs.writeFileSync(file, text, "utf8");
  console.log("Debug inserito.");
} else {
  console.log("Debug gia presente.");
}
