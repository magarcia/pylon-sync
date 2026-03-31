import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const newVersion = process.argv[2];
if (!newVersion) {
	console.error("Usage: node scripts/version-bump.mjs <version>");
	process.exit(1);
}

function updateJson(filePath, updater) {
	const content = JSON.parse(readFileSync(filePath, "utf8"));
	updater(content);
	writeFileSync(filePath, JSON.stringify(content, null, "\t") + "\n");
	console.log(`  Updated ${filePath}`);
}

const packageJsonFiles = [
	"packages/core/package.json",
	"packages/provider-github/package.json",
	"packages/provider-s3/package.json",
	"packages/cli/package.json",
	"packages/obsidian-plugin/package.json",
];

// Update all package.json files
for (const file of packageJsonFiles) {
	updateJson(file, (pkg) => {
		pkg.version = newVersion;
	});
}

// Update obsidian-plugin manifest.json and root copy (BRAT reads from root)
for (const manifestPath of ["packages/obsidian-plugin/manifest.json", "manifest.json"]) {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.version = newVersion;
	writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
	console.log(`  Updated ${manifestPath}`);
}
const { minAppVersion } = JSON.parse(readFileSync("manifest.json", "utf8"));

// Update versions.json
const versionsPath = "packages/obsidian-plugin/versions.json";
const versions = JSON.parse(readFileSync(versionsPath, "utf8"));
versions[newVersion] = minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, "\t") + "\n");
console.log(`  Updated ${versionsPath}`);

console.log(`\nBumped version to ${newVersion}`);
