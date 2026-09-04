# barker

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.13. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## VOD archiving

Records tracked streams live and uploads them to remote storage, so a recording
survives the streamer deleting their VOD. Runs as a separate `recorder`
container — see [docs/vod-archiving.md](docs/vod-archiving.md) and
`docker-compose.example.yml`.
