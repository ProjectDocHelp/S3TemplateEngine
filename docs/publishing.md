# S3TemplateEngine Rewrite - npm Publishing

## Ziel

Dieses Dokument beschreibt den Maintainer-Workflow fuer die npm-Verteilung von S3TE.

Es gibt genau ein veroeffentlichtes npm-Paket:

- `@projectdochelp/s3te`

Die Unterordner `packages/core`, `packages/aws-adapter`, `packages/cli` und `packages/testkit` bleiben interne Modulgrenzen im Repository. Sie werden nicht als eigene npm-Pakete veroeffentlicht.

Der Repository-Workflow ist auf GitHub Actions vorbereitet. Der eigentliche Publish laeuft ueber [publish.yml](../.github/workflows/publish.yml).

## Wem gehoert der npm-Scope?

Ein npm-Scope gehoert immer genau einem npm-Benutzer oder einer npm-Organisation.

Fuer dieses Paket bedeutet das:

- du kontrollierst `@projectdochelp/*`, wenn dir auf npm der Benutzer oder die Organisation `projectdochelp` gehoert
- GitHub-Repository-Name und GitHub-Organisation sind dafuer nicht entscheidend
- fuer einen persoenlichen Scope ist keine separate npm-Organisation noetig

Wenn du auf npm keine Rechte fuer `projectdochelp` hast, kannst du `@projectdochelp/s3te` nicht publishen.

## Scope-Checks

Vor dem ersten Publish:

1. npm-Konto anlegen oder vorhandenes Konto verwenden
2. mit `npm login` anmelden
3. mit `npm whoami` pruefen, welches Konto aktiv ist
4. sicherstellen, dass das aktive Konto Publish-Rechte fuer den npm-Scope `@projectdochelp` hat
5. optional mit `npm view @projectdochelp/s3te version` pruefen, ob das Paket bereits existiert

## package.json-Metadaten

Die von ChatGPT vorgeschlagenen Felder sind im Root-[package.json](../package.json) gesetzt:

- `name`
- `version`
- `description`
- `repository`
- `homepage`
- `bugs`
- `license`
- `bin`
- `exports`
- `files`
- `publishConfig`

## Publish-Voraussetzungen

Vor dem Publish muessen diese Bedingungen erfuellt sein:

1. `npm install` wurde im Repository-Root ausgefuehrt
2. `npm run pack:check` ist erfolgreich
3. `npm test` ist erfolgreich
4. die Versionsnummer im Root-[package.json](../package.json) ist korrekt
5. du bist fuer den Scope eingeloggt und hast Schreibrechte
6. fuer GitHub Actions ist das Repo auf einen npm-Publish-Pfad vorbereitet

## Empfohlener GitHub-Publish

Empfohlen ist ein GitHub-Actions-Workflow mit npm Trusted Publishing. npm beschreibt das als bevorzugten Weg gegenueber langlebigen Tokens.

Offizielle Referenzen:

- npm Trusted Publishing: https://docs.npmjs.com/trusted-publishers/
- GitHub Actions fuer Node-Pakete: https://docs.github.com/actions/tutorials/publish-packages/publish-nodejs-packages
- npm `package.json`: https://docs.npmjs.com/cli/v11/configuring-npm/package-json

### GitHub-Workflow in diesem Repo

Das Repo enthaelt bereits den Workflow:

- [publish.yml](../.github/workflows/publish.yml)

Der Workflow:

1. checkt das Repository aus
2. installiert Node 22.14.0
3. aktualisiert npm auf Version 11
4. fuehrt `npm ci`, `npm test` und `npm run pack:check` aus
5. publisht danach genau das Root-Paket `@projectdochelp/s3te`

### Bootstrap fuer den ersten Publish

Praktisch gibt es bei neuen Paketen oft einen Henne-Ei-Punkt:

- Trusted Publishing wird in den npm-Package-Settings konfiguriert
- ein neues Paket existiert dort aber erst nach dem ersten Publish

Deshalb ist fuer komplett neue Paketnamen oft dieser Ablauf am robustesten:

1. ersten Release einmal manuell oder per GitHub-Secret `NPM_TOKEN` publishen
2. danach Trusted Publishing in npm fuer `@projectdochelp/s3te` einrichten
3. danach Token-Zugriff wieder entfernen oder sperren

Das entspricht der von npm empfohlenen Migration von Token-basiertem Publish zu Trusted Publishing.

### GitHub-Secret fuer den Bootstrap

Der Workflow unterstuetzt zusaetzlich `NPM_TOKEN` als Fallback. Das ist vor allem fuer den ersten Publish nuetzlich.

Falls du den ersten Release direkt ueber GitHub Actions machen willst:

1. npm Access Token mit Publish-Rechten erzeugen
2. in GitHub unter `Settings -> Secrets and variables -> Actions` ein neues Repository Secret `NPM_TOKEN` anlegen
3. Workflow starten

Wenn spaeter Trusted Publishing aktiv ist, kann `NPM_TOKEN` entfernt werden.

### Trusted Publishing einrichten

Nach dem ersten erfolgreichen Publish:

1. auf npm die Settings von `@projectdochelp/s3te` oeffnen
2. unter `Trusted publishing` GitHub Actions waehlen
3. diese Werte eintragen:
   - GitHub Organization oder User: `ProjectDocHelp`
   - Repository: `S3TemplateEngine`
   - Workflow filename: `publish.yml`
4. optional unter `Publishing access` Token-Publishing deaktivieren

Wichtig:

- der Workflow-Dateiname muss exakt `publish.yml` sein
- npm prueft die Angaben erst beim echten Publish
- fuer Trusted Publishing braucht GitHub-hosted runners und `id-token: write`

## Erster manueller Publish

Beim ersten Publish eines neuen scoped npm-Pakets muss `--access public` gesetzt werden.

Beispiel:

```bash
npm login
npm whoami
npm install
npm run pack:check
npm test
npm publish --access public
```

Danach koennen Folgeversionen normal mit `npm publish` oder ueber GitHub Actions veroeffentlicht werden.

## Release-Checks

Vor jeder Verteilung:

```bash
npm install
npm run pack:check
npm test
```

Optional zum Erzeugen lokaler Tarballs:

```bash
npm run pack:publish
```

Optional zum lokalen Simulieren des Publish-Schritts:

```bash
npm run publish:dry-run
```

## GitHub-Release-Ablauf

Wenn Trusted Publishing oder `NPM_TOKEN` eingerichtet ist:

1. Versionsnummer im Root-[package.json](../package.json) anheben
2. Aenderungen committen und nach GitHub pushen
3. auf GitHub einen Release anlegen oder den Workflow manuell starten
4. der Workflow publisht `@projectdochelp/s3te`

Bei `workflow_dispatch` kann zusaetzlich ein `dry_run` und ein `npm_tag` gesetzt werden.

## Wenn `@projectdochelp` nicht dein npm-Scope ist

Dann muessen mindestens diese Stellen gemeinsam umbenannt werden:

- Root-[package.json](../package.json)
- README- und Doku-Stellen mit Installationsbefehlen
- Importe oder Exports, die den Paketnamen enthalten

## Offizielle Referenzen

- npm Scopes: https://docs.npmjs.com/cli/v10/using-npm/scope/
- npm Access: https://docs.npmjs.com/cli/v10/commands/npm-access
- npm Organizations: https://docs.npmjs.com/about-organizations
