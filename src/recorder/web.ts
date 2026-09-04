import { env } from "../config";
import { logger } from "../utils/logger";
import {
  getParts,
  listArchives,
  type VodArchive,
} from "../database/repositories/vodArchives";

export interface ArchiveView extends VodArchive {
  uploaded_parts: number;
  total_parts: number;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDuration(
  startedAt: string,
  endedAt: string | null,
): string {
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";

  const minutes = Math.floor((end - start) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Stream titles are broadcaster-controlled text, so everything interpolated
// into the page goes through escapeHtml.
export function renderPage(archives: ArchiveView[]): string {
  const rows = archives
    .map((archive) => {
      const progress =
        archive.total_parts > 0
          ? `${archive.uploaded_parts}/${archive.total_parts}`
          : "—";

      return `<tr>
      <td><span class="platform ${archive.platform}">${archive.platform}</span></td>
      <td class="streamer">${escapeHtml(archive.streamer_login)}</td>
      <td class="title">${escapeHtml(archive.title ?? "")}</td>
      <td class="mono">${escapeHtml(archive.started_at.replace("T", " ").slice(0, 16))}</td>
      <td class="mono">${escapeHtml(formatDuration(archive.started_at, archive.ended_at))}</td>
      <td><span class="status ${archive.status}">${archive.status}</span></td>
      <td class="mono">${progress}</td>
      <td class="mono">${escapeHtml(formatBytes(archive.bytes))}</td>
      <td class="mono path">${escapeHtml(archive.drive_folder ?? "—")}</td>
    </tr>`;
    })
    .join("\n");

  const empty = `<tr><td colspan="9" class="empty">Nothing archived yet.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Barker · VOD archive</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #e2e8f0; min-height: 100vh; padding: 2rem 1rem;
  }
  .wrap { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: .25rem; }
  h1 span { color: #3b82f6; }
  .sub { color: #94a3b8; font-size: .875rem; margin-bottom: 1.5rem; }
  .scroll { overflow-x: auto; border-radius: .75rem; border: 1px solid #334155; }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th {
    text-align: left; padding: .75rem 1rem; background: #1e293b;
    font-weight: 500; color: #94a3b8; white-space: nowrap;
    font-size: .75rem; text-transform: uppercase; letter-spacing: .05em;
  }
  td { padding: .75rem 1rem; border-top: 1px solid #1e293b; vertical-align: top; }
  tr:hover td { background: rgba(30, 41, 59, .5); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
  .streamer { font-weight: 600; }
  .title { max-width: 22rem; color: #cbd5e1; }
  .path { color: #64748b; max-width: 18rem; overflow: hidden; text-overflow: ellipsis; }
  .empty { text-align: center; color: #64748b; padding: 3rem 1rem; }
  .platform, .status {
    display: inline-block; padding: .125rem .5rem; border-radius: 999px;
    font-size: .75rem; font-weight: 500; white-space: nowrap;
  }
  .platform.twitch { background: rgba(145, 70, 255, .15); color: #a970ff; }
  .platform.kick { background: rgba(83, 252, 24, .12); color: #53fc18; }
  .status.recording { background: rgba(239, 68, 68, .15); color: #f87171; }
  .status.uploading { background: rgba(59, 130, 246, .15); color: #60a5fa; }
  .status.pending   { background: rgba(148, 163, 184, .15); color: #94a3b8; }
  .status.done      { background: rgba(34, 197, 94, .15); color: #4ade80; }
  .status.recovered { background: rgba(234, 179, 8, .15); color: #facc15; }
  .status.failed    { background: rgba(239, 68, 68, .2); color: #fca5a5; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Barker <span>·</span> VOD archive</h1>
    <p class="sub">${archives.length} broadcast${archives.length === 1 ? "" : "s"} tracked · page refreshes every 30s</p>
    <div class="scroll">
      <table>
        <thead><tr>
          <th>Platform</th><th>Streamer</th><th>Title</th><th>Started</th>
          <th>Length</th><th>Status</th><th>Parts</th><th>Size</th><th>Destination</th>
        </tr></thead>
        <tbody>
${rows || empty}
        </tbody>
      </table>
    </div>
  </div>
  <script>setTimeout(() => location.reload(), 30000);</script>
</body>
</html>`;
}

export function collectArchiveViews(limit = 200): ArchiveView[] {
  return listArchives(limit).map((archive) => {
    const parts = getParts(archive.id);
    return {
      ...archive,
      total_parts: parts.length,
      uploaded_parts: parts.filter((part) => part.status === "uploaded").length,
    };
  });
}

export function startWebServer() {
  const server = Bun.serve({
    port: env.ARCHIVE_WEB_PORT,
    hostname: "0.0.0.0",
    fetch(request) {
      const { pathname } = new URL(request.url);

      if (pathname === "/api/vods") {
        return Response.json(collectArchiveViews());
      }

      if (pathname === "/" || pathname === "/vods") {
        return new Response(renderPage(collectArchiveViews()), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  logger.info(`[Recorder] Status page listening on :${server.port}`);
  return server;
}
