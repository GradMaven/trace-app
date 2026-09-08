import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Doc {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  checksumSha256: string;
  processingStatus: string;
  scanStatus: string;
  storageDriver: string;
  createdAt: string;
}

export default async function DocumentsPage() {
  const res = await serverFetch<{ data: Doc[] }>('/documents?limit=100');
  const rows = res.data?.data ?? [];

  return (
    <div>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Documents</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Stored files. Content-addressed by SHA-256; downloads use short-lived signed URLs. Upload
        from the &ldquo;Add evidence&rdquo; flow or the supplier portal.
      </p>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Filename</th>
              <th>Type</th>
              <th>Size</th>
              <th>Scan</th>
              <th>Storage</th>
              <th>Checksum</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.filename}</td>
                <td className="muted">{d.mime}</td>
                <td className="muted">{(d.sizeBytes / 1024).toFixed(1)} KB</td>
                <td>
                  <span className="tag">{d.scanStatus}</span>
                </td>
                <td className="muted">{d.storageDriver}</td>
                <td className="mono muted" title={d.checksumSha256}>
                  {d.checksumSha256.slice(0, 12)}…
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No documents yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
