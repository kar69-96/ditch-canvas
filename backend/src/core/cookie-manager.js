const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * CookieManager - Secure cookie storage and management for headless authentication
 */
class CookieManager {
  constructor(options = {}) {
    // Use standard cookie file path: data/auth/canvas-cookies.json
    this.cookieDir = options.cookieDir || path.join(process.cwd(), 'data', 'auth');
    this.encryptionKey = options.encryptionKey || process.env.COOKIE_ENCRYPTION_KEY;
    this.defaultTTL = options.ttl || parseInt(process.env.COOKIE_TTL) || 86400000; // 24h
    this.canvasUrl = options.canvasUrl || 'https://canvas.colorado.edu';
    // Use standard cookie file name to match extract-cookies.js
    this.cookieFile = path.join(this.cookieDir, 'canvas-cookies.json');

    if (!this.encryptionKey) {
      this.encryptionKey = crypto.randomBytes(32).toString('hex');
      console.warn('No COOKIE_ENCRYPTION_KEY found, generated temporary key');
      console.warn('Add to .env: COOKIE_ENCRYPTION_KEY=' + this.encryptionKey);
    }
    this.ensureCookieDirectory();
  }

  ensureCookieDirectory() {
    if (!fs.existsSync(this.cookieDir)) {
      fs.mkdirSync(this.cookieDir, { recursive: true });
      console.log(`Created cookie directory: ${this.cookieDir}`);
    }
  }

  encrypt(text) {
    try {
      const key = Buffer.from(this.encryptionKey, 'hex');
      const cipher = crypto.createCipher('aes-256-cbc', key);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return { encrypted, iv: '' };
    } catch (e) {
      return { encrypted: Buffer.from(text).toString('base64'), iv: '', fallback: true };
    }
  }

  decrypt(encryptedData) {
    try {
      if (encryptedData.fallback) {
        return Buffer.from(encryptedData.encrypted, 'base64').toString('utf8');
      }
      const key = Buffer.from(this.encryptionKey, 'hex');
      const decipher = crypto.createDecipher('aes-256-cbc', key);
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      return null;
    }
  }

  filterCanvasCookies(cookies) {
    if (!Array.isArray(cookies)) return [];
    // Keep every valid cookie so Browserbase inherits cross-domain SSO state (Canvas + CU login, etc.)
    return cookies
      .filter((cookie) => cookie && typeof cookie.name === 'string' && typeof cookie.value !== 'undefined')
      .map((cookie) => ({ ...cookie }));
  }

  async saveCookies(cookies, metadata = {}) {
    try {
      const filtered = this.filterCanvasCookies(cookies);
      if (filtered.length === 0) throw new Error('No valid Canvas cookies to save');
      
      // Use the same format as extract-cookies.js for compatibility
      const cookieData = {
        version: '1.0',
        cookies: filtered,
        metadata: {
          ...metadata,
          extractedAt: metadata.extractedAt || new Date().toISOString(),
          savedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + this.defaultTTL).toISOString(),
          source: metadata.source || 'cookie-manager',
          canvasUrl: this.canvasUrl,
          userAgent: metadata.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      };
      
      // Save in plain JSON format (same as extract-cookies.js)
      // This ensures compatibility with all endpoints that read canvas-cookies.json
      fs.writeFileSync(this.cookieFile, JSON.stringify(cookieData, null, 2));
      console.log(`💾 Saved ${filtered.length} Canvas cookies to ${this.cookieFile}`);
      return true;
    } catch (e) {
      console.error('Failed to save cookies:', e.message);
      return false;
    }
  }

  async loadCookies() {
    try {
      if (!fs.existsSync(this.cookieFile)) return null;
      
      const fileContent = fs.readFileSync(this.cookieFile, 'utf8');
      const parsed = JSON.parse(fileContent);
      
      // Check if it's the new plain format (from extract-cookies.js)
      if (parsed.version && parsed.cookies && parsed.metadata) {
        // Plain JSON format - return as-is
        return parsed;
      }
      
      // Check if it's the old encrypted format
      if (parsed.encrypted) {
        const decrypted = this.decrypt(parsed.encrypted);
        if (!decrypted) return null;
        return JSON.parse(decrypted);
      }
      
      // Fallback: try to parse as plain format without version check
      if (parsed.cookies && Array.isArray(parsed.cookies)) {
        return parsed;
      }
      
      return null;
    } catch (e) {
      console.error('Error loading cookies:', e.message);
      return null;
    }
  }

  async validateCookies() {
    const data = await this.loadCookies();
    if (!data) return false;
    const expiresAt = new Date(data.metadata.expiresAt);
    if (new Date() > expiresAt) return false;
    const essential = ['canvas_session', '_legacy_normandy_session'];
    return essential.some((n) => data.cookies.some((c) => c.name === n));
  }

  clearCookies() {
    if (fs.existsSync(this.cookieFile)) {
      fs.unlinkSync(this.cookieFile);
      return true;
    }
    return false;
  }

  getCookieInfo() {
    if (!fs.existsSync(this.cookieFile)) return { exists: false };
    const stats = fs.statSync(this.cookieFile);
    return { exists: true, size: stats.size, modified: stats.mtime, path: this.cookieFile };
  }

  async applyCookiesToPage(page) {
    try {
      const data = await this.loadCookies();
      if (!data) {
        console.log('❌ No cookie data found');
        return false;
      }
      if (!data.cookies) {
        console.log('❌ No cookies in data');
        return false;
      }
      
      console.log(`🍪 Applying ${data.cookies.length} cookies to page...`);
      console.log('📊 Cookie names:', data.cookies.map(c => c.name).join(', '));
      
      if (typeof page.setCookie === 'function') {
        await page.setCookie(...data.cookies);
        if (data.metadata.userAgent && typeof page.setUserAgent === 'function') {
          console.log('🔄 Setting user agent:', data.metadata.userAgent);
          await page.setUserAgent(data.metadata.userAgent);
        }
      } else if (page.context && typeof page.context === 'function') {
        const context = page.context();
        if (context && typeof context.addCookies === 'function') {
          const cookies = data.cookies.map((cookie) => {
            const { name, value, domain, path = '/', expires, httpOnly, secure, sameSite } = cookie;
            return {
              name,
              value,
              domain: domain?.replace(/^(https?:\/\/)/, '') || new URL(this.canvasUrl).hostname,
              path,
              expires: expires || undefined,
              httpOnly: !!httpOnly,
              secure: !!secure,
              sameSite: sameSite || 'Lax',
            };
          });
          await context.addCookies(cookies);
          if (data.metadata.userAgent && typeof context.setExtraHTTPHeaders === 'function') {
            console.log('🔄 Setting user agent via header:', data.metadata.userAgent);
            await context.setExtraHTTPHeaders({ 'User-Agent': data.metadata.userAgent });
          }
        }
      } else {
        throw new Error('Unsupported page object for cookie injection.');
      }
      
      console.log('✅ Cookies applied successfully');
      return true;
    } catch (e) {
      console.log('❌ Error applying cookies:', e.message);
      return false;
    }
  }

  async extractAndSaveCookies(page, metadata = {}) {
    try {
      const cookies = await page.cookies();
      const userAgent = await page.evaluate(() => navigator.userAgent);
      return await this.saveCookies(cookies, { ...metadata, userAgent, extractedFrom: 'puppeteer-page' });
    } catch (e) {
      return false;
    }
  }
}

module.exports = CookieManager;
