import Layout from "@/components/Layout";

const PrivacyPolicy = () => {
  return (
    <Layout>
      <div className="px-5 sm:px-8 pb-10 max-w-4xl mx-auto">
        <h1 className="page-header mb-6">Privacy Policy</h1>
        
        <div className="space-y-6 text-foreground/80">
          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">1. Information We Collect</h2>
            <p className="mb-2">
              We collect information that you provide directly to us, including:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Email address for account authentication</li>
              <li>Canvas course and assignment data that you authorize us to access</li>
              <li>Integration credentials (OAuth tokens) for Google Sheets and Notion, stored securely and encrypted</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">2. How We Use Your Information</h2>
            <p className="mb-2">We use the information we collect to:</p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Provide and maintain our service</li>
              <li>Sync your assignments to Google Sheets and Notion as requested</li>
              <li>Improve and personalize your experience</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">3. Data Storage and Security</h2>
            <p>
              Your data is stored securely using Supabase. OAuth tokens are encrypted at rest. 
              We implement industry-standard security measures to protect your information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">4. Third-Party Services</h2>
            <p className="mb-2">
              We integrate with the following third-party services:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li><strong>Google Sheets</strong> - To sync your assignments (only with your explicit authorization)</li>
              <li><strong>Notion</strong> - To sync your assignments (only with your explicit authorization)</li>
              <li><strong>Canvas LMS</strong> - To access your course data (only with your explicit authorization)</li>
            </ul>
            <p className="mt-2">
              These services have their own privacy policies. We encourage you to review them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">5. Your Rights</h2>
            <p className="mb-2">You have the right to:</p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Access your personal data</li>
              <li>Delete your account and associated data</li>
              <li>Disconnect integrations at any time</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-foreground">6. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us at your support email.
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

export default PrivacyPolicy;




