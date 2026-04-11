# S3TemplateEngine Rewrite - Konfiguration

## Ziel

`s3te.config.json` ist die einzige kanonische Projektkonfiguration. Sie beschreibt Projektname, Umgebungen, Varianten, Sprachen, Rendering-Regeln, AWS-Ressourcen und optionale Integrationen.

Diese Datei ist:

- Eingabe fuer `s3te init`, `validate`, `render`, `package`, `deploy` und `migrate`
- die einzige Nutzer-konfigurierbare Laufzeitquelle fuer Varianten und Sprachen
- strikt validiert, bevor Rendering oder Deployment startet

Das maschinenlesbare Strukturschema liegt in [configuration-schema.md](./configuration-schema.md) und in `schemas/s3te.config.schema.json`. Das durch `s3te init` in Nutzerprojekten abgelegte Exemplar liegt standardmaessig unter `offline/schemas/s3te.config.schema.json`.

```mermaid
flowchart TD
  A[s3te.config.json lesen] --> B[JSON Schema validieren]
  B --> C[Defaults anwenden]
  C --> D[platzhalterbasierte Werte ableiten]
  D --> E[Cross-Field-Regeln validieren]
  E --> F[ResolvedProjectConfig]
```

## Grundregeln

1. Die Datei heisst immer `s3te.config.json`.
2. Das Format ist UTF-8 JSON ohne Kommentare und ohne Trailing Commas.
3. Unbekannte Properties sind ungueltig.
4. Alle Pfade in der Konfiguration sind relativ zum Projekt-Root.
5. Defaults werden vor Cross-Field-Validierung angewendet.
6. Ableitungen aus dem Umgebungsnamen oder Variantennamen sind deterministisch und dokumentiert.

## Normalisierungsreihenfolge

Die Zielimplementierung muss die Konfiguration in dieser Reihenfolge aufbereiten:

1. JSON parsen.
2. JSON Schema validieren.
3. statische Defaults anwenden
4. abgeleitete Defaults anwenden, die vom Schluessel abhangen
5. Platzhalter aufloesen
6. Cross-Field-Regeln validieren
7. `ResolvedProjectConfig` an Core und Adapter uebergeben

## Kanonisches Beispiel

```json
{
  "$schema": "./offline/schemas/s3te.config.schema.json",
  "configVersion": 1,
  "project": {
    "name": "mywebsite"
  },
  "environments": {
    "dev": {
      "awsRegion": "eu-central-1",
      "stackPrefix": "DEV",
      "certificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/aaaa-bbbb",
      "route53HostedZoneId": "Z1234567890"
    },
    "prod": {
      "awsRegion": "eu-central-1",
      "stackPrefix": "PROD",
      "certificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/eeee-ffff",
      "route53HostedZoneId": "Z1234567890"
    }
  },
  "rendering": {
    "minifyHtml": true,
    "renderExtensions": [".html", ".htm", ".part"],
    "outputDir": "offline/S3TELocal/preview",
    "maxRenderDepth": 50
  },
  "variants": {
    "website": {
      "sourceDir": "app/website",
      "partDir": "app/part",
      "defaultLanguage": "en",
      "routing": {
        "indexDocument": "index.html",
        "notFoundDocument": "404.html"
      },
      "languages": {
        "en": {
          "baseUrl": "example.com",
          "targetBucket": "{env}-website-{project}",
          "cloudFrontAliases": ["example.com", "www.example.com"],
          "webinyLocale": "en-US"
        },
        "de": {
          "baseUrl": "example.de",
          "targetBucket": "{env}-website-{project}-de",
          "cloudFrontAliases": ["example.de", "www.example.de"],
          "webinyLocale": "de-DE"
        }
      }
    },
    "app": {
      "sourceDir": "app/app",
      "partDir": "app/part",
      "defaultLanguage": "en",
      "languages": {
        "en": {
          "baseUrl": "app.example.com",
          "targetBucket": "{env}-app-{project}",
          "cloudFrontAliases": ["app.example.com"]
        }
      }
    }
  },
  "aws": {
    "codeBuckets": {
      "website": "{env}-website-code-{project}",
      "app": "{env}-app-code-{project}"
    },
    "dependencyStore": {
      "tableName": "{stackPrefix}_s3te_dependencies_{project}"
    },
    "contentStore": {
      "tableName": "{stackPrefix}_s3te_content_{project}",
      "contentIdIndexName": "contentid"
    },
    "invalidationStore": {
      "tableName": "{stackPrefix}_s3te_invalidations_{project}",
      "debounceSeconds": 60
    },
    "lambda": {
      "runtime": "nodejs22.x",
      "architecture": "arm64"
    }
  },
  "integrations": {
    "webiny": {
      "enabled": false,
      "sourceTableName": "webiny-1234567",
      "mirrorTableName": "{stackPrefix}_s3te_content_{project}",
      "tenant": "root",
      "relevantModels": ["staticContent", "staticCodeContent", "article"]
    }
  }
}
```

