# Upgrading

Make a [backup](/en/backup) first, then run next to `docker-compose.yml`:

```bash
docker compose pull && docker compose down && docker compose up -d
```

`down` stops every service before the new version starts, so werkbuch is offline for as long as the start takes; the volumes stay. Without `down`, `up -d` would create `werkbuch` anew first, and it migrates the database while the old workers keep running the old code against the new schema until Compose reaches them.

With the [standalone compose file](/en/setup#quick-start-paste-and-deploy) in Dockge or Portainer: stop the stack, then pull the image again and start it (Dockge: **Stop**, then **Update**; Portainer: stop the stack, then update it with the image pulled again).

On start the new version migrates the database, sends the settings of the search indexes to Meilisearch, fills the indexes again when this version adds fields to them, and builds its caches and the OpenAPI document; [Setup](/en/setup#start) lists every step. `docker compose restart` alone keeps the old image.

- **Pinned version:** change `WERKBUCH_IMAGE` in `.env` first (e.g. `baeroe/werkbuch:0.2.0`), or the `image:` line of the standalone compose file.
- **Compose file:** the notes below say when `docker-compose.yml` changed. Download it again and keep your own changes in `docker-compose.override.yml`:
  `curl -fsSLO https://raw.githubusercontent.com/baeroe/werkbuch/main/docker-compose.yml`
  With the standalone compose file, paste the new [docker-compose.standalone.yml](https://github.com/baeroe/werkbuch/blob/main/docker-compose.standalone.yml) and copy your values from the block at the top into it.
- **MariaDB:** patch versions upgrade themselves on start (`MARIADB_AUTO_UPGRADE`). A new major version only comes with a note here.
- **Meilisearch:** a new version of Meilisearch does not always read the index an older one wrote; it then stops with an error about the version of its database (`docker compose logs meilisearch`), and `werkbuch` does not start. The index comes from the database, so delete it and let werkbuch build it again:

  ```bash
  docker compose rm -sf meilisearch
  docker volume rm werkbuch_meili-data     # <project>_meili-data, see docker volume ls
  docker compose up -d
  docker compose restart werkbuch
  ```

  The start of `werkbuch` finds the index empty and imports everything; until then the search is empty. `up -d` alone does not start a `werkbuch` that is still running (going back to the older Meilisearch, for example), hence the `restart`. Going back to the older Meilisearch afterwards only works with the same steps.
- **Going back:** migrations are not rolled back. Restore the backup and pin the old version.

All versions and their changes: https://github.com/baeroe/werkbuch/releases

## Notes per version

<!-- absolute links only: each section becomes the notes of its GitHub release -->

### 0.1.0

- First release: projects with members, work items with your own types, properties and workflows, list, board, table and timeline, saved views, a wiki per project, templates with schedules, automations, notifications with mail and live updates, search, a REST API with its OpenAPI reference, an MCP server for AI agents and signed webhooks, in English and German.
- Image `baeroe/werkbuch:0.1.0` for `linux/amd64` and `linux/arm64`. Runs as a Docker Compose stack with MariaDB 11.4 and Meilisearch 1.56, see [Setup](https://github.com/baeroe/werkbuch/blob/main/docs/en/setup.md).
