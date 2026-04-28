const emailjs = require("@emailjs/nodejs");

// EmailJS: configure via env only (see deployment docs)
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
const EMAILJS_ADMIN_TEMPLATE_ID = process.env.EMAILJS_ADMIN_TEMPLATE_ID;

/**
 * Send admin notification when a new user signs up and is pending extraction
 * @param {Object} params
 * @param {string} params.userEmail - The user's email address
 * @param {string} params.userName - The user's first name
 * @param {string} params.school - The user's school
 * @param {string} [params.inviteCode] - The invite code used
 */
async function sendAdminNotification({
  userEmail,
  userName,
  school,
  inviteCode,
}) {
  if (
    !EMAILJS_PRIVATE_KEY ||
    !EMAILJS_SERVICE_ID ||
    !EMAILJS_PUBLIC_KEY ||
    !EMAILJS_ADMIN_TEMPLATE_ID
  ) {
    console.log(
      "[email] EmailJS not fully configured - skipping admin notification",
    );
    return { success: false, reason: "not_configured" };
  }

  try {
    const templateParams = {
      user_name: userName,
      user_email: userEmail,
      school: school,
      invite_code: inviteCode || "N/A",
      signup_time: new Date().toLocaleString("en-US", {
        timeZone: "America/Denver",
        dateStyle: "medium",
        timeStyle: "short",
      }),
    };

    const response = await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_ADMIN_TEMPLATE_ID,
      templateParams,
      {
        publicKey: EMAILJS_PUBLIC_KEY,
        privateKey: EMAILJS_PRIVATE_KEY,
      },
    );

    console.log(
      `[email] Admin notification sent for ${userEmail}, status: ${response.status}`,
    );
    return { success: true, status: response.status };
  } catch (error) {
    console.error("[email] Failed to send admin notification:", error);
    return { success: false, error: error.message || error };
  }
}

module.exports = {
  sendAdminNotification,
};
