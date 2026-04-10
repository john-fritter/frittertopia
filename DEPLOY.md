# Deploying Frittertopia

Frittertopia runs as a Docker container on fritter.lol, proxied by Caddy at `wss://topia.fritter.lol`.

## Prerequisites

- Docker + Docker Compose on the host
- The host must have the `seedbox_default` Docker network (shared with Caddy)

## Initial Deploy

```bash
git clone git@github.com:john-fritter/frittertopia.git
cd frittertopia
docker compose up -d --build
```

## Updating

```bash
cd /home/cleo/frittertopia
git pull
docker compose up -d --build
```

This rebuilds the image and recreates the container. The `data/` volume mount preserves the world DB across rebuilds.

## Where Things Live

- **Container**: `frittertopia-frittertopia-1`
- **DB**: `./data/world.db` (host: `/home/cleo/frittertopia/data/world.db`)
- **Content**: `./content/` (mounted into container)
- **Port**: 3000 (internal Docker network only, not exposed to host)

## Backing Up the World DB

```bash
# SQLite backup (safe while running — WAL mode)
cp /home/cleo/frittertopia/data/world.db /path/to/backup/world.db
cp /home/cleo/frittertopia/data/world.db-wal /path/to/backup/world.db-wal
cp /home/cleo/frittertopia/data/world.db-shm /path/to/backup/world.db-shm
```

Or use `sqlite3 .backup` for a guaranteed-consistent backup:

```bash
docker compose exec frittertopia sh -c 'sqlite3 /app/data/world.db ".backup /app/data/world-backup.db"'
cp /home/cleo/frittertopia/data/world-backup.db /path/to/backup/
```

## Resetting the World

```bash
cd /home/cleo/frittertopia
docker compose down
rm -rf data/world.db data/world.db-wal data/world.db-shm
docker compose up -d
```

Or from inside the container: restart with `--fresh` arg.

## Caddy Block

```caddyfile
topia.fritter.lol {
  reverse_proxy frittertopia:3000

  log {
    output file /var/log/caddy/access.log
    format json
  }
}
```

Caddy handles WebSocket upgrades automatically. The hostname `frittertopia` matches the container name on the `seedbox_default` Docker network.

## Testing

From any external machine:

```bash
npx wscat -c wss://topia.fritter.lol
```

You should get a name prompt, be able to enter a name, and walk around the monastery.
