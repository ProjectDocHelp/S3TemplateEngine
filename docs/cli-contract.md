# S3TemplateEngine Rewrite - CLI-Vertrag

## Ziel

Dieses Dokument definiert das beobachtbare Verhalten der CLI. Es beschreibt:

- globale Optionen
- Kommandos
- Exit Codes
- Standardpfade
- JSON-Ausgaben

Der Nutzervertrag ist absichtlich stabiler als interne Implementierungsdetails.

## Binary und Aufrufmodell

- Paketname: `@projectdochelp/s3te`
- Binary: `s3te`
- lokaler Aufruf: `npx s3te <command>`
- globaler Aufruf: `s3te <command>`

## Globale Regeln

### Projektauflosung

Ohne Override arbeitet die CLI im aktuellen Verzeichnis.

Globale Optionen:

- `--cwd <path>`: Projekt-Root ueberschreiben
- `--config <path>`: Pfad zu `s3te.config.json` ueberschreiben
- `--json`: maschinenlesbaren Report auf `stdout` ausgeben
- `--profile <name>`: AWS-Profil fuer AWS-nahe Kommandos waehlen

### Ausgabeform

Standard:

- menschenlesbare Konsole

Mit `--json`:

- exakt ein JSON-Dokument auf `stdout`
- Fehlertexte und Debug-Logs gehen nicht in `stdout`, sondern nach `stderr`

### Exit Codes

- `0`: Erfolg
- `1`: Aufruffehler oder unerwarteter interner Fehler
- `2`: Konfigurations- oder Template-Validierungsfehler
- `3`: Umgebung oder Authentifizierung nicht bereit
- `4`: Deployment oder Packaging fehlgeschlagen

## Standardverzeichnisse

- lokaler Render-Output: `offline/S3TELocal/preview/<env>/<variant>/<lang>/`
- Packaging-Output: `offline/IAAS/package/<env>/`
- lokaler Runtime-Manifest-Export nach erfolgreichem Deploy: `offline/IAAS/package/<env>/runtime-manifest.json`

## `s3te init`

Zweck:

- neues Projekt scaffolden

Aufruf:

```bash
s3te init
s3te init --dir mysite --project-name mysite --lang en --variant website
```

Optionen:

- `--dir <path>`
- `--project-name <name>`
- `--variant <name>`
- `--lang <code>`
- `--base-url <host>`
- `--force`

Pflichtverhalten:

1. erstellt ein lauffaehiges Grundprojekt
2. schreibt `s3te.config.json`
3. legt `app/part/` an
4. legt je Variante ein Quellverzeichnis unter `app/` an
5. legt `offline/content/`, `offline/schemas/` und `offline/tests/` an
6. legt `.github/workflows/s3te-sync.yml` als GitHub-Workflow fuer Code-Bucket-Sync an
7. legt `.vscode/extensions.json` an
8. darf gefahrlos mehrfach im selben Projekt ausgefuehrt werden
9. ergaenzt eine bereits vorhandene `package.json` um fehlende S3TE-Standardfelder und -Skripte
10. ergaenzt eine bereits vorhandene `s3te.config.json` um fehlende Scaffold-Defaults
11. aktualisiert die von S3TE erzeugte Schema-Datei auf die mitgelieferte aktuelle Version
12. normalisiert `--base-url` auf einen Hostnamen, auch wenn eine volle URL uebergeben wird
13. belaesst andere bereits vorhandene Scaffold-Dateien unveraendert, sofern kein `--force` gesetzt ist

Mindestens erzeugte Struktur:

```text
project/
  package.json
  s3te.config.json
  .github/
    workflows/
      s3te-sync.yml
  app/
    part/
    website/
  offline/
    content/
    schemas/
    tests/
  .vscode/
    extensions.json
```

## `s3te validate`

Zweck:

- Konfiguration und Templates pruefen, ohne zu rendern

Aufruf:

```bash
s3te validate
s3te validate --env dev
```

Optionen:

- `--env <name>` optional, mehrfach erlaubt
- `--warnings-as-errors`

Pruefungen:

1. JSON Schema und Defaults
2. Cross-Field-Konflikte
3. Platzhalteraufloesung
4. Pfadregeln
5. Template-Syntax
6. ungueltige `dbmultifile`- und `dbmultifileitem`-Kombinationen

JSON-Report:

```ts
CliReport<ValidateReport>
```

## `s3te render`

Zweck:

- lokal ohne AWS rendern

Aufruf:

```bash
s3te render --env dev
s3te render --env dev --variant website --lang en --entry website/index.html
```

Optionen:

- `--env <name>` Pflicht
- `--variant <name>` optional
- `--lang <code>` optional
- `--entry <sourceKey>` optional
- `--output-dir <path>` optional
- `--stdout` optional, nur bei genau einem gerenderten Textartefakt erlaubt
- `--warnings-as-errors`

Pflichtverhalten:

1. validiert die Konfiguration vor dem Rendern
2. rendert standardmaessig in `offline/S3TELocal/preview/<env>/<variant>/<lang>/`
3. rendert ohne `--entry` alle renderbaren Dateien der Auswahl
4. kopiert nicht renderbare Assets in den lokalen Output
5. loescht lokal veraltete generierte `dbmultifile`-Outputs innerhalb des Zielordners
6. gibt bei `--stdout` nur den Artefakt-Body aus

JSON-Report:

```ts
CliReport<RenderReport>
```

## `s3te test`

Zweck:

- Projekttests auf Basis des Testkits ausfuehren

Aufruf:

```bash
s3te test
s3te test --env dev
```

Optionen:

- `--env <name>` optional
- `--update-snapshots`

Pflichtverhalten:

