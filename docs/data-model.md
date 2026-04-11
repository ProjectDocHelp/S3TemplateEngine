# S3TemplateEngine Rewrite - Datenmodell

## Ziel

Dieses Dokument beschreibt das logische und physische Datenmodell der AWS-Referenzimplementierung. Es loest die frueheren Unklarheiten zwischen abstrakten Interfaces und DynamoDB-Nutzung auf.

## Uebersicht

```mermaid
erDiagram
  CONTENT_ITEM {
    string id PK
    string contentId
    string model
    string locale
    string tenant
    map values
    string createdAt
    string updatedAt
    number version
    number lastChangedAt
  }
  DEPENDENCY_RECORD {
    string sourceId PK
    string dependencyKey SK
    string templateKey
    string outputKey
    string environment
    string variant
    string language
  }
  INVALIDATION_RECORD {
    string distributionId PK
    string requestId SK
    string status
    string requestedAt
  }
```

## 1. Template- und Asset-Struktur

### Lokal

```text
app/
  part/
    head.part
    footer.part
  website/
    index.html
    about.html
    assets/
      logo.svg
  app/
    index.html

offline/
  content/
    en.json
  S3TELocal/
    preview/
```

### In AWS

Code-Buckets enthalten dieselbe Struktur:

- `part/...`
- `<variant>/...`

Output-Buckets enthalten publizierte Artefakte ohne `part/`:

- `index.html`
- `about.html`
- `assets/logo.svg`

## 2. Logisches Content-Modell

Der Core arbeitet mit normalisierten Content-Items:

```ts
export type ContentScalar = string | number | boolean | null;
export type ContentValue = ContentScalar | string[];

export interface ContentItemRecord {
  id: string;
  contentId: string;
  model: string;
  locale?: string;
  tenant?: string;
  values: Record<string, ContentValue>;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  lastChangedAt?: number;
}
```

### Reservierte logische Felder

Diese Felder sind im Template und in Filtern erlaubt:

- `id`
- `contentId`
- `__typename`
- `locale`
- `tenant`
- `_version`
- `_lastChangedAt`

Mapping:

- `__typename` -> `model`
- `locale` -> `locale`
- `tenant` -> `tenant`
- `_version` -> `version`
- `_lastChangedAt` -> `lastChangedAt`

### Sprachregel fuer `dbpart`

Fuer Content-Fragmente gilt:

1. `values["content" + language]` hat Vorrang
2. sonst `values["content"]`
3. sonst fehlender Inhalt mit Warnung

## 3. Physisches Content-Store-Schema in DynamoDB

Tabellenname:

- aufgeloest aus `aws.contentStore.tableName`

Primary Key:

- Partition Key `id`

GSI:

- `<contentIdIndexName>` mit Partition Key `contentId`

Physischer Record:

```json
{
  "id": "article-123",
  "contentId": "summer-special",
  "model": "article",
  "values": {
    "headline": "Summer Special",
    "content": "<p>Hello</p>",
    "forWebsite": true,
    "order": 3,
    "gallery": [
      "https://cdn.example.com/file-1",
      "https://cdn.example.com/file-2"
    ]
  },
  "createdAt": "2026-04-10T08:15:00.000Z",
  "updatedAt": "2026-04-10T08:16:00.000Z",
  "version": 7,
  "lastChangedAt": 1744272960
}
```

### Query-Mapping fuer die DynamoDB-nahe Filtersyntax

Beim AWS-Adapter werden logische Filterfelder so auf physische Felder gemappt:

- `id` -> `id`
- `contentId` -> `contentId`
- `__typename` -> `model`
- `locale` -> `locale`
- `tenant` -> `tenant`
- `_version` -> `version`
- `_lastChangedAt` -> `lastChangedAt`
- jedes andere Feld -> `values.<field>`

Damit bleibt die Filter-Syntax fuer Nutzer DynamoDB-nah, waehrend das physische Modell sauber bleibt.

## 4. Dependency Store

### Logisches Modell

Der Dependency Store beantwortet drei Fragen:

1. welche Outputs haengen von einer Partial oder einem Content-Item ab
2. welche Outputs wurden aus einem `dbmultifile`-Template erzeugt
3. welche Dependencies gehoeren zu einem bestimmten Output

### DynamoDB-Schema

Tabellenname:

- aufgeloest aus `aws.dependencyStore.tableName`

Primary Key:

- Partition Key `sourceId`
- Sort Key `dependencyKey`

GSI:

- `dependencyKey-index`
  - PK `dependencyKey`
  - SK `sourceId`

Formeln:

- `sourceId = <env>#<variant>#<language>#<outputKey>`
- `dependencyKey = <kind>#<id>`

Beispiele:

```json
{
  "sourceId": "prod#website#de#about.html",
  "dependencyKey": "partial#head.part",
  "templateKey": "website/about.html",
  "outputKey": "about.html",
  "environment": "prod",
  "variant": "website",
  "language": "de"
}
```

```json
{
  "sourceId": "prod#website#de#article-123.html",
  "dependencyKey": "content#summer-special",
  "templateKey": "website/article.html",
  "outputKey": "article-123.html",
  "environment": "prod",
  "variant": "website",
  "language": "de"
}
```

