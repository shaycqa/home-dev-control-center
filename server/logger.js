import fs from "node:fs";
const file = process.argv[2];
let size = 0,
  atLineStart = true;
try {
  size = fs.statSync(file).size;
} catch {}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  try {
    let text = "";
    for (const part of chunk.split(/(?<=\n)/)) {
      if (atLineStart) text += "[" + new Date().toISOString() + "] ";
      text += part;
      atLineStart = part.endsWith("\n");
    }
    const buffer = Buffer.from(text);
    if (size + buffer.length > 2 * 1024 * 1024) {
      fs.writeFileSync(file, "", { mode: 0o600 });
      size = 0;
    }
    fs.appendFileSync(file, buffer, { mode: 0o600 });
    size += buffer.length;
  } catch {}
});
