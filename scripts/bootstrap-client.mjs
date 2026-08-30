#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..");

function usage() {
  return `Usage: node scripts/bootstrap-client.mjs [options]

Options:
  --client <name>    Put a non-secret client name into the local profile.
  --dry-run          Print the deterministic plan without writing or installing.
  --skip-install     Create local templates without running npm ci.
  --root <path>      Override the repository root (intended for isolated tests).
  --help             Show this help.

This command never accepts or writes credentials, migrates a database, deploys,
enables a campaign, or places a call.`;
}

function parseArguments(argv) {
  const parsed = {
    client: "",
    dryRun: false,
    skipInstall: false,
    root: defaultRoot,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (argument === "--skip-install") {
      parsed.skipInstall = true;
      continue;
    }
    if (argument === "--client" || argument === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--client") parsed.client = value.trim();
      if (argument === "--root") parsed.root = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (parsed.client.length > 120) {
    throw new Error("Client name must be 120 characters or fewer.");
  }
  return parsed;
}

function requireNode22() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(`Node.js 22 or newer is required; found ${process.versions.node}.`);
  }
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

function campaignModeFrom(content) {
  const match = content.match(/^CAMPAIGN_MODE\s*=\s*([^#\r\n]*)/m);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}

async function createProfile(templatePath, destinationPath, clientName) {
  const profile = JSON.parse(await fsp.readFile(templatePath, "utf8"));
  if (clientName) {
    profile.company = { ...profile.company, name: clientName, shortName: clientName };
  }
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  await fsp.writeFile(destinationPath, `${JSON.stringify(profile, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

async function createEnvironment(templatePath, destinationPath) {
  const template = await fsp.readFile(templatePath, "utf8");
  if (campaignModeFrom(template) !== "paused") {
    throw new Error("Environment template must set CAMPAIGN_MODE=paused.");
  }
  await fsp.writeFile(destinationPath, template, { flag: "wx", mode: 0o600 });
}

function assertExistingEnvironmentIsPaused(environmentPath) {
  if (!fs.existsSync(environmentPath)) return;
  const content = fs.readFileSync(environmentPath, "utf8");
  const mode = campaignModeFrom(content);
  if (mode && mode !== "paused") {
    throw new Error(`Refusing to bootstrap: ${environmentPath} sets CAMPAIGN_MODE=${mode}. Set it to paused first.`);
  }
}

function installDependencies(applicationRoot) {
  const result = spawnSync("npm", ["ci"], {
    cwd: applicationRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ci failed with exit code ${result.status}.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  requireNode22();

  const repositoryRoot = options.root;
  const applicationRoot = path.join(repositoryRoot, "cloud-crm");
  const packagePath = path.join(applicationRoot, "package.json");
  const lockPath = path.join(applicationRoot, "package-lock.json");
  const profileTemplatePath = path.join(applicationRoot, "config", "business-profile.example.json");
  const profilePath = path.join(applicationRoot, "config", "business-profile.json");
  const environmentTemplatePath = path.join(applicationRoot, ".env.example");
  const environmentPath = path.join(applicationRoot, ".env.local");

  requireFile(packagePath, "Application package");
  requireFile(lockPath, "npm lockfile");
  requireFile(profileTemplatePath, "Business profile template");
  requireFile(environmentTemplatePath, "Environment template");
  JSON.parse(await fsp.readFile(profileTemplatePath, "utf8"));
  assertExistingEnvironmentIsPaused(environmentPath);

  const profileAction = fs.existsSync(profilePath) ? "preserve existing local profile" : "create ignored local profile";
  const environmentAction = fs.existsSync(environmentPath) ? "preserve existing paused environment" : "create ignored blank environment";
  const installAction = options.skipInstall ? "skip dependency installation" : "run npm ci from the lockfile";

  console.log("AI Voice Sales Agent bootstrap plan:");
  console.log(`- repository: ${repositoryRoot}`);
  console.log(`- profile: ${profileAction}`);
  console.log(`- environment: ${environmentAction}`);
  console.log(`- dependencies: ${installAction}`);
  console.log("- campaign: paused; no call, migration, deployment, or external write");

  if (options.dryRun) {
    console.log("Dry run complete. No files were written and no packages were installed.");
    return;
  }

  if (!fs.existsSync(profilePath)) {
    await createProfile(profileTemplatePath, profilePath, options.client);
    console.log(`Created ${path.relative(repositoryRoot, profilePath)}.`);
  }
  if (!fs.existsSync(environmentPath)) {
    await createEnvironment(environmentTemplatePath, environmentPath);
    console.log(`Created ${path.relative(repositoryRoot, environmentPath)} with blank credentials and paused mode.`);
  }
  if (!options.skipInstall) installDependencies(applicationRoot);

  console.log("Bootstrap complete. Next:");
  console.log(`1. Edit ${path.relative(repositoryRoot, profilePath)}.`);
  console.log(`2. Fill blank values in ${path.relative(repositoryRoot, environmentPath)} without committing it.`);
  console.log("3. Run: cd cloud-crm && npm run config:check && npm run db:migrate && npm run dev");
  console.log("4. Keep CAMPAIGN_MODE=paused until legal, provider, script, DNC, hours, and test-call reviews are complete.");
}

main().catch((error) => {
  console.error(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
