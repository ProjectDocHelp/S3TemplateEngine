# S3TemplateEngine

S3TemplateEngine is a lightweight serverless template engine for people who want to keep writing HTML and still publish through AWS. You write templates and assets, S3TE renders and publishes the static result.

This README is the user guide for the rewrite generation. The deeper implementation specs still live in [`docs/`](./docs/), but this file is intentionally written for users first.

## Table of Contents

- [S3TemplateEngine](#s3templateengine)
  - [Table of Contents](#table-of-contents)
  - [Motivation](#motivation)
  - [Support](#support)
  - [Concept](#concept)
  - [Installation (AWS)](#installation-aws)
  - [Installation (VSCode)](#installation-vscode)
  - [Installation (S3TE)](#installation-s3te)
  - [Usage](#usage)
    - [Daily Workflow](#daily-workflow)
    - [CLI Commands](#cli-commands)
    - [Template Commands](#template-commands)
  - [Optional: Webiny CMS](#optional-webiny-cms)

## Motivation

AWS S3 and CloudFront are a great platform for websites: cheap, fast and low-maintenance. The annoying part usually starts before hosting. You still need reusable HTML, a safe deployment flow, and maybe a way for editors to maintain content without turning your project into a full framework.

**S3TemplateEngine is for you if** you want to keep writing HTML by hand, but still want to:

- reuse snippets like headers, navigation and footer blocks
- generate many pages from one template
- publish multiple languages or variants from one project
- keep AWS hosting simple and low-cost
- optionally let editors maintain content in Webiny
- deploy without hand-editing Lambda settings or uploading ZIP files yourself

## Support

If S3TE saves you time and you want to buy me a tea, you can do that here:

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/hokcomics)

If you need help, found a bug, or want to contribute, open an issue or pull request on GitHub.

## Concept

S3TE keeps one simple promise: you write source templates, S3TE turns them into static files, AWS serves the result.

![S3TE overview](https://user-images.githubusercontent.com/100029932/174443152-b16c98fc-f2f2-420e-9f5b-a6ea7a861acd.png)

<details>
  <summary>What is the difference between the code bucket and the website bucket?</summary>

The code bucket receives your source project files: `.html`, `.part`, CSS, JavaScript, images and everything else you deploy from your project.

The website bucket contains the finished result that visitors actually receive through CloudFront. That split is what makes incremental rendering, generated pages and safe re-deploys possible.

</details>

<details>
  <summary>What happens when I deploy?</summary>

`s3te deploy` loads the validated project configuration, packages the AWS runtime, creates or updates one persistent CloudFormation environment stack, creates one temporary CloudFormation deploy stack for packaging artifacts, synchronizes your current source files into the code bucket, and removes the temporary stack again after the real deploy run.

That source sync is not limited to Lambda code. It includes your `.html`, `.part`, CSS, JavaScript, images and other project files so the running AWS stack can react to source changes inside the code bucket.

The persistent environment stack contains the long-lived AWS resources such as buckets, Lambda functions, DynamoDB tables, CloudFront distributions and the runtime manifest parameter. The temporary deploy stack exists only so CloudFormation can consume the packaged Lambda artifacts cleanly.

</details>

## Installation (AWS)

This section is only about the AWS things you need before you touch S3TE. The actual click-by-click screens are best left to the official AWS documentation, because the console changes over time. The goal here is to tell you exactly what S3TE needs from AWS, why it needs it, and which official page gets you there.

<details>
  <summary>What you need before your first S3TE deploy</summary>

| Item | Why S3TE needs it | Official guide |
| --- | --- | --- |
| AWS account | S3TE deploys into your own AWS account. | [Create an AWS account](https://portal.aws.amazon.com/billing/signup) |
| Daily-work AWS access | `s3te deploy` needs credentials that can create CloudFormation stacks and related resources. | [Create an IAM user](https://docs.aws.amazon.com/console/iam/add-users), [Manage access keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-keys-admin-managed.html) |
| AWS CLI v2 | The S3TE CLI shells out to the official `aws` CLI. | [Install AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), [Get started with AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html) |
| Domain name you control | CloudFront and TLS only make sense for domains you can point to AWS. | Use your registrar of choice |
| ACM certificate in `us-east-1` | CloudFront requires its public certificate in `us-east-1`. | [Public certificates in ACM](https://docs.aws.amazon.com/acm/latest/userguide/acm-public-certificates.html) |
| Optional Route53 hosted zone | Needed only if S3TE should create DNS alias records automatically. | [Create a public hosted zone](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingHostedZone.html) |

</details>

<details>
  <summary>Recommended AWS order for first-time users</summary>

1. Create the AWS account.
2. Stop using the root user for daily work.
3. Create one deployment identity for yourself.
4. Install AWS CLI v2 locally.
5. Run `aws configure` and verify it with `aws sts get-caller-identity`.
6. Request the ACM certificate in `us-east-1`.
7. If you want automatic DNS records, create or locate the Route53 hosted zone.

For a first personal setup, the easiest route is usually one IAM user with console access and access keys. If you already work with AWS Identity Center or another federated login, that is fine too. S3TE uses the standard AWS credential chain.

</details>

## Installation (VSCode)

This section is only about the local editing experience. S3TE does not require VSCode, but VSCode is the reference editor workflow and the easiest path for most users.

<details>
  <summary>Install the local tools you need</summary>

| Tool | Why you want it | Official guide |
| --- | --- | --- |
| Visual Studio Code | Comfortable editor with integrated terminal and extension support. | [VS Code setup overview](https://code.visualstudio.com/docs/setup/setup-overview), [Get started with VS Code](https://code.visualstudio.com/docs/getstarted/getting-started) |
| Node.js 20 or newer | Required for the S3TE CLI and local rendering. | [Download Node.js](https://nodejs.org/en/download) |

</details>

<details>
  <summary>What to verify before you continue</summary>

Open VSCode, open the integrated terminal, and run:

```bash
node --version
npm --version
```

If both commands print a version number, your local machine is ready for S3TE.

</details>

## Installation (S3TE)

This is the S3TE-specific part. No AWS console links, no editor tutorial, just the steps that actually create and run an S3TE project.

<details>
  <summary>1. Create your project folder</summary>

```bash
mkdir mywebsite
cd mywebsite
```

</details>

<details>
  <summary>2. Install S3TE locally in the project</summary>

```bash
npm install --save-dev @projectdochelp/s3te
```
</details>

<details>
  <summary>3. Scaffold the project</summary>

With the local package installed, initialize the project like this:

```bash
npx s3te init --project-name mywebsite --base-url example.com
```

You can safely run `s3te init` more than once. If `npm install` already created a minimal `package.json`, `s3te init` extends it with the missing S3TE defaults and scripts instead of failing. An existing `s3te.config.json` is completed with missing scaffold defaults, explicit `--project-name` and `--base-url` values are refreshed on re-run, and the generated schema file is updated to the current package version. Existing content files and templates stay untouched unless you use `--force`.

If you want a one-shot scaffold without installing first, and `@projectdochelp/s3te` is already published on npm, this also works:

```bash
npx --package @projectdochelp/s3te s3te init --project-name mywebsite --base-url example.com
```

The default scaffold creates:

```text
mywebsite/
  package.json
  s3te.config.json
  .github/
    workflows/
      s3te-sync.yml
  app/
    part/
      head.part
    website/
      index.html
  offline/
    content/
      en.json
    schemas/
      s3te.config.schema.json
    tests/
      project.test.mjs
  .vscode/
    extensions.json
```

The generated `.github/workflows/s3te-sync.yml` is the default CI path for GitHub-based source publishing into the S3TE code bucket. It is scaffolded once and then left alone on later `s3te init` runs unless you use `--force`.

</details>

<details>
  <summary>4. Fill in the real AWS values in <code>s3te.config.json</code></summary>

The most important fields for a first deployment are:

```json
{
  "environments": {
    "dev": {
      "awsRegion": "eu-central-1",
      "stackPrefix": "DEV",
      "certificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/replace-me",
      "route53HostedZoneId": "Z1234567890"
    }
  },
  "variants": {
    "website": {
      "languages": {
        "en": {
          "baseUrl": "example.com",
          "cloudFrontAliases": ["example.com", "www.example.com"]
        }
      }
    }
  }
}
```

`route53HostedZoneId` is optional. Leave it out if you want to manage DNS yourself.

Use plain hostnames in `baseUrl` and `cloudFrontAliases`, not full URLs. If your config contains a `prod` environment plus additional environments such as `test` or `stage`, S3TE keeps the `prod` hostname unchanged and derives non-production hostnames automatically by prepending `<env>.`.

</details>

<details>
  <summary>5. Run the first local check and deploy</summary>

```bash
npx s3te validate
npx s3te render --env dev
npx s3te test
npx s3te doctor --env dev
npx s3te deploy --env dev
```

`render` writes the local preview into `offline/S3TELocal/preview/dev/...`.

`deploy` creates or updates the persistent environment stack, uses a temporary deploy stack for packaged Lambda artifacts, synchronizes the source project into the code bucket, and removes the temporary stack again when the deploy finishes.

After the first successful deploy, use `s3te sync --env dev` for regular template, partial, asset and source updates when the infrastructure itself did not change.

If you left `route53HostedZoneId` out of the config, the last DNS step stays manual: point your domain at the created CloudFront distribution after deploy.

</details>

## Usage

Once the project is installed, your everyday loop splits into two paths: deploy when infrastructure changes, sync when only project sources changed.

### Daily Workflow

<details>
  <summary>Typical daily loop</summary>

1. Edit files in `app/part/` and `app/website/`.
2. If you use content-driven tags without Webiny, edit `offline/content/en.json` or `offline/content/items.json`.
3. Validate and render locally.
4. Run your tests.
5. Use `deploy` for the first installation or after infrastructure/config/runtime changes.
6. Use `sync` for day-to-day source publishing into the code bucket.

```bash
npx s3te validate
npx s3te render --env dev
npx s3te test
npx s3te sync --env dev
```

Use a full deploy only when needed:

```bash
npx s3te deploy --env dev
```

Once Webiny is installed and the stack is deployed with Webiny enabled, CMS content changes are picked up in AWS through the DynamoDB stream integration. Those content changes do not require another `sync` or `deploy`.

</details>

### CLI Commands

<details>
  <summary>Command overview</summary>

| Command | What it does |
| --- | --- |
| `s3te init` | Creates the starter project structure and base config. |
| `s3te validate` | Checks config and template syntax without rendering outputs. |
| `s3te render --env <name>` | Renders locally into `offline/S3TELocal/preview/<env>/...`. |
| `s3te test` | Runs the project tests from `offline/tests/`. |
| `s3te package --env <name>` | Builds the AWS deployment artifacts without deploying them yet. |
| `s3te sync --env <name>` | Uploads current project sources into the configured code buckets. |
| `s3te doctor --env <name>` | Checks local machine and AWS access before deploy. |
| `s3te deploy --env <name>` | Deploys or updates the AWS environment and syncs source files. |
| `s3te migrate` | Updates older project configs and can retrofit Webiny into an existing S3TE project. |

</details>

### Template Commands

These are the core S3TE commands you will use even in a plain HTML-only project.

<details>
  <summary><code>&lt;part&gt;</code> - reuse a partial file</summary>

```html
<part>head.part</part>
```

</details>

<details>
  <summary><code>&lt;if&gt;</code> - render inline HTML only when a condition matches</summary>

```html
<if>{
  "env": "prod",
  "template": "<meta name='robots' content='all'>"
}</if>
```

</details>

<details>
  <summary><code>&lt;fileattribute&gt;</code> - print metadata of the current output file</summary>

```html
<fileattribute>filename</fileattribute>
```

</details>

<details>
  <summary><code>&lt;lang&gt;</code> - print the current language metadata</summary>

```html
<html lang="<lang>2</lang>">
<link rel="canonical" href="https://<lang>baseurl</lang>">
```

</details>

<details>
  <summary><code>&lt;switchlang&gt;</code> - choose inline content by language</summary>

```html
<switchlang>
  <de>Willkommen</de>
  <en>Welcome</en>
</switchlang>
```

</details>

If you also want content-driven commands such as `dbmulti` or `dbmultifile`, continue with the optional Webiny section below. The same commands can also read from local `offline/content/*.json` files when you are not using Webiny yet.

## Optional: Webiny CMS

You do not need Webiny to use S3TE. Start with plain HTML first. Add Webiny only when editors should maintain content in a CMS instead of editing local JSON files under `offline/content/`.

The supported target for this optional path is Webiny 6.x on its standard AWS deployment model.

![S3TE with Webiny](https://user-images.githubusercontent.com/100029932/174443536-7af050de-eea7-4456-81aa-a173863b6ec9.png)

<details>
  <summary>Install Webiny first by following the official guides</summary>

This section assumes that S3TE is already installed and deployed. The S3TE-specific Webiny setup only starts after you already have a running Webiny 6.x installation in AWS.

- [Install Webiny](https://www.webiny.com/learn/course/getting-started/installing-webiny)

</details>

<details>
  <summary>Retrofit Webiny onto an existing S3TE project</summary>

1. Install Webiny in AWS and finish the Webiny setup first.
2. Find the Webiny DynamoDB table that contains the CMS entries you want S3TE to mirror.
3. Upgrade your existing S3TE config for Webiny:

```bash
npx s3te migrate --enable-webiny --webiny-source-table webiny-1234567 --webiny-tenant root --webiny-model article --write
```

`staticContent` and `staticCodeContent` are kept automatically. Add `--webiny-model` once per custom model you want S3TE to mirror.

If different environments should read from different Webiny installations or tenants, run the migration per environment:

```bash
npx s3te migrate --env test --enable-webiny --webiny-source-table webiny-test-1234567 --webiny-tenant preview --write
npx s3te migrate --env prod --enable-webiny --webiny-source-table webiny-live-1234567 --webiny-tenant root --write
```

4. Turn on DynamoDB Streams for the Webiny source table with `NEW_AND_OLD_IMAGES`.
5. If your S3TE language keys are not identical to your Webiny locales, add `webinyLocale` per language in `s3te.config.json`, for example `"en": { "webinyLocale": "en-US" }`.
6. If your Webiny installation hosts multiple tenants, keep `integrations.webiny.tenant` set so S3TE only mirrors the intended tenant.
7. Check the project again:

```bash
npx s3te doctor --env prod
```

8. Redeploy the existing S3TE environment:

```bash
npx s3te deploy --env prod
```

That deploy updates the existing environment stack and adds the Webiny mirror resources to it. You do not need a fresh S3TE installation. After that, Webiny content changes flow through the deployed AWS resources automatically; only template or asset changes still need `s3te sync --env <name>`.

</details>

<details>
  <summary>GitHub Actions source publishing</summary>

If your team works through GitHub instead of running `s3te sync` locally, the scaffold already includes `.github/workflows/s3te-sync.yml`.

That workflow is meant for source publishing only:

- it validates the project
- it uploads `app/...` and `part/...` into the S3TE code bucket
- the resulting S3 events trigger the deployed Lambda pipeline in AWS

Use a full `deploy` only when the infrastructure, environment config, or runtime package changes.

Before the workflow can run, do this once:

1. Run the first real `npx s3te deploy --env <name>` so the code bucket already exists.
2. In AWS IAM, create an access key for a CI user that may sync only the S3TE code bucket for that environment.
3. In GitHub open `Settings -> Secrets and variables -> Actions -> Secrets`.
4. Add these repository secrets:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
5. Open `.github/workflows/s3te-sync.yml` and adjust:
   - the branch under `on.push.branches`
   - `aws-region`
   - `npx s3te sync --env dev` to your target environment such as `prod` or `test`

Minimal IAM policy example for one code bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::dev-website-code-mywebsite"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::dev-website-code-mywebsite/*"]
    }
  ]
}
```

For non-production environments or additional variants, use the derived code bucket names from your config, for example `test-website-code-mywebsite` or `app-code-mywebsite`.

The scaffolded workflow looks like this:

```yaml
name: S3TE Sync
on:
  workflow_dispatch:
  push:
    branches: ["main"]
    paths:
      - "app/**"
      - "package.json"
      - "package-lock.json"
      - ".github/workflows/s3te-sync.yml"

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - name: Install dependencies
        shell: bash
        run: |
          if [ -f package-lock.json ]; then
            npm ci
          else
            npm install
          fi
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: eu-central-1
      - run: npx s3te validate
      - run: npx s3te sync --env dev
```

</details>

<details>
  <summary>What the migration command changes</summary>

The migration command writes or updates the `integrations.webiny` block in `s3te.config.json`. A typical result looks like this:

Example config block:

```json
"integrations": {
  "webiny": {
    "enabled": true,
    "sourceTableName": "webiny-1234567",
    "mirrorTableName": "{stackPrefix}_s3te_content_{project}",
    "tenant": "root",
    "relevantModels": ["article", "staticContent", "staticCodeContent"],
    "environments": {
      "test": {
        "sourceTableName": "webiny-test-1234567",
        "tenant": "preview"
      },
      "prod": {
        "sourceTableName": "webiny-live-1234567",
        "tenant": "root"
      }
    }
  }
}
```

For localized Webiny projects, the language block can also carry the mapping explicitly:

```json
"languages": {
  "en": {
    "baseUrl": "example.com",
    "cloudFrontAliases": ["example.com"],
    "webinyLocale": "en-US"
  }
}
```

</details>

<details>
  <summary>Content template commands</summary>

These commands are useful both with Webiny and with local JSON content files:

- `dbpart`
- `dbmulti`
- `dbmultifile`
- `dbitem`
- `dbmultifileitem`

</details>
