/**
 * Unit tests for Email Service
 * Tests admin notification emails via EmailJS
 */

const assert = require("assert");
const sinon = require("sinon");
const proxyquire = require("proxyquire");

describe("Email Service", () => {
  let emailService;
  let mockEmailjs;
  let originalEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Set up test environment variables
    process.env.EMAILJS_PRIVATE_KEY = "test-private-key";
    process.env.EMAILJS_SERVICE_ID = "test-service-id";
    process.env.EMAILJS_PUBLIC_KEY = "test-public-key";
    process.env.EMAILJS_ADMIN_TEMPLATE_ID = "test-template-id";

    // Create mock EmailJS
    mockEmailjs = {
      send: sinon.stub().resolves({ status: 200, text: "OK" }),
    };

    // Use proxyquire to inject mock
    emailService = proxyquire("../../../../src/services/email", {
      "@emailjs/nodejs": mockEmailjs,
    });
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    sinon.restore();
  });

  describe("sendAdminNotification", () => {
    it("should send notification with all required fields", async () => {
      const result = await emailService.sendAdminNotification({
        userEmail: "test@colorado.edu",
        userName: "Test User",
        school: "University of Colorado - Boulder",
        inviteCode: "TEST123",
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 200);
      assert(mockEmailjs.send.calledOnce);

      // Verify template params
      const callArgs = mockEmailjs.send.firstCall.args;
      assert.strictEqual(callArgs[0], "test-service-id");
      assert.strictEqual(callArgs[1], "test-template-id");

      const templateParams = callArgs[2];
      assert.strictEqual(templateParams.user_name, "Test User");
      assert.strictEqual(templateParams.user_email, "test@colorado.edu");
      assert.strictEqual(
        templateParams.school,
        "University of Colorado - Boulder",
      );
      assert.strictEqual(templateParams.invite_code, "TEST123");
      assert(templateParams.signup_time); // Should have timestamp
    });

    it("should handle missing invite code gracefully", async () => {
      const result = await emailService.sendAdminNotification({
        userEmail: "test@colorado.edu",
        userName: "Test User",
        school: "University of Colorado - Boulder",
      });

      assert.strictEqual(result.success, true);

      const templateParams = mockEmailjs.send.firstCall.args[2];
      assert.strictEqual(templateParams.invite_code, "N/A");
    });

    it("should skip notification when private key is not configured", async () => {
      delete process.env.EMAILJS_PRIVATE_KEY;

      // Re-require module to pick up env change
      delete require.cache[require.resolve("../../../../src/services/email")];
      const emailServiceNoKey = require("../../../../src/services/email");

      const result = await emailServiceNoKey.sendAdminNotification({
        userEmail: "test@colorado.edu",
        userName: "Test User",
        school: "University of Colorado - Boulder",
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.reason, "not_configured");
    });

    it("should handle EmailJS API errors", async () => {
      mockEmailjs.send.rejects(new Error("API rate limit exceeded"));

      const result = await emailService.sendAdminNotification({
        userEmail: "test@colorado.edu",
        userName: "Test User",
        school: "University of Colorado - Boulder",
      });

      assert.strictEqual(result.success, false);
      assert(result.error.includes("rate limit"));
    });

    it("should handle EmailJS 403 forbidden error", async () => {
      mockEmailjs.send.rejects({
        status: 403,
        text: "API calls are disabled for non-browser applications",
      });

      const result = await emailService.sendAdminNotification({
        userEmail: "test@colorado.edu",
        userName: "Test User",
        school: "University of Colorado - Boulder",
      });

      assert.strictEqual(result.success, false);
    });

    it("should skip when EMAILJS_SERVICE_ID is not configured", async () => {
      delete process.env.EMAILJS_SERVICE_ID;

      delete require.cache[require.resolve("../../../../src/services/email")];
      const emailServicePartial = proxyquire("../../../../src/services/email", {
        "@emailjs/nodejs": mockEmailjs,
      });

      const result = await emailServicePartial.sendAdminNotification({
        userEmail: "test@colorado.edu",
        userName: "Test User",
        school: "University of Colorado - Boulder",
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.reason, "not_configured");
      assert(mockEmailjs.send.notCalled);
    });

    it("should skip when EMAILJS_ADMIN_TEMPLATE_ID is not configured", async () => {
      delete process.env.EMAILJS_ADMIN_TEMPLATE_ID;

      delete require.cache[require.resolve("../../../../src/services/email")];
      const emailServicePartial = proxyquire("../../../../src/services/email", {
        "@emailjs/nodejs": mockEmailjs,
      });

      const result = await emailServicePartial.sendAdminNotification({
        userEmail: "test@colorado.edu",
        userName: "Test User",
        school: "University of Colorado - Boulder",
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.reason, "not_configured");
      assert(mockEmailjs.send.notCalled);
    });

    it("should include signup time in Mountain timezone", async () => {
      await emailService.sendAdminNotification({
        userEmail: "test@colorado.edu",
        userName: "Test User",
        school: "University of Colorado - Boulder",
      });

      const templateParams = mockEmailjs.send.firstCall.args[2];
      assert(templateParams.signup_time);
      // Verify it's a valid date string (contains month, day, time)
      assert(
        /\w+ \d+, \d{4}/.test(templateParams.signup_time) ||
          /\d+\/\d+\/\d+/.test(templateParams.signup_time),
      );
    });

    it("should pass correct authentication options", async () => {
      await emailService.sendAdminNotification({
        userEmail: "test@colorado.edu",
        userName: "Test User",
        school: "University of Colorado - Boulder",
      });

      const authOptions = mockEmailjs.send.firstCall.args[3];
      assert.strictEqual(authOptions.publicKey, "test-public-key");
      assert.strictEqual(authOptions.privateKey, "test-private-key");
    });
  });
});

describe("Email Service - Feedback Modal Integration", () => {
  // Note: FeedbackModal uses client-side @emailjs/browser
  // These tests document the expected configuration for reference

  it("should document feedback email configuration uses VITE_EMAILJS_* env vars", () => {
    const feedbackConfig = {
      serviceId: "VITE_EMAILJS_SERVICE_ID",
      templateId: "VITE_EMAILJS_TEMPLATE_ID",
      publicKey: "VITE_EMAILJS_PUBLIC_KEY",
      templateVariables: [
        "from_name",
        "from_email",
        "message",
        "image_data",
        "favorite_features",
      ],
    };

    assert(feedbackConfig.serviceId);
    assert(feedbackConfig.templateId);
    assert(feedbackConfig.publicKey);
    assert.strictEqual(feedbackConfig.templateVariables.length, 5);
  });

  it("should document admin notification configuration uses server env vars", () => {
    const adminConfig = {
      serviceId: "EMAILJS_SERVICE_ID",
      templateId: "EMAILJS_ADMIN_TEMPLATE_ID",
      publicKey: "EMAILJS_PUBLIC_KEY",
      privateKey: "required-for-server-side",
      templateVariables: [
        "user_name",
        "user_email",
        "school",
        "invite_code",
        "signup_time",
      ],
    };

    assert(adminConfig.serviceId);
    assert(adminConfig.templateId);
    assert(adminConfig.publicKey);
    assert(adminConfig.privateKey);
    assert.strictEqual(adminConfig.templateVariables.length, 5);
  });
});
