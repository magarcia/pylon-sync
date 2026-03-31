#!/usr/bin/env node
/**
 * Generates ~1400 interlinked markdown notes for testing.
 *
 * Usage:
 *   node generate-test-vault.mjs /path/to/vault
 *
 * Creates:
 *   365 daily notes, ~1000 topic notes (10 categories),
 *   20 people notes, 15 project notes, 10 MOC index notes, 1 home note.
 *   Each note has YAML frontmatter, wikilinks, tags, and realistic content.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const VAULT = resolve(process.argv[2] || ".");

if (!process.argv[2]) {
  console.error("Usage: node generate-test-vault.mjs /path/to/vault");
  process.exit(1);
}

console.log(`Generating notes in: ${VAULT}\n`);

// Deterministic random
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function pickN(arr, n) {
  const shuffled = [...arr].sort(() => rand() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}
function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

// ── Data ───────────────────────────────────────────────────────────

const categories = [
  "programming", "mathematics", "philosophy", "history",
  "science", "literature", "music", "design", "economics", "psychology",
];

const topicsByCategory = {
  programming: ["algorithms", "data-structures", "rust", "typescript", "python", "web-assembly", "compilers", "databases", "distributed-systems", "functional-programming", "testing", "devops", "security", "api-design", "concurrency"],
  mathematics: ["linear-algebra", "calculus", "probability", "graph-theory", "number-theory", "topology", "statistics", "game-theory", "cryptography", "optimization"],
  philosophy: ["epistemology", "ethics", "logic", "metaphysics", "aesthetics", "existentialism", "stoicism", "pragmatism", "phenomenology", "philosophy-of-mind"],
  history: ["ancient-rome", "renaissance", "industrial-revolution", "cold-war", "silk-road", "enlightenment", "medieval-europe", "ancient-greece", "world-war-2", "decolonization"],
  science: ["quantum-mechanics", "evolution", "neuroscience", "climate-science", "genetics", "astrophysics", "chemistry", "ecology", "materials-science", "bioinformatics"],
  literature: ["modernism", "magical-realism", "science-fiction", "poetry", "mythology", "narrative-theory", "literary-criticism", "dystopian-fiction", "ancient-texts", "translation"],
  music: ["music-theory", "jazz", "electronic-music", "classical", "synthesis", "composition", "rhythm", "harmony", "improvisation", "audio-engineering"],
  design: ["typography", "color-theory", "ux-design", "systems-thinking", "information-architecture", "visual-hierarchy", "accessibility", "motion-design", "grid-systems", "design-patterns"],
  economics: ["microeconomics", "macroeconomics", "behavioral-economics", "market-design", "game-theory-econ", "development-economics", "monetary-policy", "trade-theory", "public-choice", "econometrics"],
  psychology: ["cognitive-bias", "decision-making", "memory", "perception", "motivation", "social-psychology", "developmental-psychology", "clinical-psychology", "positive-psychology", "neuropsychology"],
};

const people = [
  "Alan Turing", "Ada Lovelace", "Claude Shannon", "Grace Hopper",
  "Edsger Dijkstra", "Barbara Liskov", "Donald Knuth", "Margaret Hamilton",
  "John von Neumann", "Hedy Lamarr", "Tim Berners-Lee", "Linus Torvalds",
  "Dennis Ritchie", "Ken Thompson", "Vint Cerf", "Leslie Lamport",
  "Niklaus Wirth", "Tony Hoare", "Robin Milner", "Per Martin-Löf",
];

const projects = [
  "Build a note-taking app", "Learn Rust", "Write a compiler",
  "Design a database", "Study category theory", "Read SICP",
  "Build a synth", "Learn typography", "Study game theory",
  "Write a blog", "Build a search engine", "Learn WebAssembly",
  "Design a protocol", "Study distributed systems", "Build a CLI tool",
];

const tags = [
  "evergreen", "seedling", "fleeting", "literature-note",
  "permanent-note", "reference", "question", "idea",
  "project", "review", "todo", "done", "in-progress",
];

const adjectives = [
  "fundamental", "advanced", "practical", "theoretical",
  "elegant", "surprising", "counterintuitive", "essential",
  "overlooked", "classic", "modern", "emerging",
];

const verbs = [
  "connects to", "builds upon", "contradicts", "extends",
  "simplifies", "generalizes", "applies to", "emerges from",
  "relates to", "transforms", "enables", "constrains",
];

// ── Helpers ────────────────────────────────────────────────────────

const allNotes = [];

function sanitize(name) {
  return name.replace(/[\/\\:*?"<>|]/g, "-");
}

function ensureDir(dir) {
  const full = join(VAULT, dir);
  if (!existsSync(full)) mkdirSync(full, { recursive: true });
}

function writeNote(path, content) {
  const fullPath = join(VAULT, path);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
  allNotes.push(path.replace(/\.md$/, ""));
}

function wikilink(notePath) {
  const name = notePath.split("/").pop();
  return `[[${name}]]`;
}

function randomLinks(count) {
  if (allNotes.length < 2) return "";
  return pickN(allNotes, count).map(t => wikilink(t)).join(", ");
}

function frontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const v of value) lines.push(`  - ${v}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---\n");
  return lines.join("\n");
}

function lorem() {
  const sentences = [
    "This concept has far-reaching implications across multiple domains.",
    "The relationship between these ideas is more nuanced than it first appears.",
    "Understanding this requires careful consideration of the underlying assumptions.",
    "Several key insights emerge when we examine this from different perspectives.",
    "The historical context helps explain why this approach became dominant.",
    "There are important trade-offs to consider when applying this in practice.",
    "This builds on earlier work but introduces several novel contributions.",
    "The formal definition is precise, but the intuition is what matters most.",
    "Practitioners often overlook the theoretical foundations, leading to subtle errors.",
    "Recent developments have challenged the conventional wisdom on this topic.",
    "The connection to other fields suggests deeper structural similarities.",
    "A careful analysis reveals both strengths and limitations of this framework.",
  ];
  return pickN(sentences, randInt(2, 4)).join(" ");
}

// ── Generate ───────────────────────────────────────────────────────

// 1. Daily notes (365)
ensureDir("daily");
const startDate = new Date(2025, 0, 1);
for (let i = 0; i < 365; i++) {
  const date = new Date(startDate);
  date.setDate(date.getDate() + i);
  const dateStr = date.toISOString().split("T")[0];
  writeNote(`daily/${dateStr}.md`,
    frontmatter({ date: dateStr, tags: [pick(tags), "daily"] }) +
    `# ${dateStr}\n\n## Notes\n\n${lorem()}\n\n` +
    `## References\n\n${randomLinks(randInt(1, 3))}\n\n` +
    `## Tasks\n\n- [ ] Review ${pick(categories)} notes\n- [x] Read chapter on ${pick(Object.values(topicsByCategory).flat())}\n`
  );
}
console.log(`  ✓ 365 daily notes`);

// 2. Topic notes (~1000)
let topicCount = 0;
for (const category of categories) {
  ensureDir(`topics/${category}`);
  const topics = topicsByCategory[category];

  for (const topic of topics) {
    // Main topic note
    writeNote(`topics/${category}/${sanitize(topic)}.md`,
      frontmatter({ category, tags: [category, pick(tags)], created: `2025-${String(randInt(1, 12)).padStart(2, "0")}-${String(randInt(1, 28)).padStart(2, "0")}` }) +
      `# ${topic.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}\n\n` +
      `${lorem()}\n\n` +
      `## Key Ideas\n\n` +
      `1. ${pick(adjectives)} ${pick(verbs)} ${pick(topics)}\n` +
      `2. ${pick(adjectives)} ${pick(verbs)} ${pick(Object.values(topicsByCategory).flat())}\n` +
      `3. ${pick(adjectives)} ${pick(verbs)} the ${pick(adjectives)} nature of ${pick(topics)}\n\n` +
      `## Details\n\n${lorem()}\n\n${lorem()}\n\n` +
      `## Related\n\n${randomLinks(randInt(2, 5))}\n\n` +
      `## References\n\n- Source: *${pick(adjectives)} ${category}* by ${pick(people)}\n`
    );
    topicCount++;

    // Sub-notes (7-10 per topic)
    for (let j = 0; j < randInt(7, 10); j++) {
      const subTitle = `${pick(adjectives)}-${topic}-${pick(["insight", "example", "proof", "application", "connection", "note", "observation"])}`;
      writeNote(`topics/${category}/${sanitize(subTitle)}.md`,
        frontmatter({ parent: `[[${sanitize(topic)}]]`, tags: [category, pick(tags)] }) +
        `# ${subTitle.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}\n\n` +
        `${lorem()}\n\n` +
        `This ${pick(verbs)} [[${sanitize(topic)}]] in a ${pick(adjectives)} way.\n\n` +
        `See also: ${randomLinks(randInt(1, 4))}\n\n` +
        (rand() > 0.7 ? `\`\`\`${pick(["typescript", "python", "rust", "sql"])}\n// Example code\nconst x = ${randInt(1, 100)};\nconsole.log(x);\n\`\`\`\n\n` : "")
      );
      topicCount++;
    }
  }
}
console.log(`  ✓ ${topicCount} topic notes`);

// 3. People notes (20)
ensureDir("people");
for (const person of people) {
  const relatedTopics = pickN(Object.values(topicsByCategory).flat(), randInt(3, 6));
  writeNote(`people/${sanitize(person)}.md`,
    frontmatter({ type: "person", tags: ["person", pick(categories)] }) +
    `# ${person}\n\n${lorem()}\n\n` +
    `## Contributions\n\n` + relatedTopics.map(t => `- Key work on [[${sanitize(t)}]]`).join("\n") + "\n\n" +
    `## Related People\n\n` + pickN(people.filter(p => p !== person), 3).map(p => `- [[${sanitize(p)}]]`).join("\n") + "\n"
  );
}
console.log(`  ✓ ${people.length} people notes`);

// 4. Project notes (15)
ensureDir("projects");
for (const project of projects) {
  const status = pick(["active", "planned", "completed", "paused"]);
  writeNote(`projects/${sanitize(project)}.md`,
    frontmatter({ type: "project", status, tags: ["project", status], started: `2025-${String(randInt(1, 12)).padStart(2, "0")}-01` }) +
    `# ${project}\n\n**Status:** ${status}\n\n${lorem()}\n\n` +
    `## Goals\n\n- [ ] ${pick(adjectives)} implementation\n- [ ] Write docs\n- [x] Research ${pick(Object.values(topicsByCategory).flat())}\n\n` +
    `## Notes\n\n${lorem()}\n\n## Related\n\n${randomLinks(randInt(3, 6))}\n`
  );
}
console.log(`  ✓ ${projects.length} project notes`);

// 5. MOC notes (10)
ensureDir("MOC");
for (const category of categories) {
  writeNote(`MOC/${sanitize(category)}.md`,
    frontmatter({ type: "moc", tags: ["moc", category] }) +
    `# ${category.replace(/\b\w/g, c => c.toUpperCase())} — Map of Content\n\n` +
    `## Topics\n\n` + topicsByCategory[category].map(t => `- [[${sanitize(t)}]]`).join("\n") + "\n\n" +
    `## Key People\n\n` + pickN(people, 4).map(p => `- [[${sanitize(p)}]]`).join("\n") + "\n\n" +
    `## Related\n\n` + pickN(categories.filter(c => c !== category), 3).map(c => `- [[${sanitize(c)}]]`).join("\n") + "\n"
  );
}
console.log(`  ✓ ${categories.length} MOC notes`);

// 6. Home note
writeNote("Home.md",
  frontmatter({ type: "index", tags: ["index"] }) +
  `# Test Vault\n\nThis vault contains ${allNotes.length} interlinked notes for testing.\n\n` +
  `## Maps of Content\n\n` + categories.map(c => `- [[${sanitize(c)}]]`).join("\n") + "\n\n" +
  `## Projects\n\n` + projects.slice(0, 5).map(p => `- [[${sanitize(p)}]]`).join("\n") + "\n\n" +
  `## People\n\n` + people.slice(0, 5).map(p => `- [[${sanitize(p)}]]`).join("\n") + "\n"
);
console.log(`  ✓ 1 home note`);

console.log(`\n✓ Generated ${allNotes.length} notes in ${VAULT}`);
console.log(`  Folders: daily/, topics/ (${categories.length} subcategories), people/, projects/, MOC/`);
console.log(`\nOpen this folder as a vault in Obsidian.`);
