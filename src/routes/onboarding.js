const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseConfig } = require('../core/config');
const { getCookieFilename } = require('../utils/cookie-helpers');
const fs = require('fs');

const router = express.Router();

// Initialize Supabase client
const supabaseConfig = getSupabaseConfig();
const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey);

// Helper function to convert email to numeric ID (matching userDatabase logic)
function emailToNumericId(email) {
  let hash = 0;
  const normalizedEmail = email.toLowerCase().trim();
  for (let i = 0; i < normalizedEmail.length; i++) {
    const char = normalizedEmail.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % 2147483647; // Ensure positive and within INTEGER range
}

/**
 * POST /api/onboarding/personal-info
 * Validate school and store personal info temporarily
 */
router.post('/personal-info', async (req, res) => {
  try {
    const { firstName, school, email } = req.body;

    if (!firstName || !school || !email) {
      return res.status(400).json({
        success: false,
        error: 'First name, school, and email are required'
      });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate school - must be "University of Colorado - Boulder" to proceed
    const validSchool = 'University of Colorado - Boulder';
    if (school !== validSchool) {
      // School is invalid - will be added to waitlist
      return res.json({
        success: false,
        validSchool: false,
        message: 'Only University of Colorado students can proceed'
      });
    }

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', normalizedEmail)
      .single();

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = not found
      console.error('[onboarding] Error checking existing user:', checkError);
      return res.status(500).json({
        success: false,
        error: 'Error checking existing user'
      });
    }

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Valid school - return success (data will be stored in frontend state/sessionStorage)
    return res.json({
      success: true,
      validSchool: true,
      data: {
        firstName,
        school,
        email: normalizedEmail
      }
    });

  } catch (error) {
    console.error('[onboarding] Error in personal-info:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/onboarding/validate-invite
 * Validate invite code
 */
router.post('/validate-invite', async (req, res) => {
  try {
    const { inviteCode } = req.body;

    if (!inviteCode) {
      return res.status(400).json({
        success: false,
        error: 'Invite code is required'
      });
    }

    const normalizedCode = inviteCode.toUpperCase().trim();

    // Check invite code in database
    const { data: inviteCodeData, error } = await supabase
      .from('invite_codes')
      .select('*')
      .eq('code', normalizedCode)
      .single();

    if (error || !inviteCodeData) {
      return res.json({
        success: false,
        valid: false,
        error: 'Invalid invite code'
      });
    }

    // Check if code is active
    if (!inviteCodeData.is_active) {
      return res.json({
        success: false,
        valid: false,
        error: 'Invite code is no longer active'
      });
    }

    // Check if code has reached max users
    if (inviteCodeData.current_users >= inviteCodeData.max_users) {
      return res.json({
        success: false,
        valid: false,
        error: 'Invite code has reached maximum users'
      });
    }

    // Valid invite code
    return res.json({
      success: true,
      valid: true,
      data: {
        code: normalizedCode,
        maxUsers: inviteCodeData.max_users,
        currentUsers: inviteCodeData.current_users
      }
    });

  } catch (error) {
    console.error('[onboarding] Error in validate-invite:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/onboarding/waitlist
 * Add user to waitlist table
 */
router.post('/waitlist', async (req, res) => {
  try {
    const { firstName, school, email } = req.body;

    if (!firstName || !school || !email) {
      return res.status(400).json({
        success: false,
        error: 'First name, school, and email are required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists in waitlist
    const { data: existingWaitlist, error: checkError } = await supabase
      .from('waitlist')
      .select('id')
      .eq('email', normalizedEmail)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('[onboarding] Error checking existing waitlist entry:', checkError);
      return res.status(500).json({
        success: false,
        error: 'Error checking waitlist'
      });
    }

    if (existingWaitlist) {
      // Already in waitlist
      return res.json({
        success: true,
        message: 'You are already on the waitlist',
        alreadyExists: true
      });
    }

    // Insert into waitlist table
    const { data, error } = await supabase
      .from('waitlist')
      .insert({
        first_name: firstName,
        school: school,
        email: normalizedEmail
      })
      .select()
      .single();

    if (error) {
      console.error('[onboarding] Error adding to waitlist:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to add to waitlist'
      });
    }

    return res.json({
      success: true,
      message: 'Successfully added to waitlist',
      data
    });

  } catch (error) {
    console.error('[onboarding] Error in waitlist:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/onboarding/sync
 * Save identikey and prepare for cookie extraction
 */
router.post('/sync', async (req, res) => {
  try {
    const { identikey, email, firstName, school, inviteCode } = req.body;

    if (!identikey || !email) {
      return res.status(400).json({
        success: false,
        error: 'Identikey and email are required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedIdentikey = identikey.trim();

    // Validate that we have all required onboarding data
    if (!firstName || !school || !inviteCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing onboarding data. Please start over.'
      });
    }

    // Store temporarily (will be used when creating user after cookie extraction)
    // In a real implementation, you might want to store this in Redis or a temporary table
    // For now, we'll rely on the frontend to send it again in the complete endpoint

    return res.json({
      success: true,
      message: 'Identikey saved. Proceed with cookie extraction.',
      data: {
        identikey: normalizedIdentikey,
        email: normalizedEmail
      }
    });

  } catch (error) {
    console.error('[onboarding] Error in sync:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/onboarding/complete
 * Create user in users table after successful cookie extraction
 */
router.post('/complete', async (req, res) => {
  try {
    const { email, firstName, school, inviteCode, identikey } = req.body;

    if (!email || !firstName || !school || !inviteCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedCode = inviteCode.toUpperCase().trim();

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', normalizedEmail)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('[onboarding] Error checking existing user:', checkError);
      return res.status(500).json({
        success: false,
        error: 'Error checking existing user'
      });
    }

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Get cookies from cookie file
    const cookieFile = getCookieFilename(normalizedEmail);
    let cookies = null;
    
    if (fs.existsSync(cookieFile)) {
      try {
        const cookieData = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
        cookies = cookieData.cookies || null;
      } catch (error) {
        console.error('[onboarding] Error reading cookie file:', error);
        // Continue without cookies - they can be added later
      }
    }

    // Generate numeric ID from email
    const numericId = emailToNumericId(normalizedEmail);

    // Create user in users table
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        id: numericId.toString(),
        numeric_id: numericId,
        email: normalizedEmail,
        name: firstName,
        school: school,
        cookies: cookies,
        invite_code_used: normalizedCode,
        onboarding_completed_at: new Date().toISOString()
      })
      .select()
      .single();

    if (createError) {
      console.error('[onboarding] Error creating user:', createError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create user account'
      });
    }

    // Increment invite code usage
    // First get current count
    const { data: codeData, error: fetchError } = await supabase
      .from('invite_codes')
      .select('current_users')
      .eq('code', normalizedCode)
      .single();

    if (!fetchError && codeData) {
      const { error: updateCodeError } = await supabase
        .from('invite_codes')
        .update({
          current_users: (codeData.current_users || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('code', normalizedCode);

      if (updateCodeError) {
        console.error('[onboarding] Error updating invite code usage:', updateCodeError);
        // Don't fail the request - user is created, just log the error
      }
    }

    return res.json({
      success: true,
      message: 'User account created successfully',
      data: {
        userId: newUser.id,
        email: newUser.email
      }
    });

  } catch (error) {
    console.error('[onboarding] Error in complete:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;

