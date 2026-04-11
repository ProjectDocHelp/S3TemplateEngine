# S3TemplateEngine Rewrite - Requirements

## Zweck

Dieses Dokument definiert die fachlichen und technischen Anforderungen fuer einen Rewrite von S3TemplateEngine. Die Dokumentation im Ordner `docs/` ist die alleinige Spezifikation fuer die Neuimplementierung. Der Legacy-Code dient nur als Referenz fuer Rueckwaertskompatibilitaet und darf fuer die neue Implementierung nicht vorausgesetzt werden.

## Produktziel

S3TemplateEngine (S3TE) bleibt eine ultra-leichte, serverless Engine fuer statische Websites und webartige Frontends auf AWS. Die Engine rendert HTML-basierte Templates, publiziert Build-Artefakte in S3, invalidiert CloudFront, kann optional `sitemap.xml` pflegen und kann optional Inhalte aus Webiny spiegeln.

## Nicht-Ziele

- Kein dauerhaft laufender Serverprozess.
- Kein Container-Zwang.
- Kein generisches Fullstack-Framework.
- Kein WYSIWYG-Site-Builder.
- Kein vendor-locking des Render-Cores an AWS.

## Kernprinzipien

1. Core und Infrastruktur werden strikt getrennt.
2. Jeder Build ist deterministisch reproduzierbar, ausser ein Template nutzt explizit die begrenzte Zufallsfunktion `dbmultifileitem.limitlow`.
3. Lokales Rendering und AWS-Rendering muessen denselben Render-Vertrag erfuellen und sind byte-identisch, ausser ein Template nutzt explizit `dbmultifileitem.limitlow`.
4. Bestehende Template-Konzepte bleiben weitgehend kompatibel.
5. Konfiguration wird zentral beschrieben und validiert.

## Funktionale Anforderungen

### FR-1 Zentrale Projektkonfiguration

- Jedes S3TE-Projekt besitzt genau eine kanonische Konfigurationsdatei `s3te.config.json`.
- Die Konfiguration beschreibt Umgebungen, Varianten, Sprachen, Routing, AWS-Ressourcen und optionale Integrationen.
- Die CLI validiert die Konfiguration vor Build und Deployment.
- Ein maschinenlesbares JSON Schema fuer diese Datei ist Teil des Lieferumfangs.

### FR-2 Plattformunabhaengiger Render-Core

- Der Core rendert HTML-Templates ohne direkte AWS-Abhaengigkeiten.
- Der Core unterstuetzt alle in [template-language.md](./template-language.md) beschriebenen Tags.
- Der Core liefert neben dem HTML auch Metadaten fuer Abhaengigkeiten, generierte Dateien und Invalidierungsbedarfe.
- Fehlende Includes oder Content-Referenzen werden immer als leerer String gerendert und als Warnung protokolliert.

### FR-3 Inkrementelle Verarbeitung

- Aenderungen an Template-Dateien, Partials, Assets und Content-Items muessen nur die betroffenen Outputs neu bauen.
- Das System fuehrt eine persistente Abhaengigkeitserfassung fuer Partials und Content-Referenzen.
- Fuer `dbmultifile` muessen erzeugte Dateien wiederauffindbar und loeschbar sein.

### FR-4 Varianten und Sprachen

- Ein Projekt unterstuetzt mehrere Varianten, zum Beispiel `website`, `app` oder `admin`.
- Jede Variante kann mehrere Sprachen besitzen.
- Jede Sprache hat eine eigene Ziel-Bucket- und Routing-Definition.
- Sprach- und Variantenwechsel sind innerhalb eines einzigen Builds konfigurationsgetrieben und nicht hart codiert.

### FR-5 Asset-Verarbeitung

- Dateien, die nicht gerendert werden, werden 1:1 publiziert.
- Renderfaehige Dateien sind mindestens `.html`, `.htm` und `.part`.
- Die Zielimplementierung darf die Renderliste erweitern, aber nicht implizit verkleinern.

