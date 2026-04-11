#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import {
  deployProject,
  doctorProject,
  loadResolvedConfig,
  migrateProject,
  packageProject,
  renderProject,
  runProjectTests,
  scaffoldProject,
  syncProject,
  validateProject
} from "../src/project.mjs";

function setOption(options, key, value) {
  if (options[key] === undefined) {
    options[key] = value;
    return;
  }

  if (Array.isArray(options[key])) {
    options[key].push(value);
    return;
  }

  options[key] = [options[key], value];
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      setOption(options, key, true);
      continue;
    }

    setOption(options, key, next);
    index += 1;
  }
  return { command, options };
}

function asArray(value) {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function duration(startTime) {
  return Date.now() - startTime;
}

function printJson(command, success, warnings, errors, startedAt, data = undefined) {
  process.stdout.write(JSON.stringify({
    command,
    success,
    durationMs: duration(startedAt),
    warnings,
    errors,
    data
  }, null, 2) + "\n");
}

function printHelp() {
  process.stdout.write(
    "Usage: s3te <command> [options]\n\n" +
    "Commands:\n" +
    "  init\n" +
    "  validate\n" +
    "  render\n" +
    "  test\n" +
    "  package\n" +
    "  sync\n" +
    "  deploy\n" +
    "  doctor\n" +
    "  migrate\n"
  );
}

async function loadConfigForCommand(projectDir, configOption) {
  const configPath = path.resolve(projectDir, configOption ?? "s3te.config.json");
  return { configPath, ...(await loadResolvedConfig(projectDir, configPath)) };
}

function warningsShouldFail(options, warnings) {
  return Boolean(options["warnings-as-errors"]) && warnings.length > 0;
}

async function main() {
  const startedAt = Date.now();
  const { command, options } = parseArgs(process.argv.slice(2));
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const wantsJson = Boolean(options.json);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    const projectDir = path.resolve(cwd, options.dir ?? ".");
    const result = await scaffoldProject(projectDir, {
      projectName: options["project-name"],
      baseUrl: options["base-url"],
      variant: asArray(options.variant)[0],
      language: asArray(options.lang)[0],
      force: Boolean(options.force)
    });

    if (wantsJson) {
      printJson("init", true, [], [], startedAt, result);
      return;
    }

    process.stdout.write(`Initialized project ${result.projectName} in ${projectDir}\n`);
    return;
  }

  if (command === "validate") {
    const loaded = await loadConfigForCommand(cwd, options.config);
    if (!loaded.ok) {
      if (wantsJson) {
        printJson("validate", false, loaded.warnings, loaded.errors, startedAt);
      } else {
        for (const error of loaded.errors) {
          process.stderr.write(`${error.code}: ${error.message}\n`);
        }
      }
      process.exitCode = 2;
      return;
    }

    const validation = await validateProject(cwd, loaded.config, {
      environment: asArray(options.env)[0]
    });
    const success = validation.ok && !warningsShouldFail(options, validation.warnings);

    if (wantsJson) {
      printJson("validate", success, validation.warnings, validation.errors, startedAt, {
        configPath: loaded.configPath,
        checkedEnvironments: asArray(options.env).length > 0 ? asArray(options.env) : Object.keys(loaded.config.environments),
        checkedTemplates: validation.checkedTemplates
      });
      process.exitCode = success ? 0 : 2;
      return;
    }

    if (!success) {
      for (const error of validation.errors) {
        process.stderr.write(`${error.code}: ${error.message}\n`);
      }
      if (warningsShouldFail(options, validation.warnings)) {
        for (const warning of validation.warnings) {
          process.stderr.write(`${warning.code}: ${warning.message}\n`);
        }
      }
      process.exitCode = 2;
      return;
    }

    process.stdout.write(`Config and templates valid: ${loaded.configPath}\n`);
    return;
  }

  if (command === "render") {
    const loaded = await loadConfigForCommand(cwd, options.config);
    if (!loaded.ok) {
      if (wantsJson) {
        printJson("render", false, loaded.warnings, loaded.errors, startedAt);
      } else {
        for (const error of loaded.errors) {
          process.stderr.write(`${error.code}: ${error.message}\n`);
        }
      }
      process.exitCode = 2;
      return;
    }

    if (!options.env) {
      process.stderr.write("render requires --env <name>\n");
      process.exitCode = 1;
      return;
    }

    const report = await renderProject(cwd, loaded.config, {
      environment: asArray(options.env)[0],
      variant: asArray(options.variant)[0],
      language: asArray(options.lang)[0],
      entry: options.entry,
      outputDir: options["output-dir"]
    });
    const success = !warningsShouldFail(options, report.warnings);

    if (options.stdout && report.renderedArtifacts.length === 1) {
      const body = await fs.readFile(path.join(cwd, report.renderedArtifacts[0]), "utf8");
      process.stdout.write(body);
      process.exitCode = success ? 0 : 2;
      return;
    }

    if (wantsJson) {
      printJson("render", success, report.warnings, [], startedAt, report);
      process.exitCode = success ? 0 : 2;
      return;
    }

    process.stdout.write(`Rendered ${report.renderedArtifacts.length} artifact(s) into ${report.outputDir}\n`);
    process.exitCode = success ? 0 : 2;
    return;
  }

  if (command === "test") {
    const loaded = await loadConfigForCommand(cwd, options.config);
    if (!loaded.ok) {
      if (wantsJson) {
        printJson("test", false, loaded.warnings, loaded.errors, startedAt);
      } else {
        for (const error of loaded.errors) {
          process.stderr.write(`${error.code}: ${error.message}\n`);
        }
      }
      process.exitCode = 2;
      return;
    }

    const validation = await validateProject(cwd, loaded.config, {
      environment: asArray(options.env)[0]
    });
    if (!validation.ok) {
      if (wantsJson) {
        printJson("test", false, validation.warnings, validation.errors, startedAt);
      }
      process.exitCode = 2;
      return;
    }

    const exitCode = await runProjectTests(cwd);
    process.exitCode = exitCode;
    return;
  }

  if (command === "package") {
    const loaded = await loadConfigForCommand(cwd, options.config);
    if (!loaded.ok) {
      if (wantsJson) {
        printJson("package", false, loaded.warnings, loaded.errors, startedAt);
      }
      process.exitCode = 2;
      return;
    }
    if (!options.env) {
      process.stderr.write("package requires --env <name>\n");
      process.exitCode = 1;
      return;
    }

    const report = await packageProject(cwd, loaded.config, {
      environment: asArray(options.env)[0],
      outDir: options["out-dir"],
      clean: Boolean(options.clean),
      features: asArray(options.feature)
    });

    if (wantsJson) {
      printJson("package", true, [], [], startedAt, report);
      return;
    }

    process.stdout.write(`Packaged deployment artifacts into ${report.packageDir}\n`);
    return;
  }

  if (command === "sync") {
    const loaded = await loadConfigForCommand(cwd, options.config);
    if (!loaded.ok) {
      if (wantsJson) {
        printJson("sync", false, loaded.warnings, loaded.errors, startedAt);
      }
      process.exitCode = 2;
      return;
    }
    if (!options.env) {
      process.stderr.write("sync requires --env <name>\n");
      process.exitCode = 1;
      return;
    }

    const report = await syncProject(cwd, loaded.config, {
      environment: asArray(options.env)[0],
      outDir: options["out-dir"],
      profile: options.profile,
      stdio: wantsJson ? "pipe" : "inherit"
    });

    if (wantsJson) {
      printJson("sync", true, [], [], startedAt, report);
      return;
    }

    process.stdout.write(`Synced project sources to ${report.syncedCodeBuckets.length} code bucket(s)\n`);
    return;
  }

  if (command === "deploy") {
    const loaded = await loadConfigForCommand(cwd, options.config);
    if (!loaded.ok) {
      if (wantsJson) {
        printJson("deploy", false, loaded.warnings, loaded.errors, startedAt);
      }
      process.exitCode = 2;
      return;
    }
    if (!options.env) {
      process.stderr.write("deploy requires --env <name>\n");
      process.exitCode = 1;
      return;
    }

    const report = await deployProject(cwd, loaded.config, {
      environment: asArray(options.env)[0],
      packageDir: options["package-dir"],
      features: asArray(options.feature),
      profile: options.profile,
      plan: Boolean(options.plan),
      noSync: Boolean(options["no-sync"]),
      stdio: wantsJson ? "pipe" : "inherit"
    });

    if (wantsJson) {
      printJson("deploy", true, [], [], startedAt, report);
      return;
    }

    process.stdout.write(`${options.plan ? "Prepared" : "Deployed"} stack ${report.stackName}\n`);
    return;
  }

  if (command === "doctor") {
    let loaded = null;
    try {
      loaded = await loadConfigForCommand(cwd, options.config);
    } catch {
      loaded = null;
    }

    const configPath = path.resolve(cwd, options.config ?? "s3te.config.json");
    const checks = await doctorProject(cwd, configPath, {
      environment: asArray(options.env)[0],
      config: loaded?.config,
      profile: options.profile
    });
    const success = checks.every((check) => check.ok);

    if (wantsJson) {
      printJson("doctor", success, [], [], startedAt, { checks });
      process.exitCode = success ? 0 : 3;
      return;
    }

    for (const check of checks) {
      process.stdout.write(`${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.message}\n`);
    }
    process.exitCode = success ? 0 : 3;
    return;
  }

  if (command === "migrate") {
    const configPath = path.resolve(cwd, options.config ?? "s3te.config.json");
    const rawConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
    const migration = await migrateProject(configPath, rawConfig, {
      writeChanges: Boolean(options.write) && !Boolean(options["dry-run"]),
      environment: asArray(options.env)[0],
      enableWebiny: Boolean(options["enable-webiny"]),
      disableWebiny: Boolean(options["disable-webiny"]),
      webinySourceTable: options["webiny-source-table"],
      webinyTenant: options["webiny-tenant"],
      webinyModels: asArray(options["webiny-model"])
    });
    if (wantsJson) {
      printJson("migrate", true, [], [], startedAt, {
        configVersion: migration.config.configVersion,
        wrote: Boolean(options.write) && !Boolean(options["dry-run"]),
        changes: migration.changes
      });
      return;
    }
    process.stdout.write(options.write ? `Migrated ${configPath}\n` : `Migration preview for ${configPath}: configVersion=${migration.config.configVersion}\n`);
    for (const change of migration.changes) {
      process.stdout.write(`- ${change}\n`);
    }
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.code ?? "ERROR"}: ${error.message}\n`);
  if (error.details) {
    process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  }
  process.exitCode = error.code === "CONFIG_SCHEMA_ERROR" || error.code === "CONFIG_CONFLICT_ERROR" || error.code === "TEMPLATE_SYNTAX_ERROR" ? 2 : 1;
});
