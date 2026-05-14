# Imports manuels Steam PatchVault

Ce dossier sert à ajouter des données que Steam ne fournit pas proprement via l'API publique.

Ne modifiez pas directement `data/patches/*.json` ou `data/manifests/*.json`: ces fichiers sont régénérés par GitHub Actions.

Ajoutez plutôt:

- `data/manual/patches/<appid>.json` pour des patch notes ajoutées ou corrigées à la main
- `data/manual/manifests/<appid>.json` pour des depots/manifests connus

Au prochain build, `scripts/build-static-db.mjs` fusionne ces imports dans les fichiers statiques publics.

## Exemple patch note

```json
{
  "patches": [
    {
      "id": "manual-739630-2024-08-12",
      "appid": 739630,
      "title": "Exemple de patch importé manuellement",
      "version_detected": "0.10",
      "date": "2024-08-12T18:00:00.000Z",
      "type": "major",
      "content": "Résumé court du patch. Ne pas copier de longs contenus protégés.",
      "source_url": "https://store.steampowered.com/news/app/739630",
      "source_type": "manual",
      "keywords": ["content", "performance"]
    }
  ]
}
```

## Exemple manifest

```json
{
  "manifests": [
    {
      "id": "manual-739630-739631-2382933349983046343",
      "appid": 739630,
      "depotid": 739631,
      "manifestid": "2382933349983046343",
      "buildid": "unknown",
      "branch": "public",
      "os": "windows",
      "language": "all",
      "date": "2024-08-12T18:00:00.000Z",
      "patch_note_id": "manual-739630-2024-08-12",
      "confidence_score": 70,
      "notes": "Ajout manuel. Disponibilité non garantie."
    }
  ]
}
```

