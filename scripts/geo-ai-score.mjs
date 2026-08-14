import fs from "node:fs";

const input = process.argv[2] || "data/geo-ai-results.csv";
const benchmark = JSON.parse(fs.readFileSync("data/geo-ai-benchmark.json", "utf8"));
const lines = fs.readFileSync(input, "utf8").trim().split(/\r?\n/).slice(1).filter(Boolean);
const rows = lines.map((line) => {
  const cells = line.split(",");
  return { engine: cells[1] || "", id: cells[2] || "", rank: Number(cells[3] || 0), mentioned: cells[4] === "1", cited: cells[5] === "1", correct: cells[6] !== "0" };
});
const points = (row) => !row.correct ? benchmark.scoring.wrong_product
  : row.rank === 1 ? benchmark.scoring.first
  : row.rank === 2 ? benchmark.scoring.second
  : row.mentioned ? benchmark.scoring.mentioned
  : row.cited ? benchmark.scoring.citation_only
  : benchmark.scoring.absent;
const groups = new Map();
for (const row of rows) {
  const value = groups.get(row.engine) || { tests: 0, points: 0, mentions: 0, citations: 0, errors: 0 };
  value.tests += 1; value.points += points(row); value.mentions += Number(row.mentioned); value.citations += Number(row.cited); value.errors += Number(!row.correct);
  groups.set(row.engine, value);
}
console.log(`GEO benchmark: ${rows.length}/${benchmark.prompts.length} odpovedí`);
for (const [engine, value] of groups) {
  const score = value.tests ? Math.round((value.points / (value.tests * benchmark.scoring.first)) * 1000) / 10 : 0;
  console.log(`${engine}: ${score}/100 | zmienky ${value.mentions}/${value.tests} | citácie ${value.citations}/${value.tests} | nesprávne ${value.errors}`);
}
