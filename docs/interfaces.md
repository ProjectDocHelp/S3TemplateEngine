# S3TemplateEngine Rewrite - Interfaces

## Ziel

Dieses Dokument definiert die paketuebergreifenden Vertraege fuer V1. Zur Lesbarkeit werden die Typen in TypeScript-aehnlicher Notation beschrieben. Interne Klassen und Dateinamen duerfen abweichen, die hier beschriebenen Typvertraege nicht.

Die Interfaces sind absichtlich auf drei Ebenen aufgeteilt:

1. Konfiguration und Render-Kontext
2. Core-Repositories und Build-Orchestrierung
3. CLI- und Adapter-Vertraege

## Konfigurationsinterfaces

```ts
export interface ProjectConfig {
  $schema?: string;
  configVersion?: number;
  project: {
    name: string;
    displayName?: string;
  };
  environments: Record<string, EnvironmentConfig>;
  rendering?: RenderingConfig;
  variants: Record<string, VariantConfig>;
  aws?: AwsConfig;
  integrations?: IntegrationsConfig;
}

export interface EnvironmentConfig {
  awsRegion: string;
  stackPrefix?: string;
  certificateArn: string;
  route53HostedZoneId?: string;
}

export interface RenderingConfig {
  minifyHtml?: boolean;
  renderExtensions?: string[];
  outputDir?: string;
  maxRenderDepth?: number;
}

export interface VariantConfig {
  sourceDir?: string;
  partDir?: string;
  defaultLanguage: string;
  routing?: {
    indexDocument?: string;
    notFoundDocument?: string;
  };
  languages: Record<string, LanguageConfig>;
}

export interface LanguageConfig {
  baseUrl: string;
  targetBucket?: string;
  cloudFrontAliases: string[];
  webinyLocale?: string;
}

export interface AwsConfig {
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

export interface IntegrationsConfig {
  webiny?: {
    enabled?: boolean;
    sourceTableName?: string;
    mirrorTableName?: string;
    tenant?: string;
    relevantModels?: string[];
    environments?: Record<string, {
      enabled?: boolean;
      sourceTableName?: string;
      mirrorTableName?: string;
      tenant?: string;
      relevantModels?: string[];
    }>;
  };
}
```

### Aufgeloeste Konfiguration

Nach Validierung und Defaulting arbeitet der Core nur noch mit aufgeloesten Werten:

```ts
export interface ResolvedProjectConfig {
  configVersion: number;
  project: {
    name: string;
    displayName?: string;
  };
  environments: Record<string, ResolvedEnvironmentConfig>;
  rendering: ResolvedRenderingConfig;
  variants: Record<string, ResolvedVariantConfig>;
  aws: ResolvedAwsConfig;
  integrations: ResolvedIntegrationsConfig;
}

export interface ResolvedEnvironmentConfig {
  name: string;
  awsRegion: string;
  stackPrefix: string;
  certificateArn: string;
  route53HostedZoneId?: string;
}

export interface ResolvedRenderingConfig {
  minifyHtml: boolean;
  renderExtensions: string[];
  outputDir: string;
  maxRenderDepth: number;
}

export interface ResolvedVariantConfig {
  name: string;
  sourceDir: string;
  partDir: string;
  defaultLanguage: string;
  routing: {
    indexDocument: string;
    notFoundDocument: string;
  };
  languages: Record<string, ResolvedLanguageConfig>;
}

export interface ResolvedLanguageConfig {
  code: string;
  baseUrl: string;
  targetBucket: string;
  cloudFrontAliases: string[];
  webinyLocale: string;
}

export interface ResolvedAwsConfig {
  codeBuckets: Record<string, string>;
  dependencyStore: {
    tableName: string;
  };
  contentStore: {
    tableName: string;
    contentIdIndexName: string;
  };
  invalidationStore: {
    tableName: string;
    debounceSeconds: number;
  };
  lambda: {
    runtime: "nodejs22.x";
    architecture: "arm64" | "x86_64";
  };
}

export interface ResolvedIntegrationsConfig {
  webiny: {
    enabled: boolean;
    sourceTableName?: string;
    mirrorTableName: string;
    tenant?: string;
    relevantModels: string[];
    environments: Record<string, {
      enabled?: boolean;
      sourceTableName?: string;
      mirrorTableName?: string;
      tenant?: string;
      relevantModels?: string[];
    }>;
  };
}
```

