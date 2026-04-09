# S3TemplateEngine – Requirements (Neuplanung)

## 1. Zielbild
S3TemplateEngine (S3TE) bleibt eine **ultra lightweight, serverless** Engine für statische Website-Generierung und Auslieferung über AWS (S3, Lambda, CloudFront, optional Webiny).

Nicht-Ziel:
- Kein Container-Betrieb (Docker/ECS/Kubernetes)
- Kein monolithisches Framework
- Keine dauerhaft laufenden Server

## 2. Funktionale Anforderungen

### FR-1 Template Rendering
- Das System muss HTML-Templates inklusive S3TE-Tags rendern können.
- Muss bestehende Konzepte abbilden (z. B. `part`, `if`, `fileattribute`, Sprach-/Variantenlogik).
- Rendering soll sowohl in AWS Lambda als auch lokal (CLI/Test) identisch funktionieren.

### FR-2 Serverless Verarbeitung
- Bei Datei-Änderungen im Code-Bucket muss eine serverless Verarbeitung ausgelöst werden.
- Rendering-Ausgaben werden in Ziel-Buckets geschrieben.
- CloudFront-Invalidierung erfolgt entkoppelt und gebündelt.

### FR-3 Varianten- und Mehrsprachenfähigkeit
- Mehrere Varianten (z. B. `website`, `app`) müssen unterstützt werden.
- Mehrere Sprachen pro Variante müssen unterstützt werden.
- Routing-/Domain-Konfiguration muss pro Umgebung steuerbar sein.

### FR-4 Optional Webiny Integration
- Optionaler Import/Transfer publizierter Inhalte aus Webiny.
- Optionales Sitemap-Update je Deployment/Änderung.
- Webiny-Funktionalität muss deaktivierbar sein, ohne Core-Funktion zu beeinträchtigen.

### FR-5 Lokales Testen
- Lokales Rendern ohne AWS-Infrastruktur muss möglich sein.
- Snapshot-, Accessibility- und Strukturtests müssen einfach integrierbar sein.
- Testkit soll wiederverwendbar und projektübergreifend installierbar sein.

### FR-6 Einfache Installation & Updates
- Initiale Installation muss über wenige Befehle möglich sein.
- Konfiguration muss zentral in einer Datei gepflegt werden.
- Updates müssen versioniert und mit Migrationshinweisen begleitet sein.

## 3. Nicht-funktionale Anforderungen

### NFR-1 Lightweight
- Kleine, klar abgegrenzte Pakete.
- Minimale Runtime-Dependencies.
- Fokus auf einfache JS/Node-Werkzeuge.

### NFR-2 Wartbarkeit
- Trennung zwischen Rendering-Logik (Core) und Infrastruktur-Adapter (AWS).
- Saubere Versionierung (SemVer) für Core, Adapter und CLI.

### NFR-3 Sicherheit
- IAM-Berechtigungen möglichst nach Least-Privilege.
- TLS-Standards zeitgemäß konfigurieren.
- Konfigurationsvalidierung vor Deployment.

### NFR-4 Reproduzierbarkeit
- Deterministische Builds für Lambda-ZIPs.
- CI-fähiger Ablauf: validate → test → package → deploy.

### NFR-5 Abwärtskompatibilität
- Bestehende Tag-Syntax und Grund-Workflows sollen weitgehend kompatibel bleiben.
- Breaking Changes nur mit dokumentierter Migration.

## 4. Betriebsanforderungen
- Deployment muss ohne Docker-Pflicht funktionieren.
- AWS CloudFormation bleibt unterstützter Standard.
- Rollback auf vorherige Artefakt-Versionen muss möglich sein.

## 5. Lieferobjekte (Neuplanung)
- `@s3te/core` (Renderer)
- `@s3te/aws-adapter` (Lambda Handler + AWS Integrationen)
- `@s3te/cli` (Init, Validate, Package, Deploy, Migrate)
- `@s3te/testkit` (lokale Tests & Mocks)
- `s3te.config.json` als zentrale Projektkonfiguration

## 6. Akzeptanzkriterien
- Neue Projekte können mit maximal 5 CLI-Befehlen initial eingerichtet und deployed werden.
- Lokaler Testlauf benötigt keine AWS-Zugriffe.
- Varianten- und Sprachkonfiguration funktionieren über zentrale Config.
- Engine-Upgrade inkl. Konfigurationsprüfung in einem standardisierten Ablauf möglich.
