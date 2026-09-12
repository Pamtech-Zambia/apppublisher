import Analyzer from './components/Analyzer';

export default function Page() {
  return <main>
    <section className="hero">
      <div className="heroInner">
        <span className="eyebrow">Google Play Deployment Assistant</span>
        <h1>Prepare your Android app for Google Play from one website.</h1>
        <p className="heroText">Analyze a public GitHub repository or inspect a local APK, AAB, or source ZIP. The assistant separates verified evidence from assumptions, flags release blockers, identifies missing Play information, and suggests store-listing and screenshot work without inventing what your app does.</p>
        <div className="heroBadges"><span>Evidence-first</span><span>No fake claims</span><span>Browser-local file inspection</span><span>MCP-ready</span></div>
      </div>
    </section>

    <section className="contentWrap">
      <div className="truthBanner"><strong>Truthfulness gate:</strong> unsupported, contradicted, or prohibited claims are never treated as publishable Play metadata. If the website cannot prove something, it says so and asks for the missing fact.</div>
      <Analyzer />
      <section className="howItWorks">
        <h2>What the website checks</h2>
        <div className="featureGrid">
          <article><strong>App identity & build</strong><p>Package ID, version, SDK levels, Android permissions, and build configuration when source evidence is available.</p></article>
          <article><strong>Privacy & SDK signals</strong><p>Analytics, ads, authentication, billing, AI services, remote hosts, sensitive permissions, and possible secret exposure.</p></article>
          <article><strong>Play readiness</strong><p>Current target API baseline, policy-sensitive areas, missing developer facts, privacy questions, and reviewer-access concerns.</p></article>
          <article><strong>Store presence</strong><p>Existing icons, screenshots, feature graphics, privacy-policy files, and a safe first-pass listing/screenshot plan.</p></article>
        </div>
      </section>
      <footer>
        <p>Public website analysis does not publish to Google Play or access your Play Console. Developer-owned publishing remains a separate, explicitly authorized mode.</p>
        <p><code>/api/mcp</code> · <code>/api/health</code></p>
      </footer>
    </section>
  </main>;
}
