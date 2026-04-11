# S3TemplateEngine Rewrite - Offene Entscheidungen

## Status

Aktuell gibt es keine offenen Entscheidungen, die die V1-Umsetzung blockieren.

## Hinweis

Die Spezifikation trifft fuer V1 bewusst diese Festlegungen selbst:

1. ein CloudFormation-Stack pro Umgebung
2. JavaScript, ESM und ein buildfreier Runtime-Pfad als technische Grundlinie
3. Runtime-Manifest in SSM Parameter Store
4. normalisiertes Content-Modell mit `values`-Map statt ungeordnetem Legacy-Flattening
5. stringbasierter Template-Parser ohne externes HTML-Parser-Framework

Wenn sich spaeter zeigt, dass eine dieser Festlegungen produktiv unpassend ist, sollte sie als neue ADR oder als explizite V2-Entscheidung dokumentiert werden.
