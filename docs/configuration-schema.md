# S3TemplateEngine Rewrite - Konfigurationsschema und Defaults

## Ziel

Dieses Dokument beschreibt die normative Struktur von `s3te.config.json`, die Defaultwerte und die Regeln, die zusaetzlich zum JSON Schema gelten.

Der maschinenlesbare Standard liegt in:

- `schemas/s3te.config.schema.json`

Dieses Dokument ist die menschenlesbare Referenz. Bei Widerspruechen gilt:

1. `configuration.md` fuer Semantik
2. dieses Dokument fuer Struktur und Defaults
3. das JSON Schema fuer maschinenlesbare Validierung

## Strukturuebersicht

```text
Root
  $schema?
  configVersion?
  project
  environments
  rendering?
  variants
  aws?
  integrations?
```

## Defaults

### Root

- `$schema`: `./offline/schemas/s3te.config.schema.json`
- `configVersion`: `1`

### `rendering`

- `minifyHtml`: `true`
- `renderExtensions`: `[".html", ".htm", ".part"]`
- `outputDir`: `offline/S3TELocal/preview`
- `maxRenderDepth`: `50`

### `variants.<variant>`

- `sourceDir`: `app/<variant>`
- `partDir`: `app/part`
- `routing.indexDocument`: `index.html`
- `routing.notFoundDocument`: `404.html`
- `languages.<lang>.webinyLocale`: Sprach-Key selbst, zum Beispiel `en`

### `environments.<env>`

- `stackPrefix`: uppercased Schluesselname mit `_` statt `-`

### `aws`

- `codeBuckets.<variant>`: `{env}-{variant}-code-{project}`
- `dependencyStore.tableName`: `{stackPrefix}_s3te_dependencies_{project}`
- `contentStore.tableName`: `{stackPrefix}_s3te_content_{project}`
- `contentStore.contentIdIndexName`: `contentid`
- `invalidationStore.tableName`: `{stackPrefix}_s3te_invalidations_{project}`
- `invalidationStore.debounceSeconds`: `60`
- `lambda.runtime`: `nodejs22.x`
- `lambda.architecture`: `arm64`

### `integrations.webiny`

- `enabled`: `false`
- `mirrorTableName`: `{stackPrefix}_s3te_content_{project}`
- `relevantModels`: `["staticContent", "staticCodeContent"]`
- `tenant`: nicht gesetzt

## Typregeln

### `project`

```ts
{
  name: string;
  displayName?: string;
}
```

### `environments.<env>`

```ts
{
  awsRegion: string;
  stackPrefix?: string;
  certificateArn: string;
  route53HostedZoneId?: string;
}
```

### `rendering`

```ts
{
  minifyHtml?: boolean;
  renderExtensions?: string[];
  outputDir?: string;
  maxRenderDepth?: number;
}
```

### `variants.<variant>`

```ts
{
  sourceDir?: string;
  partDir?: string;
  defaultLanguage: string;
  routing?: {
    indexDocument?: string;
    notFoundDocument?: string;
  };
  languages: Record<string, {
    baseUrl: string;
    targetBucket?: string;
    cloudFrontAliases: string[];
    webinyLocale?: string;
  }>;
}
```

### `aws`

```ts
{
  codeBuckets?: Record<string, string>;
  dependencyStore?: {
    tableName?: string;
  };
  contentStore?: {
    tableName?: string;
    contentIdIndexName?: string;
  };
  invalidationStore?: {
    tableName?: string;
    debounceSeconds?: number;
  };
  lambda?: {
    runtime?: "nodejs22.x";
    architecture?: "arm64" | "x86_64";
  };
}
```

### `integrations.webiny`

```ts
{
  enabled?: boolean;
  sourceTableName?: string;
  mirrorTableName?: string;
  tenant?: string;
  relevantModels?: string[];
}
```

## Regeln, die das JSON Schema nicht alleine ausdrueckt

1. `stackPrefix` kann aus dem Environment-Key abgeleitet werden.
2. `sourceDir` kann aus dem Variant-Key abgeleitet werden.
3. `targetBucket` kann aus Variant-, Sprach- und Projektkontext abgeleitet werden.
4. `certificateArn` muss in `us-east-1` liegen.
5. `targetBucket`- und `codeBuckets`-Namen muessen nach Platzhalteraufloesung eindeutig sein.
6. `defaultLanguage` muss in der jeweiligen Sprachmenge existieren.
7. Dateipfade muessen innerhalb des Projekts bleiben und duerfen kein `..` enthaelten.
8. `webinyLocale` ist empfohlen, wenn S3TE-Sprachkeys und Webiny-Locale-Codes nicht identisch sind.
9. `tenant` ist empfohlen, wenn dieselbe Webiny-Installation mehrere Tenants hostet.

## Validierungsfehler

`s3te validate` muss mindestens diese Fehlerklassen unterscheiden:

- `CONFIG_SCHEMA_ERROR`
- `CONFIG_DEFAULT_ERROR`
- `CONFIG_PLACEHOLDER_ERROR`
- `CONFIG_CONFLICT_ERROR`
- `CONFIG_PATH_ERROR`

## Auswirkungen auf `s3te init`

`s3te init` muss eine Konfiguration erzeugen, die:

- gegen das JSON Schema gueltig ist
- die hier definierten Defaults nur dort explizit schreibt, wo sie fuer Verstaendlichkeit hilfreich sind
- fuer Noob-Nutzer direkt lesbar bleibt

Konsequenz fuer das Scaffold:

- `sourceDir`, `partDir`, `outputDir` duerfen im Scaffold explizit gesetzt werden, obwohl sie Defaultwerte haben
- `targetBucket` darf ebenfalls explizit geschrieben werden, damit Nutzer S3-Namen nicht erst herleiten muessen