### FR-6 Template-Kompatibilitaet

- Folgende Legacy-Konstrukte sind Pflichtbestandteil der ersten Rewrite-Version:
  - `part`
  - `if`
  - `fileattribute`
  - `lang`
  - `switchlang`
  - `dbpart`
  - `dbmulti`
  - `dbmultifile`
  - `dbitem`
  - `dbmultifileitem`
- Die genaue Semantik ist in [template-language.md](./template-language.md) beschrieben.

### FR-7 Optionale Content-Integration

- Webiny bleibt eine optionale Integration.
- Zielversion der offiziellen CMS-Integration ist Webiny 6.x.
- Die Integration besteht aus zwei Ebenen:
  - Import bzw. Spiegelung externer Inhalte in ein internes Content-Repository.
  - Nutzung dieser Inhalte im Renderer ueber Content-Tags.
- Der Core kennt nur ein generisches `ContentRepository`-Interface.
- Die AWS-Referenzimplementierung nutzt fuer V1 weiterhin eine Webiny-DynamoDB-Stream-Spiegelung.
- Die Spiegelung muss locale- und tenant-aware sein.

### FR-8 AWS Build- und Deployment-Fluss

- Der AWS-Adapter reagiert auf S3- und optionale Content-Events.
- Zielobjekte werden in S3 publiziert.
- CloudFront-Invalidierungen werden entkoppelt und gebuendelt.
- Optionale Laufzeitfeatures wie Sitemap oder Webiny muessen ueber denselben Environment-Stack aktivierbar sein.
- CloudFormation bleibt fuer die erste Rewrite-Generation ein unterstuetztes Deployment-Ziel.
- `s3te deploy --env <name>` rollt die Infrastruktur aus und synchronisiert die aktuellen Projektquellen in die konfigurierten Code-Buckets.
- `s3te sync --env <name>` synchronisiert aktuelle Projektquellen in eine bereits vorhandene Umgebung, ohne CloudFormation erneut auszurollen.
- V1 verwendet genau einen persistenten CloudFormation-Stack pro Umgebung und fuer echte Deploy-Laeufe zusaetzlich genau einen temporaeren Packaging-Stack.

### FR-9 Lokales Entwickeln und Testen

- Ein kompletter Render-Lauf muss lokal ohne AWS moeglich sein.
- Projekttests muessen lokal ueber den Node Built-in Test Runner ausfuehrbar sein.
- Das Testkit muss dafuer mindestens In-Memory-Template- und Content-Repositories, einen Memory-Dependency-Store sowie sammelnde Output- und Invalidation-Testadapter bereitstellen.
- Fixture-Lader fuer lokale Content-Dateien muessen vorgesehen sein.
- Der lokale Entwicklungsworkflow auf Basis von VSCode muss dokumentiert und offiziell unterstuetzt sein.

### FR-10 CLI

Die CLI stellt mindestens diese Kommandos bereit:

- `s3te init`
- `s3te validate`
- `s3te render`
- `s3te test`
- `s3te package`
- `s3te sync`
- `s3te deploy`
- `s3te doctor`
- `s3te migrate`

Weitere CLI-Anforderungen:

- Die CLI wird als npm-Paket `@projectdochelp/s3te` ausgeliefert.
- Das ausfuehrbare Binary heisst `s3te`.
- Die CLI muss sowohl lokal als Projekt-Dependency als auch global installierbar sein.
- `s3te init` erzeugt eine lauffaehige Projektstruktur mit `s3te.config.json`, Template-Ordnern und optionalen VSCode-Empfehlungen.
- `s3te migrate` darf optionale Retrofit-Konfigurationen wie `sitemap` oder Webiny in bestehende Projekte schreiben.

## Nicht-funktionale Anforderungen

### NFR-1 Leichtgewichtig

- Kleine, klar getrennte interne Module.
- Minimale Runtime-Dependencies.
- Keine Build-Pipeline, die Docker voraussetzt.
- Kein Bundler in V1.

