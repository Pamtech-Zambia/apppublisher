export default function Page() {
  return <main style={{maxWidth:760,margin:'64px auto',padding:24,fontFamily:'system-ui'}}>
    <h1>Google Play Deployment Assistant</h1>
    <p>Public MCP test deployment for evidence-first Google Play preparation.</p>
    <p><strong>Truthfulness gate:</strong> unsupported, contradicted, and prohibited claims are not treated as publishable metadata.</p>
    <p>Google Play account writes are disabled in this public test deployment.</p>
    <p>MCP endpoint: <code>/api/mcp</code></p><p>Health endpoint: <code>/api/health</code></p>
  </main>;
}