1. validiert die Konfiguration
2. startet den projektweiten Testlauf
3. bindet das Subpath-Testkit `@projectdochelp/s3te/testkit` an den lokalen Render-Core an

## `s3te package`

Zweck:

- deterministische Deployment-Artefakte bauen

Aufruf:

```bash
s3te package --env dev
```

Optionen:

- `--env <name>` Pflicht
- `--out-dir <path>` optional
- `--clean`

Pflichtverhalten:

1. validiert Projekt und Konfiguration
2. erzeugt Lambda-Artefakte deterministisch
3. schreibt genau ein CloudFormation-Template fuer die Umgebung
4. schreibt ein Packaging-Manifest mit Artefakt- und Template-Informationen

JSON-Report:

```ts
CliReport<PackageReport>
```

## `s3te sync`

Zweck:

- aktuelle Projektquellen in die Code-Buckets einer bestehenden Umgebung synchronisieren

Aufruf:

```bash
s3te sync --env dev
s3te sync --env prod
```

Optionen:

- `--env <name>` Pflicht
- `--out-dir <path>` optional

Pflichtverhalten:

1. laedt und validiert die Projektkonfiguration
2. bereitet die zu synchronisierenden Quellen im S3TE-Code-Bucket-Layout vor
3. synchronisiert `sourceDir` und `partDir` jeder Variante in den jeweiligen Code-Bucket
4. verwendet `aws s3 sync --delete`, damit geloeschte Quellen auch als Remove-Events ankommen

JSON-Report:

```ts
CliReport<SyncReport>
```

## `s3te deploy`

Zweck:

- Infrastruktur ausrollen und Projektquellen in Code-Buckets synchronisieren

Aufruf:

```bash
s3te deploy --env dev
s3te deploy --env prod
```

Optionen:

- `--env <name>` Pflicht
- `--feature <name>` optional, mehrfach erlaubt
- `--package-dir <path>` optional
- `--plan` optional, erzeugt nur Deploy-Plan und Change Set
- `--no-sync` optional, deployed nur Infrastruktur

Pflichtverhalten:

1. laedt und validiert die Projektkonfiguration
2. fuehrt bei Bedarf `package` aus
3. erstellt fuer den eigentlichen Deploy-Lauf einen temporaeren CloudFormation-Stack fuer fluechtige Packaging-Ressourcen
4. deployed genau einen persistenten CloudFormation-Stack fuer die Umgebung
5. aktiviert alle Features, die in der aufgeloesten Projektkonfiguration eingeschaltet sind
6. synchronisiert Projektquellen mit demselben Source-Sync-Pfad wie `s3te sync` in alle konfigurierten Code-Buckets
7. aktualisiert das Runtime-Manifest ueber einen zweiten Stack-Update im Environment-Stack
8. entfernt den temporaeren Packaging-Stack am Ende des echten Deploy-Laufs wieder

Ausnahme:

- bei `--plan` bleibt der temporaere Packaging-Stack bestehen, weil das Change Set weiterhin auf dessen Artefakte verweist

Aktivierte Features in V1:

- `webiny`
- `sitemap`

JSON-Report:

```ts
CliReport<DeployReport>
```

## `s3te doctor`

Zweck:

- lokale Voraussetzungen und haeufige Projektfehler pruefen

Aufruf:

```bash
s3te doctor
s3te doctor --env prod
```

Optionen:

- `--env <name>` optional

Prueft mindestens:

1. Node.js-Version
2. Schreibrechte im Projekt
3. Vorhandensein von `s3te.config.json`
4. aufloesbare Template-Pfade
5. AWS-Credentials fuer die gewaehlte Umgebung
6. AWS CLI Installation fuer die dokumentierte Noob-Setup-Route

## `s3te migrate`

Zweck:

- aeltere Projektdateien auf den aktuellen S3TE-Stand bringen

Aufruf:

```bash
s3te migrate
s3te migrate --to 1
s3te migrate --enable-webiny --webiny-source-table webiny-1234567 --webiny-tenant root --write
s3te migrate --env test --enable-webiny --webiny-source-table webiny-test-1234567 --write
```

Optionen:

- `--to <configVersion>`
- `--dry-run`
- `--write`
- `--env <name>`
- `--enable-webiny`
- `--disable-webiny`
- `--webiny-source-table <table>`
- `--webiny-tenant <tenant>`
- `--webiny-model <model>` mehrfach erlaubt

Pflichtverhalten:

1. erkennt fehlende oder alte `configVersion`
2. kann optionale Retrofit-Aenderungen wie das nachtraegliche Aktivieren von Webiny global oder fuer ein einzelnes Environment in die Projektkonfiguration schreiben
3. schreibt nie ungefragt in Projektdateien ohne `--write`
4. gibt nachvollziehbare Migrationshinweise aus

## JSON-Report-Regeln

Alle JSON-Reports folgen dem Schema:

```json
{
  "command": "render",
  "success": true,
  "durationMs": 1234,
  "warnings": [],
  "errors": [],
  "data": {}
}
```

Pflicht:

- `warnings` und `errors` sind immer Arrays
- bei Fehlern bleibt `stdout` gueltiges JSON, wenn `--json` gesetzt wurde

## AWS-Credentials

Die CLI nutzt fuer AWS-nahe Kommandos diese Prioritaet:

1. explizites `--profile`
2. Standard AWS Credential Chain

Die CLI darf keine proprietaere Credential-Datei einfuehren.

## Nicht-Ziele der CLI in V1

- kein interaktiver Wizard im Terminal
- keine GUI
- kein Daemon oder Watch-Server
- keine Verpflichtung zu einem bestimmten Editor ausser den dokumentierten VSCode-Empfehlungen
