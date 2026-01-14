import Layout from "@/components/Layout";

const TermsOfUse = () => {
  return (
    <Layout>
      <div className="px-5 sm:px-8 pb-10 max-w-4xl mx-auto">
        <h1 className="page-header mb-6">Terms of Use</h1>
        
        <div className="space-y-6 text-foreground/80">
          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">1. Acceptance of Terms</h2>
            <p>
              By accessing and using this service, you accept and agree to be bound by the terms 
              and provision of this agreement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">2. Use License</h2>
            <p className="mb-2">Permission is granted to use this service for personal, non-commercial purposes. This license shall automatically terminate if you violate any of these restrictions.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">3. User Accounts</h2>
            <p className="mb-2">You are responsible for:</p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Maintaining the confidentiality of your account credentials</li>
              <li>All activities that occur under your account</li>
              <li>Authorizing access to your Canvas, Google Sheets, and Notion accounts</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">4. Service Availability</h2>
            <p>
              We strive to provide reliable service but do not guarantee uninterrupted access. 
              The service may be temporarily unavailable due to maintenance or technical issues.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">5. Data Sync</h2>
            <p>
              When you enable integrations with Google Sheets or Notion, your assignment data 
              will be synced to those services. You can disconnect integrations at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">6. Limitation of Liability</h2>
            <p>
              The service is provided "as is" without warranties of any kind. We are not liable 
              for any damages arising from the use or inability to use the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">7. Changes to Terms</h2>
            <p>
              We reserve the right to modify these terms at any time. Continued use of the service 
              after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">8. Contact</h2>
            <p>
              For questions about these Terms of Use, please contact us at your support email.
            </p>
          </section>

          <section>
            <p className="text-sm text-muted-foreground">
              Last updated: {new Date().toLocaleDateString()}
            </p>
          </section>
        </div>
      </div>
    </Layout>
  );
};

export default TermsOfUse;