## Root-Properties

### `$schema`

- optional
- Standardwert: `"./offline/schemas/s3te.config.schema.json"`
- nur fuer Editor- und Tooling-Unterstuetzung

### `configVersion`

- optional
- Standardwert: `1`
- steuert spaetere Migrationen ueber `s3te migrate`

### `project`

Pflichtblock mit:

- `name`: Pflicht, lowercase alnum plus Bindestrich, Regex `^[a-z0-9-]+$`

Optionale Felder:

- `displayName`: optional, frei fuer README- und Scaffold-Texte

### `environments`

Pflichtblock. Jeder Key ist ein logischer Umgebungsname wie `dev`, `stage`, `prod`.

Pflichtfelder pro Umgebung:

- `awsRegion`
- `certificateArn`

Optionale Felder pro Umgebung:

- `stackPrefix`
- `route53HostedZoneId`

Defaults:

- `stackPrefix`: uppercased Umgebungsname, Bindestriche werden zu `_`

Beispiele:

- `dev` -> `DEV`
- `stage-eu` -> `STAGE_EU`

### `rendering`

Optionaler Block.

Defaults:

- `minifyHtml`: `true`
- `renderExtensions`: `[".html", ".htm", ".part"]`
- `outputDir`: `"offline/S3TELocal/preview"`
- `maxRenderDepth`: `50`

Fest verdrahtete, nicht konfigurierbare Regel:

- fehlende Partials, Sprachinhalte und Content-Referenzen werden immer als leerer String gerendert und als Warnung protokolliert

### `variants`

Pflichtblock. Jeder Key ist ein Variantenname wie `website`, `app` oder `admin`.

Pflichtfelder pro Variante:

- `defaultLanguage`
- `languages`

Optionale Felder pro Variante:

- `sourceDir`
- `partDir`
- `routing`

Defaults:

- `sourceDir`: `app/<variant>`
- `partDir`: `app/part`
- `routing.indexDocument`: `index.html`
- `routing.notFoundDocument`: `404.html`

### `aws`

Optionaler Block mit AWS-Adapter-Details. Fehlt der Block, muessen alle hier genannten Defaults angewendet werden.

Defaults:

- `codeBuckets.<variant>`: `{env}-{variant}-code-{project}`
- `dependencyStore.tableName`: `{stackPrefix}_s3te_dependencies_{project}`
- `contentStore.tableName`: `{stackPrefix}_s3te_content_{project}`
- `contentStore.contentIdIndexName`: `contentid`
- `invalidationStore.tableName`: `{stackPrefix}_s3te_invalidations_{project}`
- `invalidationStore.debounceSeconds`: `60`
- `lambda.runtime`: `nodejs22.x`
- `lambda.architecture`: `arm64`

### `integrations`

Optionaler Block.

`integrations.webiny` Defaults:

- `enabled`: `false`
- `mirrorTableName`: `{stackPrefix}_s3te_content_{project}`
- `relevantModels`: `["staticContent", "staticCodeContent"]`
- `tenant`: nicht gesetzt

Wenn `enabled = true`, ist `sourceTableName` Pflicht.

Fuer Webiny 6.x gilt zusaetzlich:

- S3TE spiegelt nur publizierte Inhalte
- S3TE kann auf einen einzelnen Webiny-Tenant eingeschraenkt werden
- S3TE matcht lokalisierte Inhalte ueber `webinyLocale`
- die Referenzimplementierung setzt eine Standard-Webiny-AWS-Installation mit DynamoDB-basiertem Content-Store voraus

Webiny darf bewusst spaeter nachgeruestet werden:

1. S3TE zuerst ohne Webiny deployen
2. spaeter Webiny separat installieren
3. danach `integrations.webiny` aktivieren
4. anschliessend denselben Environment-Stack erneut deployen

Die Content-Tabelle des S3TE-Stacks existiert in V1 immer. Das Nachruesten von Webiny fuegt daher nur die Spiegelungs-Ressourcen und deren Event-Anbindung hinzu; es erfordert keinen kompletten Neuaufbau des Projekts.

## Sprachdefinition