## Core-Domaintypen

```ts
export interface RenderTarget {
  environment: string;
  variant: string;
  language: string;
  sourceKey: string;
  outputKey: string;
  baseUrl: string;
}

export interface BuildCause {
  type: "s3" | "content" | "cli" | "deploy";
  action: "upsert" | "delete" | "render";
  reason: string;
}

export interface BuildRequest {
  buildId: string;
  cause: BuildCause;
  targets: RenderTarget[];
}

export interface RenderWarning {
  code:
    | "MISSING_PART"
    | "MISSING_CONTENT"
    | "MISSING_LANGUAGE"
    | "UNSUPPORTED_TAG"
    | "UNSUPPORTED_CONTENT_NODE"
    | "INVALID_HTML_TRUNCATION_RECOVERED";
  message: string;
  sourceKey: string;
}

export interface DependencyRef {
  kind: "partial" | "content" | "generated-template";
  id: string;
}

export interface RenderArtifact {
  outputKey: string;
  contentType: string;
  body: string | Uint8Array;
  cacheControl?: string;
}

export interface RenderResult {
  target: RenderTarget;
  artifact?: RenderArtifact;
  copiedSourceKey?: string;
  deleteOutput?: boolean;
  dependencies: DependencyRef[];
  generatedOutputs: string[];
  invalidationPaths: string[];
  warnings: RenderWarning[];
}
```

## Content-Interfaces

```ts
export type ContentScalar = string | number | boolean | null;
export type ContentValue = ContentScalar | string[];

export interface ContentItem {
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

export type LegacyAttributeValue =
  | { S: string }
  | { N: string | number }
  | { BOOL: boolean }
  | { NULL: true }
  | { L: LegacyAttributeValue[] };

export type LegacyFilterClause = Record<string, LegacyAttributeValue>;

export type DbMultiFileItemCommand =
  | string
  | {
      field: string;
      limit?: number;
      limitlow?: number;
      format?: "date";
      locale?: string;
      divideattag?: string;
      startnumber?: number;
      endnumber?: number;
    };

export interface ContentQuery {
  filter: LegacyFilterClause[];
  operator?: "AND";
  filterType?: "equals" | "contains";
  limit?: number;
}

export interface ContentRepository {
  getByContentId(contentId: string, language: string): Promise<ContentItem | null>;
  query(query: ContentQuery, language: string): Promise<ContentItem[]>;
}
```

## Template-Interfaces

```ts
export interface TemplateFile {
  key: string;
  contentType: string;
  body: string | Uint8Array;
  lastModified?: string;
}

export interface TemplateRepository {
  get(key: string): Promise<TemplateFile | null>;
  listVariantEntries(variant: string): Promise<TemplateFile[]>;
  exists(key: string): Promise<boolean>;
}
```

## Persistenz-Interfaces

```ts
export interface SourceDependencyRecord {
  sourceId: string;
  environment: string;
  variant: string;
  language: string;
  templateKey: string;
  outputKey: string;
  dependencies: DependencyRef[];
}

export interface GeneratedOutputRecord {
  environment: string;
  variant: string;
  language: string;
  templateKey: string;
  outputKey: string;
}

export interface DependencyQueryScope {
  environment: string;
  variant: string;
  language: string;
}

export interface DependencyStore {
  replaceSourceDependencies(record: SourceDependencyRecord): Promise<void>;
  findDependentsByDependency(ref: DependencyRef): Promise<SourceDependencyRecord[]>;
  findGeneratedOutputsByTemplate(
    templateKey: string,
    scope: DependencyQueryScope
  ): Promise<GeneratedOutputRecord[]>;
  deleteOutput(output: GeneratedOutputRecord): Promise<void>;
}

export interface InvalidationRequest {
  buildId: string;
  environment: string;
  variant: string;
  language: string;
  distributionId: string;
  distributionAliases: string[];
  paths: string[];
  requestedAt: string;
}

export interface InvalidationScheduler {
  enqueue(request: InvalidationRequest): Promise<void>;
}
```

## Publishing-Interface

