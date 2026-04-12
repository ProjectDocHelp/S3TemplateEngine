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
  - [Optional: Sitemap](#optional-sitemap)
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

If optional runtime features such as `sitemap` or Webiny are enabled in `s3te.config.json`, the same environment stack also carries those extra Lambdas and event bindings.

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
| ACM certificate in `us-east-1` | CloudFront requires its public certificate in `us-east-1`, and the certificate must cover every alias S3TE will derive for that environment. | [Public certificates in ACM](https://docs.aws.amazon.com/acm/latest/userguide/acm-public-certificates.html) |
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

The generated `.github/workflows/s3te-sync.yml` is the default CI path for GitHub-based source publishing into the S3TE code buckets. It is scaffolded once and then left alone on later `s3te init` runs unless you use `--force`.

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

Use plain hostnames in `baseUrl` and `cloudFrontAliases`, not full URLs. If your config contains a `prod` environment plus additional environments such as `test` or `stage`, S3TE keeps the `prod` hostname unchanged and derives non-production hostnames like this:

- apex host: `example.com` -> `test.example.com`
- first-level subdomain: `app.example.com` -> `test-app.example.com`
- deeper host: `admin.app.example.com` -> `test-admin.app.example.com`

Your ACM certificate must cover the final derived aliases of the environment you deploy. Example:

- `*.example.com` covers `test.example.com`
- `*.example.com` also covers `test-app.example.com`
- `*.example.com` does not cover `test-admin.app.example.com`
- for deeper aliases like `test-admin.app.example.com`, add a SAN such as `*.app.example.com`, the exact hostname, or use a different `certificateArn` for that environment

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

`doctor --env <name>` now also checks whether the configured ACM certificate covers the CloudFront aliases that S3TE derives for that environment. For that check, the AWS identity running `doctor` needs permission to call `acm:DescribeCertificate` for the configured certificate ARN.

`deploy` creates or updates the persistent environment stack, uses a temporary deploy stack for packaged Lambda artifacts, synchronizes the source project into the code bucket, and removes the temporary stack again when the deploy finishes.

After the first successful deploy, use `s3te sync --env dev` for regular template, partial, asset and source updates when the infrastructure itself did not change.

If you left `route53HostedZoneId` out of the config, the last DNS step stays manual: point your domain at the created CloudFront distribution after deploy.

</details>

<details>
  <summary>6. Prepare GitHub Actions for code-bucket publishing</summary>

Use this step if your team wants GitHub pushes to publish project sources into the S3TE code bucket instead of running `s3te sync` locally.

`s3te init` already scaffolded `.github/workflows/s3te-sync.yml` for that path.

That workflow is meant for source publishing only:

- it validates the project
- it reads the selected environment from GitHub and resolves the matching AWS region from `s3te.config.json`
- it uploads every configured variant into its own S3TE code bucket
- the resulting S3 events trigger the deployed Lambda pipeline in AWS

Use a full `deploy` only when the infrastructure, environment config, or runtime package changes.

GitHub preparation checklist:

1. Push the project to GitHub together with `.github/workflows/s3te-sync.yml`.
2. Make sure GitHub Actions are allowed for the repository or organization.
3. Run the first real `npx s3te deploy --env <name>` so the code buckets already exist.
4. In AWS IAM, create an access key for a CI user that may sync only the S3TE code buckets for that environment.
5. In GitHub open `Settings -> Secrets and variables -> Actions -> Variables`.
6. Add these repository variables:
   - `S3TE_ENVIRONMENT`
     Use the exact environment name from `s3te.config.json`, for example `dev`, `test`, or `prod`.
   - `S3TE_GIT_BRANCH` optional
     Use the branch that should trigger the sync job, for example `main`.
7. In GitHub open `Settings -> Secrets and variables -> Actions -> Secrets`.
8. Add these repository secrets:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
9. Leave `.github/workflows/s3te-sync.yml` unchanged unless you want a custom CI flow. The scaffolded workflow already reads:
   - the environment from `S3TE_ENVIRONMENT`
   - the branch from `S3TE_GIT_BRANCH` or defaults to `main`
   - the AWS region from `s3te.config.json`

You do not have to store bucket names, source folders, part folders, or AWS regions in GitHub variables. `s3te sync` resolves all of that from `s3te.config.json`.

For projects with multiple environments such as `test` and `prod`, the simplest setup is usually one workflow file per target environment, for example:

- `.github/workflows/s3te-sync-test.yml` with `npx s3te sync --env test`
- `.github/workflows/s3te-sync-prod.yml` with `npx s3te sync --env prod`

First verification in GitHub:

1. Open the `Actions` tab in the repository.
2. Select `S3TE Sync`.
3. Start it once manually with `Run workflow`.
4. Check that the run reaches the `Configure AWS credentials`, `Validate project`, and `Sync project sources to the S3TE code buckets` steps without error.

Where to get the AWS values:

- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
  In the AWS console open `IAM -> Users -> <your-ci-user> -> Security credentials -> Create access key`.
  Save both values immediately. The secret access key is shown only once. AWS documents the credential options and access-key handling here:
  [AWS security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/security-creds.html),
  [Manage access keys for IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-keys-admin-managed.html).
- `S3TE_ENVIRONMENT`
  This is the environment key from your `s3te.config.json`, for example `test` or `prod`.
- AWS region
  You do not need to copy this into GitHub. The workflow reads `environments.<name>.awsRegion` directly from `s3te.config.json`.

What gets uploaded where:

- For each variant, S3TE stages `partDir` into `part/` and `sourceDir` into `<variant>/`.
- Then S3TE syncs that staged tree into the resolved code bucket for that variant and environment.

With your example config this means:

- `test` + `website`: `app/part` and `app/website` go to `test-website-code-sop`
- `test` + `app`: `app/part-app` and `app/app` go to `test-app-code-sop`
- `prod` + `website`: `app/part` and `app/website` go to `website-code-sop`
- `prod` + `app`: `app/part-app` and `app/app` go to `app-code-sop`

Minimal IAM policy example for the `test` environment and both variants:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::test-website-code-sop",
        "arn:aws:s3:::test-app-code-sop"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::test-website-code-sop/*",
        "arn:aws:s3:::test-app-code-sop/*"
      ]
    }
  ]
}
```

For different environments or additional variants, use the derived code bucket names from your config.

The scaffolded workflow looks like this:

```yaml
# Required GitHub repository secrets:
# - AWS_ACCESS_KEY_ID
# - AWS_SECRET_ACCESS_KEY
# Required GitHub repository variable:
# - S3TE_ENVIRONMENT (for example dev, test, or prod)
# Optional GitHub repository variable:
# - S3TE_GIT_BRANCH (defaults to main)
# This workflow reads s3te.config.json at runtime and syncs all variants into their own code buckets.
name: S3TE Sync
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Optional S3TE environment override from s3te.config.json
        required: false
        type: string
  push:
    paths:
      - "app/**"
      - "package.json"
      - "package-lock.json"
      - ".github/workflows/s3te-sync.yml"

jobs:
  sync:
    if: github.event_name == 'workflow_dispatch' || github.ref_name == (vars.S3TE_GIT_BRANCH || 'main')
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
      - name: Resolve S3TE environment and AWS region from s3te.config.json
        id: s3te-config
        shell: bash
        env:
          WORKFLOW_INPUT_ENVIRONMENT: ${{ inputs.environment }}
          REPOSITORY_S3TE_ENVIRONMENT: ${{ vars.S3TE_ENVIRONMENT }}
        run: |
          node -e "const fs=require('node:fs'); const requested=(process.env.WORKFLOW_INPUT_ENVIRONMENT || process.env.REPOSITORY_S3TE_ENVIRONMENT || '').trim(); const config=JSON.parse(fs.readFileSync('s3te.config.json','utf8')); const known=Object.keys(config.environments ?? {}); if(!requested){ console.error('Missing GitHub repository variable S3TE_ENVIRONMENT.'); process.exit(1);} const environmentConfig=config.environments?.[requested]; if(!environmentConfig){ console.error('Unknown environment ' + requested + '. Known environments: ' + (known.length > 0 ? known.join(', ') : '(none)') + '.'); process.exit(1);} fs.appendFileSync(process.env.GITHUB_OUTPUT, 'environment=' + requested + '\n'); fs.appendFileSync(process.env.GITHUB_OUTPUT, 'aws_region=' + environmentConfig.awsRegion + '\n');"
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ steps.s3te-config.outputs.aws_region }}
      - run: npx s3te validate --env ${{ steps.s3te-config.outputs.environment }}
      - run: npx s3te sync --env ${{ steps.s3te-config.outputs.environment }}
```

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
6. Use `sync` for day-to-day source publishing into the code buckets.

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
| `s3te migrate` | Updates older project configs and can retrofit optional features such as `sitemap` or Webiny into an existing S3TE project. |

</details>

## Template Commands

S3TE uses literal HTML-like tags inside your `.html` and `.part` files. The tags are case-sensitive, always lowercase, and never use attributes. JSON-based commands must contain valid JSON and reject unknown properties.

The commands below are grouped by purpose:

- `Core Features` work in every S3TE project.
- `Webiny Features` are the content-driven commands. Despite the name, they also work with local content files under `offline/content/` when you are not using Webiny yet.

### Core Features

<details>
  <summary><code>&lt;part&gt;</code> - reuse a partial file from <code>partDir</code></summary>

**Action**

Loads another template fragment from the current variant's `partDir`, renders it recursively, and inserts the result at the current position.

**Syntax**

```html
<part>head.part</part>
```

The payload must be a relative path inside `partDir`. Leading `/` and `..` are invalid.

**Example**

```html
<head>
  <part>head.part</part>
</head>
```

</details>

<details>
  <summary><code>&lt;if&gt;</code> - render inline HTML only when a condition matches</summary>

**Action**

Evaluates one inline JSON rule and renders its `template` only when the rule matches the current render target.

**Syntax**

```html
<if>{
  "env": "prod",
  "file": "index.html",
  "not": false,
  "template": "<meta name='robots' content='all'>"
}</if>
```

Supported JSON properties:

- `env` optional: matches the current environment name case-insensitively
- `file` optional: matches the current output filename, for example `index.html`
- `not` optional: inverts the final result when `true`
- `template` required: inline HTML to render when the rule matches

If both `env` and `file` are present, both must match.

If both conditions are omitted, the tag behaves like an inline template include and always renders its `template`.

**Example**

```html
<if>{
  "env": "prod",
  "template": "<meta name='robots' content='all'>"
}</if>
<if>{
  "env": "test",
  "template": "<meta name='robots' content='noindex'>"
}</if>
```

</details>

<details>
  <summary><code>&lt;fileattribute&gt;</code> - print metadata of the current output file</summary>

**Action**

Prints metadata of the file currently being rendered.

**Syntax**

```html
<fileattribute>filename</fileattribute>
```

Currently supported values:

- `filename`: the output key relative to the target bucket, for example `news/article-one.html`

**Example**

```html
<link rel="canonical" href="https://<lang>baseurl</lang>/<fileattribute>filename</fileattribute>">
```

</details>

<details>
  <summary><code>&lt;lang&gt;</code> - print current language metadata</summary>

**Action**

Prints language-related metadata of the current render target.

**Syntax**

```html
<lang>2</lang>
<lang>baseurl</lang>
```

Currently supported values:

- `2`: the current language code such as `en` or `de`
- `baseurl`: the resolved base hostname for the current language and environment

**Example**

```html
<html lang="<lang>2</lang>">
  <head>
    <link rel="canonical" href="https://<lang>baseurl</lang>">
  </head>
</html>
```

</details>

<details>
  <summary><code>&lt;switchlang&gt;</code> - choose inline content by language</summary>

**Action**

Selects the block whose tag name matches the current language and renders only that block.

**Syntax**

```html
<switchlang>
  <de>Willkommen</de>
  <en>Welcome</en>
</switchlang>
```

There is no fallback to `defaultLanguage`. If the current language block is missing, S3TE renders an empty string and records a warning.

**Example**

```html
<p>
  <switchlang>
    <de>Dein ultimatives Website-Werkzeug</de>
    <en>Your ultimate website tool</en>
  </switchlang>
</p>
```

</details>

### Webiny Features

These commands read from the resolved content repository. With Webiny enabled, that means mirrored Webiny content. Without Webiny, the same commands can read from local JSON files under `offline/content/`.

<details>
  <summary><code>&lt;dbpart&gt;</code> - insert one content fragment by <code>contentId</code></summary>

**Action**

Loads a single content item by `contentId` and inserts its content fragment.

S3TE first tries the language-specific field `content&lt;lang&gt;`, for example `contentde`, and falls back to `content` if the language-specific field does not exist.

**Syntax**

```html
<dbpart>impressum</dbpart>
```

The payload is the content ID, not the internal database record ID.

**Example**

```html
<body>
  <dbpart>impressum</dbpart>
</body>
```

</details>

<details>
  <summary><code>&lt;dbmulti&gt;</code> - render one inline template for multiple content items</summary>

**Action**

Queries matching content items and renders the given inline template once for each result.

**Syntax**

```html
<dbmulti>{
  "filter": [
    {"forWebsite": {"BOOL": true}}
  ],
  "filtertype": "equals",
  "limit": 3,
  "template": "<article><h2><dbitem>headline</dbitem></h2></article>"
}</dbmulti>
```

Supported JSON properties:

- `filter` required: array of legacy DynamoDB-style filter clauses
- `filtertype` optional: `equals` or `contains`, default is `equals`
- `limit` optional: maximum number of items to render
- `template` required: inline template rendered once per match

Filter notes:

- every filter clause contains exactly one field
- multiple clauses are combined with logical `AND`
- `__typename` matches the content model, for example `article`
- supported legacy value wrappers are `S`, `N`, `BOOL`, `NULL`, and `L`
- results are sorted deterministically; numeric `order` comes first, then `contentId`, then `id`

**Example**

```html
<dbmulti>{
  "filter": [
    {"__typename": {"S": "article"}},
    {"forWebsite": {"BOOL": true}}
  ],
  "limit": 3,
  "template": "<a href='article-<dbitem>slug</dbitem>.html'><h2><dbitem>headline</dbitem></h2></a>"
}</dbmulti>
```

</details>

<details>
  <summary><code>&lt;dbmultifile&gt;</code> - generate one output file per content item</summary>

**Action**

Turns one source template into multiple output files. The content items are selected by filter, and each item produces one rendered file.

**Syntax**

```html
<dbmultifile>{
  "filenamesuffix": "slug",
  "filter": [
    {"__typename": {"S": "article"}}
  ],
  "limit": 10
}</dbmultifile>
<!doctype html>
<html>
  <body>
    <h1><dbmultifileitem>headline</dbmultifileitem></h1>
  </body>
</html>
```

Supported JSON properties:

- `filenamesuffix` required: field whose value becomes the filename suffix
- `filter` required: array of legacy DynamoDB-style filter clauses
- `filtertype` optional: `equals` or `contains`, default is `equals`
- `limit` optional: maximum number of files to generate

Rules:

- `dbmultifile` must be the first non-whitespace construct in the file
- the control block itself is not part of the output
- generated filenames follow the pattern `<basename>-<suffix>.<ext>`
- the suffix must not be empty and must not contain `/`, `\\`, or `:`
- suffixes must be unique within that template

**Example**

If the source file is `article.html` and the current item has `"slug": "first-article"`, the generated output becomes `article-first-article.html`.

```html
<dbmultifile>{
  "filenamesuffix": "slug",
  "filter": [
    {"__typename": {"S": "article"}}
  ]
}</dbmultifile>
<article>
  <h1><dbmultifileitem>headline</dbmultifileitem></h1>
</article>
```

</details>

<details>
  <summary><code>&lt;dbitem&gt;</code> - print one field of the current content item</summary>

**Action**

Reads one field from the current content item. This works inside `dbmulti` templates and inside `dbmultifile` bodies.

**Syntax**

```html
<dbitem>headline</dbitem>
```

Special field names:

- `__typename`
- `contentId`
- `id`
- `locale`
- `tenant`
- `_version`
- `_lastChangedAt`

For the field name `content`, S3TE again prefers `content&lt;lang&gt;` over `content`.

If the field value is a string array, S3TE serializes it as concatenated HTML links.

**Example**

```html
<dbmulti>{
  "filter": [{"__typename": {"S": "article"}}],
  "template": "<article><h2><dbitem>headline</dbitem></h2><div><dbitem>content</dbitem></div></article>"
}</dbmulti>
```

</details>

<details>
  <summary><code>&lt;dbmultifileitem&gt;</code> - print or transform fields inside a <code>dbmultifile</code> body</summary>

**Action**

Reads one field from the current content item and can apply one transformation mode. It is primarily meant for `dbmultifile` bodies, but works wherever a current content item exists.

**Syntax**

Simple field output:

```html
<dbmultifileitem>headline</dbmultifileitem>
```

JSON command mode:

```html
<dbmultifileitem>{"field":"content","limit":160}</dbmultifileitem>
```

Supported JSON properties:

- `field` required
- `limit` optional: truncate text to a maximum length and append `...`
- `limitlow` optional: choose a random length between `limitlow` and `limit`
- `format` optional: currently only `date`
- `locale` optional: used with `format: "date"`
- `divideattag` optional: cut a section out of the field value
- `startnumber` optional: 1-based occurrence number for the divide start
- `endnumber` optional: 1-based occurrence number for the divide end

Only one transform mode is allowed at a time:

- limit mode: `limit` with optional `limitlow`
- date mode: `format: "date"`
- divide mode: `divideattag`

Date mode formats `de` as `dd.mm.yyyy`. All other locales currently format as `mm/dd/yyyy`.

**Examples**

Simple field output:

```html
<dbmultifileitem>headline</dbmultifileitem>
```

Truncated teaser text:

```html
<dbmultifileitem>{"field":"content","limit":160}</dbmultifileitem>
```

Date formatting:

```html
<dbmultifileitem>{"field":"publishedAt","format":"date","locale":"de"}</dbmultifileitem>
```

Extract one section from a larger HTML field:

```html
<dbmultifileitem>{
  "field":"content",
  "divideattag":"<h2>",
  "startnumber":2,
  "endnumber":3
}</dbmultifileitem>
```

</details>

## Optional: Sitemap

You do not need `sitemap.xml` automation to use S3TE. If you want it, S3TE can maintain one `sitemap.xml` per published output bucket through a dedicated Lambda, just like the older 2.x generation.

<details>
  <summary>Enable sitemap maintenance</summary>

Add this block to `s3te.config.json`:

```json
"integrations": {
  "sitemap": {
    "enabled": true,
    "environments": {
      "dev": {
        "enabled": false
      }
    }
  }
}
```

The top-level `enabled` acts as the default. `integrations.sitemap.environments.<env>.enabled` can override that for a single environment.

If you prefer the CLI path, this does the same retrofit:

```bash
npx s3te migrate --enable-sitemap --write
npx s3te migrate --env test --enable-sitemap --write
```

After enabling or disabling `sitemap`, redeploy the affected environment once:

```bash
npx s3te deploy --env prod
```

</details>

<details>
  <summary>What the sitemap feature does</summary>

When `sitemap` is enabled for an environment, S3TE adds one `sitemap-updater` Lambda to that environment stack and wires every output bucket to it for HTML create/delete events.

The Lambda maintains `sitemap.xml` directly inside the same output bucket:

- one sitemap per variant/language output bucket
- only published HTML files are tracked
- `404.html` is ignored
- `index.html` becomes `https://example.com/`
- nested `news/index.html` becomes `https://example.com/news/`
- regular pages such as `about.html` stay `https://example.com/about.html`

Because the trigger sits on the output bucket, the sitemap also stays correct when HTML is regenerated from Webiny content changes in AWS. Asset-only changes do not affect it.

</details>

## Optional: Webiny CMS

You do not need Webiny to use S3TE. Start with plain HTML first. Add Webiny only when editors should maintain content in a CMS instead of editing local JSON files under `offline/content/`.

The supported target for this optional path is Webiny 6.x on its standard AWS deployment model.

Important for the Webiny path: S3TE does not turn on DynamoDB Streams on your Webiny table for you. You must enable the stream manually on the Webiny source table. S3TE uses that stream as the trigger source for CMS-driven rerendering.

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
3. Manually enable DynamoDB Streams on that Webiny table before the first S3TE deploy with Webiny enabled.
   Use `NEW_AND_OLD_IMAGES`.
   Without that stream, `s3te deploy --env <name>` cannot wire the Webiny trigger and fails because the table has no `LatestStreamArn`.
4. Upgrade your existing S3TE config for Webiny:

```bash
npx s3te migrate --enable-webiny --webiny-source-table webiny-1234567 --webiny-tenant root --webiny-model article --write
```

`staticContent` and `staticCodeContent` are kept automatically. Add `--webiny-model` once per custom model you want S3TE to mirror.

`--webiny-model article` means:

- `article` is the technical Webiny model ID, not the human-readable label shown in the CMS UI.
- S3TE adds that model ID to `integrations.webiny.relevantModels` in `s3te.config.json`.
- Only Webiny stream records whose model is listed in `relevantModels` are mirrored into the S3TE content table and can trigger rerendering.
- If you omit `--webiny-model`, only the built-in defaults `staticContent` and `staticCodeContent` are mirrored.
- You can pass the flag multiple times for multiple models, for example `--webiny-model article --webiny-model news --webiny-model event`.

That makes the migration example above equivalent to a config that contains:

```json
"relevantModels": ["article", "staticContent", "staticCodeContent"]
```

Use this for every Webiny model whose entries should be available to S3TE template commands like `dbitem`, `dbmulti`, `dbmultifile`, `dbmultifileitem`, or `dbpart`.

If different environments should read from different Webiny installations or tenants, run the migration per environment:

```bash
npx s3te migrate --env test --enable-webiny --webiny-source-table webiny-test-1234567 --webiny-tenant preview --write
npx s3te migrate --env prod --enable-webiny --webiny-source-table webiny-live-1234567 --webiny-tenant root --write
```

5. Verify again that DynamoDB Streams are enabled on the Webiny source table with `NEW_AND_OLD_IMAGES`.
   You enable this manually in the AWS console on the Webiny DynamoDB table under `Exports and streams`.
   S3TE creates the Lambda event source mapping during deploy, but it does not create or enable the table stream itself.
6. If your S3TE language keys are not identical to your Webiny locales, add `webinyLocale` per language in `s3te.config.json`, for example `"en": { "webinyLocale": "en-US" }`.
7. If your Webiny installation hosts multiple tenants, keep `integrations.webiny.tenant` set so S3TE only mirrors the intended tenant.
8. Check the project again:

```bash
npx s3te doctor --env prod
```

9. Redeploy the existing S3TE environment:

```bash
npx s3te deploy --env prod
```

That deploy updates the existing environment stack and adds the Webiny mirror resources to it. You do not need a fresh S3TE installation. After that, Webiny content changes flow through the deployed AWS resources automatically; only template or asset changes still need `s3te sync --env <name>`.

Manual versus automatic responsibilities in this step:

- Manual: enable DynamoDB Streams on the Webiny source table
- Automatic during `s3te deploy`: read `LatestStreamArn`, create the Lambda event source mapping, and wire the S3TE Webiny mirror Lambda into the environment stack

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

The content-driven tags are documented in [Template Commands](#template-commands), section [Webiny Features](#webiny-features).