### NFR-2 Wartbarkeit

- Interfaces an Paketgrenzen muessen explizit typisiert und dokumentiert sein.
- Der Core darf keine Kenntnis ueber AWS SDK, CloudFormation oder Webiny-DynamoDB-Details besitzen.
- Fehlerklassen muessen unterscheidbar sein: Konfiguration, Template-Syntax, fehlende Abhaengigkeit, Adapterfehler.
- Die technische Grundlinie fuer Sprache, Test-Runner und Packaging muss dokumentiert sein.

### NFR-3 Determinismus

- Gleiche Inputs erzeugen gleiche Outputs, ausser ein Template nutzt explizit `dbmultifileitem.limitlow`.
- Packaging fuer Lambda-Artefakte muss reproduzierbar sein.
- Die Reihenfolge von `dbmulti`-Ergebnissen ist stabil. Standard ist aufsteigend nach Feld `order`, danach stabile Restreihenfolge.
- Einzige zugelassene Ausnahme ist `dbmultifileitem.limitlow`.
- Wenn `limitlow` verwendet wird, darf die konkrete Ausgabelaenge zwischen Runs variieren, muss aber innerhalb der spezifizierten Grenzen liegen und valides HTML erzeugen.

### NFR-4 Sicherheit

- IAM Policies werden nach Least-Privilege formuliert.
- Konfiguration wird vor Deployment validiert.
- Secrets liegen nicht im Template, sondern in dafuer vorgesehenen Secret Stores oder Parametern.

### NFR-5 Rueckwaertskompatibilitaet

- Legacy-Templates sollen ohne Modusumschaltung migriert werden koennen.
- Abweichungen zum Legacy-Verhalten muessen explizit dokumentiert werden.
- Fehlende Inhalte werden grundsaetzlich als Warnung + leerer String behandelt.

### NFR-6 Beobachtbarkeit

- Fehler und CLI-Reports muessen strukturierte Fehlercodes und Detailobjekte tragen.
- AWS-nahe Build-Pfade muessen korrelierbare Build-IDs fuer Render- und Invalidierungsablaeufe erzeugen.
- Build-Ursachen muessen im Laufzeitpfad nachvollziehbar sein: S3, Content, CLI oder Deployment.

## Betriebsanforderungen

- Deployment ohne Docker-Pflicht.
- CloudFormation als Referenz-Infrastruktur fuer AWS.
- Rollback ueber versionierte Artefakte.
- Mehrere Umgebungen pro Projekt, mindestens `dev`, `stage`, `prod`.

## Lieferobjekte

- `@projectdochelp/s3te`
- interne Module fuer Core, AWS-Adapter, CLI und Testkit innerhalb desselben Repositories
- `s3te.config.json`
- `schemas/s3te.config.schema.json`
- Dokumentation gemaess dieses Ordners

## Akzeptanzkriterien

Ein Rewrite gilt als spezifikationskonform, wenn:

1. Ein neues Projekt allein mit der Doku in `docs/` implementiert werden kann.
2. Der Renderer erzeugt lokal und in AWS identische HTML-Ausgaben fuer denselben Input, ausgenommen Templates mit `dbmultifileitem.limitlow`.
3. Varianten-, Sprach- und Content-Konfiguration zentral in `s3te.config.json` beschrieben sind.
4. Alle Pflicht-Tags aus FR-6 in mindestens einem automatisierten Test abgedeckt sind.
5. Inkrementelle Rebuilds fuer Partials und Content-Updates moeglich sind.
6. CloudFront-Invalidierungen entkoppelt, dedupliziert und nachvollziehbar ausgefuehrt werden.
7. `s3te validate` prueft sowohl JSON Schema als auch Cross-Field-Regeln.
8. `s3te deploy --env <name>` erstellt oder aktualisiert genau einen Environment-Stack und verwendet fuer echte Deploy-Laeufe zusaetzlich genau einen temporaeren Deploy-Stack, der am Ende wieder entfernt wird.
