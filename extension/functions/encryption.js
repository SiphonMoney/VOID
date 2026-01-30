// Inco intent utilities
// Produces encrypted handles for sensitive fields before signing

class IntentEncryption {
  constructor() {
    this.teeEndpoint = 'http://localhost:3001/api'; // Default TEE endpoint
  }

  /**
   * Request Inco handles for sensitive fields.
   * NOTE: This proxies to the TEE server in dev. In production, use a
   * browser-compatible Inco SDK to encrypt locally.
   */
  async buildIncoHandles(privacy) {
    try {
      if (!privacy) {
        throw new Error('Missing privacy payload');
      }

      const baseUrl = this.teeEndpoint.replace('/api', '');
      const response = await fetch(`${baseUrl}/api/inco-encrypt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: privacy })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || 'Inco encryption failed');
      }

      const data = await response.json();
      if (!data.success || !data.handles) {
        throw new Error('Invalid Inco handle response');
      }

      return data;
    } catch (error) {
      console.error('[AnonyMaus] ❌ Inco handle creation failed:', error);
      throw error;
    }
  }

  /**
   * Attach Inco handles to the intent and remove plaintext privacy fields.
   */
  async attachIncoHandles(intent) {
    if (!intent) {
      throw new Error('Missing intent');
    }

    const privacy = intent.privacy || {};
    const response = await this.buildIncoHandles(privacy);

    const cleanedIntent = {
      ...intent,
      privacy: undefined,
      inco: {
        mode: 'inco',
        handleFormat: response.handleFormat || 'sha256',
        handles: response.handles
      }
    };

    return cleanedIntent;
  }

  /**
   * Create intent hash for signing
   * @param {Object} intent - The intent object
   * @returns {Promise<string>} Hash of the intent
   */
  async createIntentHash(intent) {
    const intentString = JSON.stringify(intent);
    const intentBytes = new TextEncoder().encode(intentString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', intentBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// IntentEncryption is available globally when loaded via importScripts

