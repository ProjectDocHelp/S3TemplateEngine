# S3TemplateEngine Rewrite - Technische Basisentscheidungen

## Ziel

Dieses Dokument legt die technische Grundlinie fuer die Neuimplementierung fest. Es reduziert Freiheitsgrade fuer die Implementierung und priorisiert geringe Komplexitaet, wenige Abhaengigkeiten und eine robuste Noob-User-Erfahrung.

## Leitlinien

1. Nutzer von S3TE sollen nur HTML und die dokumentierten CLI-Schritte benoetigen.
2. Interne Implementierungskomplexitaet darf Nutzer nicht nach aussen belasten.
3. V1 bevorzugt Standardbibliothek und AWS-Standarddienste vor Zusatzframeworks.
4. Wo zwischen Komfort fuer Maintainer und Laufzeitkomplexitaet gewaehlt werden muss, hat einfache Laufzeit den Vorrang.

## Festgelegte Technologieentscheidungen

### Sprache und Runtime

- Implementierungssprache: JavaScript
- Node.js-Zielruntime: `nodejs22.x`
- lokales Minimum: Node.js 20
- Modulsystem: ESM

Begruendung:

- JavaScript vermeidet fuer Noob-Projekte einen zusatzlichen Build-Schritt
- Node 22 ist die AWS-Referenzruntime fuer neue Lambda-Deploys
- Node 20 bleibt lokal als Mindestversion fuer CLI und Tests ausreichend
- ESM ist in aktuellen Node-Versionen nativ und vermeidet Doppelwelten aus CJS und ESM

### Paketierung und Build

- genau ein publishbares npm-Paket: `@projectdochelp/s3te`
- interne Modulgrenzen bleiben unter `packages/`
- kein obligatorischer Build-Schritt fuer die Referenzimplementierung
- kein Bundler in V1
- kein Docker fuer Build oder Deploy

Begruendung:

- fuer Nutzer bleibt die Installation auf ein einziges Paket reduziert
- die internen Modulgrenzen halten den Code trotzdem wartbar
- direkt ausfuehrbare ESM-Dateien halten Packaging und Debugging transparent
- kein Bundler reduziert Fehlerbilder, magische Konfiguration und Packaging-Abweichungen

### Test-Stack

- Test-Runner: Node Built-in `node:test`
- Assertions: `node:assert/strict`
- das Subpath-Export `@projectdochelp/s3te/testkit` liefert In-Memory-Repositories, einen Memory-Dependency-Store, sammelnde Output-/Invalidation-Testadapter und Fixture-Helfer

Begruendung:

- keine externe Test-Runtime noetig
- das Testkit bleibt die offizielle S3TE-Schicht fuer Projekttests, ohne ein zweites npm-Paket zu verlangen

### Externe Laufzeit-Abhaengigkeiten

Erlaubt:

- AWS CLI im lokalen Deploy-Pfad
- eine bewusst klein gehaltene Runtime-Abhaengigkeit fuer AWS-Aufrufe in Lambda-Handlern

Erlaubt, wenn fuer deterministische Lambda-ZIPs benoetigt:

- eine kleine interne ZIP-Implementierung ohne Fremdpaket
- AWS SDK v3 Module als gepackte Lambda-Runtime-Abhaengigkeit

Nicht vorgesehen in V1:

- React
- Next.js
- Express
- Babel
- Webpack
- Vite
- ORM
- HTML-Parser-Framework
- externe Minifier-Pakete

### Parsing-Ansatz im Core

- V1 verwendet bewusst einen stringbasierten Tag-Parser
- kein DOM-Parser im Core
- kein AST fuer komplettes HTML

Begruendung:

- die S3TE-Sprache ist klein und literal
- das Legacy-Verhalten ist ebenfalls stringnah
- weniger Abhaengigkeiten und weniger Parser-Magie

### Minifier

- V1-Minifier ist intern implementiert
- keine externe Minifier-Abhaengigkeit
- konservatives Verhalten gemaess [template-language.md](./template-language.md)

### MIME-Type-Erkennung

- kleine interne Mapping-Tabelle
- keine externe MIME-Dependency

### CloudFormation

- ein CloudFormation-Stack pro Umgebung
- keine separaten Zusatz-Stacks fuer Sprache, Variante oder Webiny
- optionale Ressourcen wie Webiny werden im selben Stack ueber die aufgeloeste Projektkonfiguration ein- oder ausgeschaltet

Begruendung:

- deutlich weniger Noob-Komplexitaet als im Legacy-Repo
- ein einziger Deploy-Schritt pro Umgebung

## Repository-Struktur

```text
repo/
  docs/
  packages/
    core/
    aws-adapter/
    cli/
    testkit/
  schemas/
```

## Verantwortlichkeiten pro internem Modul

### `core`

- Template-Sprache
- Render-Kontext
- Dependency-Erfassung
- deterministische Ergebnisbildung

### `aws-adapter`

- S3, DynamoDB, CloudFront, Route53, CloudFormation
- Event-Normalisierung
- Runtime-Manifest

### `cli`

- Projekt-Scaffold
- Validierung
- lokales Rendern
- Packaging
- Deploy
- Diagnose und Migration

### `testkit`

- In-Memory-Adapter
- Memory-Dependency-Store
- sammelnde Output- und Invalidation-Testadapter
- Fixture-Helfer fuer lokale Content-Dateien
- Mocks fuer Content und AWS-nahe Abstraktionen

## Noob-User-Konsequenzen

Diese Entscheidungen sind fuer Nutzer relevant:

1. Nutzer muessen nur ein npm-Paket installieren
2. Nutzer muessen kein Node-Framework lernen
3. Nutzer muessen keine Lambda-Umgebungsvariablen verstehen
4. Nutzer arbeiten mit HTML, einem Projektordner und der CLI
5. AWS bleibt fuer Nutzer hinter `s3te deploy` und den dokumentierten Setup-Schritten versteckt
