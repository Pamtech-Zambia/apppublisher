import Analyzer from './components/Analyzer';
import PluginWorkspace from './components/PluginWorkspace';

export default function Page() {
  return <main>
    <section className="hero">
      <div className="heroInner">
        <span className="eyebrow">Google Play Deployment Assistant</span>
        <h1>Prepare your Android app for Google Play from one website.</h1>
        <p className="heroText">Analyze a public GitHub repository or inspect a local APK, AAB, or source ZIP. The assistant separates verified evidence from assumptions, flags release blockers, identifies missing Play information, and continues into the same listing, creative, Data Safety, policy, rejection, and release workflows exposed by the plugin.</p>
        <div className="heroBadges"><span>Evidence-first</span><span>No fake claims</span><span>Website = plugin workflows</span><span>MCP-ready</span></div>
      </div>
    </section>

    <section className="contentWrap">
      <div className="truthBanner"><strong>Truthfulness gate:</strong> unsupported, contradicted, or prohibited claims are never treated as publishable Play metadata. If the website cannot prove something, it says so and asks for the missing fact.</div>
      <Analyzer />
      <PluginWorkspace />
      <section className="howItWorks">
        <h2>What the website and plugin cover</h2>
        <div className="featureGrid">
          <article><strong>App evidence inspector</strong><p>Package ID, version, SDK levels, Android permissions, dependencies, remote services, assets, and likely policy-sensitive areas.</p></article>
          <article><strong>Privacy & Data Safety</strong><p>Analytics, ads, authentication, AI/cloud processing, sensitive data questions, deletion, and evidence gaps that require developer confirmation.</p></article>
          <article><strong>Listing & creative assets</strong><p>Metadata limits, claim verification, simple icon/feature graphic generation, and marketing screenshots composed only from real app screenshots.</p></article>
          <article><strong>Policy, rejection & release</strong><p>Submission-readiness gates, rejection triage, testing/reviewer-access checks, and a final release checklist without pretending to predict Google’s private review outcome.</p></article>
        </div>
      </section>
      <footer>
        <p>The public website and public plugin prepare, validate, and diagnose Google Play deployment work. They do not silently publish to a developer’s Play account. Developer-owned publishing remains a separately authorized mode using that developer’s own credentials.</p>
        <p><code>/api/mcp</code> · <code>/api/health</code></p>
      </footer>
    </section>
  </main>;
}
