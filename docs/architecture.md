# S3TemplateEngine – Zielarchitektur (Ultra Lightweight, Serverless)

## 1. Architekturprinzipien
1. **Serverless First**: Betrieb in AWS Lambda/S3/CloudFront/DynamoDB.
2. **Separation of Concerns**: Core-Logik ist AWS-unabhängig.
3. **Minimalismus**: Keine Containerpflicht, kein schweres Framework.
4. **Automatisierung vor Handarbeit**: CLI statt manueller Console-Schritte.

## 2. Zielstruktur

```text
repo/
  docs/
    requirements.md
    architecture.md
  packages/
    core/           # Parser + Renderer (ohne AWS SDK)
    aws-adapter/    # Lambda Handler + AWS Integrationsschicht
    cli/            # Setup/Validate/Package/Deploy/Migrate
    testkit/        # Fixtures, Mocks, Assertions
  infra/
    cloudformation/
      base.yaml
      variation.yaml
      language.yaml
      webiny.yaml
  examples/
    minimal-site/
```

## 3. Komponenten

### 3.1 `@s3te/core`
**Verantwortung**
- Parse und Render der S3TE-Tags.
- Deterministisches Rendering (gleiches Input => gleiches Output).

**Schnittstelle (Beispiel)**
- `render(template, context, options) -> { html, metadata }`

**Wichtig**
- Keine AWS-Calls.
- Vollständig lokal testbar.

### 3.2 `@s3te/aws-adapter`
**Verantwortung**
- Event-Handling für S3/Lambda.
- Lesen/Schreiben von S3-Objekten.
- DDB-Zugriffe für Abhängigkeiten/Metadaten.
- Triggern von Invalidation-Workflow.

**Wichtig**
- Nutzt `@s3te/core` als Library.
- Enthält nur Integrationslogik, keine Template-Logik.

### 3.3 `@s3te/cli`
**Verantwortung**
- Projektbootstrap und Konfigurationsvalidierung.
- Packaging von Lambda-ZIPs.
- Deployment orchestration über CloudFormation.
- Migrations- und Upgrade-Kommandos.

**Pflicht-Kommandos (MVP)**
- `s3te init`
- `s3te validate`
- `s3te test`
- `s3te package`
- `s3te deploy`
- `s3te migrate`

### 3.4 `@s3te/testkit`
**Verantwortung**
- Standardisierte lokale Tests (Render/Snapshots/A11y).
- AWS-Mock-Utilities.
- Referenz-Fixtures für typische S3TE-Patterns.

## 4. Konfigurationsmodell

### 4.1 Zentrale Projektdatei `s3te.config.json`
Beispiel:

```json
{
  "project": "mywebsite",
  "environments": {
    "dev": {
      "region": "eu-central-1",
      "domain": "dev.example.com"
    },
    "prod": {
      "region": "eu-central-1",
      "domain": "example.com"
    }
  },
  "variants": {
    "website": {
      "languages": {
        "en": { "bucket": "prod-website-mywebsite", "baseurl": "example.com" },
        "de": { "bucket": "prod-website-mywebsite-de", "baseurl": "example.de" }
      }
    },
    "app": {
      "languages": {
        "en": { "bucket": "prod-app-mywebsite", "baseurl": "app.example.com" }
      }
    }
  },
  "features": {
    "webiny": false,
    "sitemap": true
  }
}
```

## 5. Deploymentfluss (ohne Docker)

1. `s3te validate`
2. `s3te test`
3. `s3te package` (ZIP-Artefakte erstellen)
4. `s3te deploy --env dev|stage|prod`

Optional:
- `s3te deploy --feature webiny`
- `s3te deploy --variant app`
- `s3te deploy --lang de`

## 6. Update- und Migrationsstrategie

### 6.1 Versionierung
- SemVer pro Paket (`core`, `aws-adapter`, `cli`, `testkit`).

### 6.2 Upgradepfad
- `s3te doctor` prüft Projektzustand.
- `s3te migrate` transformiert Konfiguration/Defaults.
- `s3te changelog` zeigt relevante Breaking Changes.

### 6.3 Rollback
- Artefaktversionen in S3 versioniert speichern.
- CloudFormation Change Sets vor Apply.
- `s3te rollback --to <version>` als CLI-Ziel.

## 7. Sicherheits- und Qualitätsleitplanken
- Least-Privilege IAM Policies statt pauschaler FullAccess.
- Aktuelle TLS-Mindestversionen in CloudFront.
- Pflichtchecks in CI: lint, unit, integration, config validate.

## 8. Migrationsplan (inkrementell)

### Phase 1
- Core extrahieren, bestehende Lambda-Handler weiterverwenden.
- CLI für Validate/Package/Deploy bereitstellen.

### Phase 2
- Testkit veröffentlichen und in Beispielprojekt integrieren.
- Konfigurationsmodell standardisieren (`s3te.config.json`).

### Phase 3
- Webiny-/Sitemap-Funktionen als optionale Feature-Module.
- Erweiterte Migrations-/Rollback-Kommandos produktiv setzen.
