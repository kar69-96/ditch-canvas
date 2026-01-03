const assert = require('assert');
const { encryptToken, decryptToken } = require('../../src/services/integrations/token-crypto');

describe('TokenCrypto', () => {
  let originalEnvKey;

  before(() => {
    // Save original env
    originalEnvKey = process.env.INTEGRATIONS_TOKEN_ENC_KEY;
    // Set test key (32 bytes = 256 bits)
    process.env.INTEGRATIONS_TOKEN_ENC_KEY = Buffer.from('12345678901234567890123456789012').toString('base64');
  });

  after(() => {
    // Restore original env
    process.env.INTEGRATIONS_TOKEN_ENC_KEY = originalEnvKey;
  });

  describe('encryptToken', () => {
    it('should encrypt a token payload', () => {
      const payload = { access_token: 'secret123', expires_in: 3600 };
      const encrypted = encryptToken(payload);
      
      assert(typeof encrypted === 'string');
      assert(encrypted.includes('.')); // Should have IV.TAG.DATA format
      
      const parts = encrypted.split('.');
      assert.strictEqual(parts.length, 3);
    });

    it('should produce different ciphertext for same payload', () => {
      const payload = { access_token: 'secret123' };
      const encrypted1 = encryptToken(payload);
      const encrypted2 = encryptToken(payload);
      
      // Different due to random IV
      assert.notStrictEqual(encrypted1, encrypted2);
    });
  });

  describe('decryptToken', () => {
    it('should decrypt encrypted token', () => {
      const original = { access_token: 'secret123', refresh_token: 'refresh456' };
      const encrypted = encryptToken(original);
      const decrypted = decryptToken(encrypted);
      
      assert.deepStrictEqual(decrypted, original);
    });

    it('should throw on invalid format', () => {
      assert.throws(() => {
        decryptToken('invalid-format');
      }, /Invalid encrypted token format/);
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encryptToken({ test: 'data' });
      const [iv, tag, data] = encrypted.split('.');
      
      // Tamper with data
      const tampered = `${iv}.${tag}.${Buffer.from('tampered').toString('base64')}`;
      
      assert.throws(() => {
        decryptToken(tampered);
      });
    });

    it('should throw on empty string', () => {
      assert.throws(() => {
        decryptToken('');
      }, /Invalid encrypted token format/);
    });
  });

  describe('getKey', () => {
    it('should throw if INTEGRATIONS_TOKEN_ENC_KEY is not set', () => {
      const savedKey = process.env.INTEGRATIONS_TOKEN_ENC_KEY;
      delete process.env.INTEGRATIONS_TOKEN_ENC_KEY;
      
      assert.throws(() => {
        encryptToken({ test: 'data' });
      }, /INTEGRATIONS_TOKEN_ENC_KEY is not set/);
      
      process.env.INTEGRATIONS_TOKEN_ENC_KEY = savedKey;
    });

    it('should throw if key is not 32 bytes', () => {
      const savedKey = process.env.INTEGRATIONS_TOKEN_ENC_KEY;
      process.env.INTEGRATIONS_TOKEN_ENC_KEY = 'short';
      
      assert.throws(() => {
        encryptToken({ test: 'data' });
      }, /must decode to 32 bytes/);
      
      process.env.INTEGRATIONS_TOKEN_ENC_KEY = savedKey;
    });
  });

  describe('round-trip encryption', () => {
    it('should handle complex objects', () => {
      const complex = {
        access_token: 'token123',
        refresh_token: 'refresh456',
        expires_in: 3600,
        scope: ['read', 'write'],
        metadata: {
          user_id: '12345',
          created_at: new Date().toISOString()
        }
      };
      
      const encrypted = encryptToken(complex);
      const decrypted = decryptToken(encrypted);
      
      assert.deepStrictEqual(decrypted, complex);
    });

    it('should handle empty object', () => {
      const empty = {};
      const encrypted = encryptToken(empty);
      const decrypted = decryptToken(encrypted);
      
      assert.deepStrictEqual(decrypted, empty);
    });

    it('should handle arrays', () => {
      const array = ['token1', 'token2', 'token3'];
      const encrypted = encryptToken(array);
      const decrypted = decryptToken(encrypted);
      
      assert.deepStrictEqual(decrypted, array);
    });
  });
});