Jede Sprache unter `variants.<variant>.languages` besitzt:

- `baseUrl`: Pflicht
- `targetBucket`: optional, Default siehe unten
- `cloudFrontAliases`: Pflicht, mindestens ein Alias
- `webinyLocale`: optional, fuer Webiny 6.x die zugehoerige Webiny-Locale wie `en-US`

Default fuer `targetBucket`, wenn nicht explizit gesetzt:

1. falls die Variante genau eine Sprache besitzt: `{env}-{variant}-{project}`
2. falls die Sprache die `defaultLanguage` der Variante ist: `{env}-{variant}-{project}`
3. sonst: `{env}-{variant}-{project}-{lang}`

Es wird bewusst kein Default fuer `cloudFrontAliases` abgeleitet, damit kein implizites `www.`-Verhalten entsteht.

Default fuer `webinyLocale`, wenn nicht explizit gesetzt:

- der Sprach-Key selbst

## Platzhalter

Platzhalter duerfen in String-Werten verwendet werden. Sie werden immer pro Zielkontext aufgeloest.

Verfuegbare Platzhalter:

- `{env}`: Umgebungsname, zum Beispiel `dev`
- `{stackPrefix}`: abgeleiteter oder gesetzter Prefix, zum Beispiel `DEV`
- `{project}`: `project.name`
- `{variant}`: Variantenname, zum Beispiel `website`
- `{lang}`: Sprachcode, zum Beispiel `de`

Beispiele:

- `{env}-website-code-{project}`
- `{stackPrefix}_s3te_content_{project}`
- `{env}-{variant}-{project}-{lang}`

Nicht erlaubte Platzhalter:

- unbekannte Tokens
- geschachtelte Platzhalter
- Platzhalter in Property-Namen

## Cross-Field-Regeln

Diese Regeln sind zusaetzlich zum JSON Schema Pflicht:

1. `project.name` muss AWS-kompatibel fuer Bucket-Namen sein.
2. jeder Umgebungsname muss eindeutig sein
3. jeder Variantenname muss eindeutig sein
4. jeder Sprachcode ist pro Variante eindeutig
5. jede Variante besitzt mindestens eine Sprache
6. `defaultLanguage` muss in `languages` existieren
7. jede aufgeloeste `targetBucket`-Definition ist global eindeutig
8. jede aufgeloeste `codeBuckets`-Definition ist global eindeutig
9. `certificateArn` muss ein ACM-ARN aus `us-east-1` sein
10. `route53HostedZoneId` darf nur gesetzt sein, wenn mindestens ein Alias existiert
11. `sourceDir` und `partDir` muessen lokal existieren, sobald `render`, `test`, `package` oder `deploy` gestartet wird
12. wenn `integrations.webiny.enabled = true`, muessen `aws.contentStore` und `sourceTableName` aufgeloest werden koennen
13. wenn `integrations.webiny.enabled = true` und mehrere Webiny-Tenants dieselbe Tabelle teilen, soll `integrations.webiny.tenant` gesetzt werden

## Abgeleitete Runtime-Werte

Die AWS-Referenzimplementierung darf aus `ResolvedProjectConfig` weitere Runtime-Werte erzeugen. Diese Werte werden nicht in `s3te.config.json` gespeichert:

- aufgeloeste Distribution IDs nach dem Deploy
- Stack-Outputs
- Lambda-Funktionsnamen
- interne Runtime-Manifeste fuer Scheduler und Render Worker

Diese Ableitungen sind Adapter-Interna und kein Teil der Projekt-API.

## Minimalbeispiel fuer ein Einsprach-Projekt

```json
{
  "project": {
    "name": "mysite"
  },
  "environments": {
    "dev": {
      "awsRegion": "eu-central-1",
      "certificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/aaaa-bbbb"
    }
  },
  "variants": {
    "website": {
      "defaultLanguage": "en",
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

Mit Defaults wird daraus mindestens:

- `stackPrefix = DEV`
- `sourceDir = app/website`
- `partDir = app/part`
- `targetBucket = dev-website-mysite`
- `codeBuckets.website = dev-website-code-mysite`
- `outputDir = offline/S3TELocal/preview`

## Verzeichnisannahme

Ohne explizite Overrides geht die Konfiguration von dieser Struktur aus:

```text
project/
  s3te.config.json
  app/
    part/
    website/
  offline/
    content/
    schemas/
```

Weitere Projektdateien fuer CLI, Tests und Packaging sind in [local-development.md](./local-development.md) und [cli-contract.md](./cli-contract.md) beschrieben.
