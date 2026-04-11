import { spawn } from "node:child_process";

import { S3teError } from "../../core/src/index.mjs";

function toCliError(message, details) {
  return new S3teError("AWS_AUTH_ERROR", message, details);
}

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        AWS_PAGER: "",
        ...(options.env ?? {})
      },
      stdio: options.stdio ?? "pipe"
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new S3teError(options.errorCode ?? "ADAPTER_ERROR", `${command} ${args.join(" ")} failed.`, {
          command,
          args,
          code,
          stdout,
          stderr
        }));
        return;
      }

      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

export async function runAwsCli(args, options = {}) {
  const finalArgs = [...args];
  if (options.profile) {
    finalArgs.unshift(options.profile);
    finalArgs.unshift("--profile");
  }

  if (options.region) {
    finalArgs.unshift(options.region);
    finalArgs.unshift("--region");
  }

  return runProcess("aws", finalArgs, {
    cwd: options.cwd,
    env: options.env,
    errorCode: options.errorCode ?? "ADAPTER_ERROR",
    stdio: options.stdio
  });
}

export async function ensureAwsCliAvailable(options = {}) {
  try {
    await runProcess("aws", ["--version"], {
      cwd: options.cwd,
      errorCode: "AWS_AUTH_ERROR"
    });
  } catch (error) {
    throw toCliError("AWS CLI is not installed or not available in PATH.", { cause: error.message });
  }
}

export async function ensureAwsCredentials({ region, profile, cwd }) {
  try {
    const result = await runAwsCli(["sts", "get-caller-identity", "--output", "json"], {
      region,
      profile,
      cwd,
      errorCode: "AWS_AUTH_ERROR"
    });
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw toCliError("AWS credentials are not configured or not valid.", {
      region,
      profile,
      cause: error.message,
      details: error.details
    });
  }
}
