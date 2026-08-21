import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(serverDir, "..", "data.js");

export async function loadCaseData() {
  const source = await fs.readFile(dataPath, "utf8");
  const match = source.match(/^window\.XIPU_CASE_DATA=(.*);\s*$/s);
  if (!match) throw new Error("Unable to parse data.js");
  const data = JSON.parse(match[1]);
  if (!data || !Array.isArray(data.cases) || !data.filters) throw new Error("Invalid XIPU case data");
  return data;
}