```ts
export interface OutputPublisher {
  put(artifact: RenderArtifact, target: RenderTarget): Promise<void>;
  copySourceObject(sourceKey: string, target: RenderTarget): Promise<void>;
  delete(outputKey: string, target: RenderTarget): Promise<void>;
}
```

## Logging-Interface

```ts
export interface Logger {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}
```

## Orchestrator-Interface

```ts
export interface BuildOrchestrator {
  handle(request: BuildRequest): Promise<RenderResult[]>;
}
```

## Normalisierte Events

```ts
export type NormalizedBuildEvent =
  | {
      type: "source-object";
      action: "upsert" | "delete";
      bucket: string;
      key: string;
      environment: string;
      variant: string;
    }
  | {
      type: "content-item";
      action: "upsert" | "delete";
      environment: string;
      contentId: string;
      model: string;
      item?: ContentItem;
    }
  | {
      type: "manual-build";
      environment: string;
      variant?: string;
      language?: string;
      sourceKey?: string;
    };
```

## Runtime-Manifest fuer AWS

Der AWS-Adapter darf zusaetzlich mit einem aufgeloesten Runtime-Manifest arbeiten, das nach dem Deploy Distribution IDs enthaelt.

```ts
export interface AwsRuntimeManifest {
  environments: Record<string, {
    integrations?: {
      webiny?: {
        tenant?: string;
      };
    };
    variants: Record<string, {
      codeBucket: string;
      languages: Record<string, {
        targetBucket: string;
        distributionId: string;
        distributionAliases: string[];
        baseUrl: string;
        webinyLocale: string;
      }>;
    }>;
  }>;
}
```

Dieses Manifest ist kein Nutzer-Input, sondern Adapter-intern.

## CLI-Report-Interfaces

```ts
export interface CliError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CliReport<TData = unknown> {
  command: string;
  success: boolean;
  durationMs: number;
  warnings: RenderWarning[];
  errors: CliError[];
  data?: TData;
}

export interface ValidateReport {
  configPath: string;
  checkedEnvironments: string[];
}

export interface RenderReport {
  outputDir: string;
  renderedArtifacts: string[];
  deletedArtifacts: string[];
}

export interface PackageReport {
  packageDir: string;
  manifestPath: string;
  lambdaArtifacts: string[];
  cloudFormationTemplate: string;
}

export interface DeployReport {
  stackName: string;
  packageDir: string;
  runtimeManifestPath: string;
  syncedCodeBuckets: string[];
  temporaryStackName: string;
  temporaryStackDeleted: boolean;
  distributions: Array<{
    variant: string;
    language: string;
    distributionId: string;
  }>;
}
```

## AWS-Adapter-Handler-Vertraege

### Source Handler

Input:

- AWS S3 Event

Output:

- `NormalizedBuildEvent[]`

### Content Mirror Handler

Input:

- Webiny DynamoDB Stream Event

Output:

- normalisierte `ContentItem`-Upserts oder Deletes

### Render Worker

Input:

- `NormalizedBuildEvent`

Output:

- `RenderResult[]`

### Invalidation Scheduler

Input:

- `InvalidationRequest`

Output:

- persistierter Invalidierungsauftrag

### Invalidation Executor

Input:

- Distribution-Key oder Scheduler-Payload

Output:

- genau eine gebuendelte CloudFront-Invalidierung

## Fehlervertrag

Alle Pakete verwenden strukturierte Fehler mit mindestens:

```ts
export interface S3teError extends Error {
  code:
    | "CONFIG_SCHEMA_ERROR"
    | "CONFIG_DEFAULT_ERROR"
    | "CONFIG_PLACEHOLDER_ERROR"
    | "CONFIG_CONFLICT_ERROR"
    | "CONFIG_PATH_ERROR"
    | "TEMPLATE_SYNTAX_ERROR"
    | "TEMPLATE_CYCLE_ERROR"
    | "MISSING_PART"
    | "MISSING_CONTENT"
    | "CONTENT_QUERY_ERROR"
    | "PUBLISH_ERROR"
    | "AWS_AUTH_ERROR"
    | "ADAPTER_ERROR";
  details?: Record<string, unknown>;
}
```

Der detaillierte CLI-Vertrag ist in [cli-contract.md](./cli-contract.md) beschrieben.