```json
{
  "sourceId": "prod#website#de#article-123.html",
  "dependencyKey": "generated-template#website/article.html",
  "templateKey": "website/article.html",
  "outputKey": "article-123.html",
  "environment": "prod",
  "variant": "website",
  "language": "de"
}
```

### Schreibregel

Ein Render-Lauf ersetzt die komplette Dependency-Menge eines Outputs:

1. alte Eintraege zu `sourceId` laden oder direkt loeschen
2. neue Menge schreiben

## 5. Invalidation Store

### Ziel

Der Invalidation Store verwaltet:

- einzelne Invalidierungsanfragen
- das offene Debounce-Fenster pro Distribution

### DynamoDB-Schema

Tabellenname:

- aufgeloest aus `aws.invalidationStore.tableName`

Primary Key:

- Partition Key `distributionId`
- Sort Key `requestId`

Es gibt zwei Record-Arten:

1. Request-Record
2. Window-Lock-Record

### Request-Record

```json
{
  "distributionId": "EDFDVBD6EXAMPLE",
  "requestId": "2026-04-10T08:15:00.000Z#build-123",
  "type": "request",
  "environment": "prod",
  "variant": "website",
  "language": "de",
  "distributionAliases": ["example.de"],
  "paths": ["/*"],
  "requestedAt": "2026-04-10T08:15:00.000Z",
  "status": "pending"
}
```

### Window-Lock-Record

```json
{
  "distributionId": "EDFDVBD6EXAMPLE",
  "requestId": "__window__",
  "type": "window",
  "windowOpenedAt": "2026-04-10T08:15:00.000Z"
}
```

### Algorithmische Verwendung

Scheduler:

1. schreibt einen Request-Record
2. versucht `__window__` mit `attribute_not_exists` anzulegen
3. startet nur bei erfolgreichem Lock eine Step Function

Executor:

1. laedt alle Records einer Distribution
2. ignoriert `__window__`
3. invalidiert einmal `/*`, wenn es pending Requests gibt
4. loescht anschliessend alle Requests und den Lock

## 6. Runtime-Manifest

Logisches Modell:

```ts
export interface AwsRuntimeManifest {
  environments: Record<string, {
    variants: Record<string, {
      codeBucket: string;
      languages: Record<string, {
        targetBucket: string;
        distributionId: string;
        distributionAliases: string[];
        baseUrl: string;
      }>;
    }>;
  }>;
}
```

Das Manifest wird in SSM gespeichert und ist kein Nutzer-Input.

## 7. Webiny-Mirror-Regeln

Beim Spiegeln aus Webiny werden Inhalte in die interne Normalform ueberfuehrt:

1. Zielbild ist Webiny 6.x auf Standard-AWS-Deployment
2. nur publizierte Eintraege werden uebernommen
3. `staticContent` und `staticCodeContent` sind immer relevant
4. `contentId` faellt auf `entryId`, dann `id` zurueck
5. `model` faellt auf `modelId`, `__typename` oder `contentModel.modelId` zurueck
6. `locale` und optional `tenant` werden mitgespeichert
7. Feldwerte werden aus `values`, sonst `data`, sonst aus Root-Feldern normalisiert

### Webiny Rich-Text nach HTML

Die V1-Referenzimplementierung bildet mindestens diese Knotentypen ab:

- `paragraph-element` -> `<p>`
- `text` mit Formatcode `0` -> Plaintext
- `text` mit Formatcode `1` -> `<b>`
- `text` mit Formatcode `2` -> `<i>`
- `text` mit Formatcode `3` -> `<b><i>`
- `text` mit Formatcode `8` -> `<u>`
- `text` mit Formatcode `9` -> `<b><u>`
- `text` mit Formatcode `11` -> `<i><b><u>`
- `image` -> `<figure><img><figcaption>`
- `delimiter` -> `<hr>`
- `linebreak` -> `<br>`
- `heading-element` -> `<h1>` bis `<h6>` gemaess `tag`
- `webiny-list` -> `<ol>` oder `<ul>`
- `webiny-listitem` -> `<li>`
- `link` -> `<a>`

Zusatzregeln:

- `format` auf Paragraphen und Headings wird als `text-align`-Inline-Style serialisiert
- `className` auf Paragraphen und Headings wird als `class` uebernommen
- `target` auf Links wird uebernommen
- unbekannte Knotentypen werden konservativ ueber ihre Kinder serialisiert

### Webiny-Locale-Matching

Fuer lokalisierte Inhalte gilt:

1. exakter Match auf `webinyLocale` hat Vorrang
2. wenn kein exakter Match gefunden wird, darf auf Sprach-Praefixe wie `en-*` oder `de-*` zurueckgefallen werden
3. bei mehreren Tenants soll `integrations.webiny.tenant` gesetzt werden, damit keine tenant-fremden Inhalte gespiegelt werden

## 8. Bucket-Namenskonventionen

Default-Muster fuer die AWS-Referenz:

- Code-Bucket: `<envPrefix><variant>-code-<project>`
- Output-Bucket Default-Sprache: `<envPrefix><variant>-<project>`
- Output-Bucket weitere Sprache: `<envPrefix><variant>-<project>-<lang>`

Diese Muster gelten nur als Default. Die effektiven Namen entstehen nach Platzhalteraufloesung aus der Projektkonfiguration.
