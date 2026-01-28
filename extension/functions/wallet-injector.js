// AnonyMaus Wallet Injector
// Implements Solana wallet adapter patterns
// Makes AnonyMaus appear in wallet selectors

(function() {
  'use strict';

  const WALLET_INFO = {
    solana: {
      name: 'AnonyMaus',
      icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE2IDJMMjggMTBIMjBWMjZIMTJWMTA0SDJMMTYgMloiIGZpbGw9IiNGRjE0OTMiLz4KPC9zdmc+'
    }
  };

  // ============================================================================
  // Solana Provider
  // ============================================================================

  class AnonyMausSolanaProvider {
    constructor() {
      this.isAnonyMaus = true;
      this._publicKey = null;
      this._connected = false;
      this._listeners = {};
      this._requestId = 0;
      this._pendingRequests = new Map();

      // Solana wallet adapter properties (required for wallet adapter detection)
      this.name = WALLET_INFO.solana.name;
      this.icon = WALLET_INFO.solana.icon;
      this.url = 'https://anonymaus.io';
      this.version = '1.0.0';
      
      // Wallet adapter detection flags (Raydium looks for these)
      // Make AnonyMaus detectable alongside Phantom
      this.isAnonyMaus = true; // Our identifier
      this.isPhantom = false; // Not Phantom
      this.isSolflare = false;
      this.isMathWallet = false;
      this.isBraveWallet = false;
      this.isBackpack = false;
      
      // Additional properties for wallet adapter compatibility
      // Use private property for readyState since we have a getter
      this._readyState = 'Installed';
      this._autoApprove = false;
      
      // Wallet adapter metadata
      this._metadata = {
        name: this.name,
        url: this.url,
        icon: this.icon,
        version: this.version
      };
      
      // AnonyMaus appears as a standalone wallet option

      // Listen for responses
      window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        if (e.data.type === 'ANONYMAUS_SOLANA_TO_PAGE') {
          this._handleMessage(e.data.payload);
        }
      });
    }

    _handleMessage(payload) {
      const { requestId, result, error } = payload;
      
      if (requestId && this._pendingRequests.has(requestId)) {
        const { resolve, reject } = this._pendingRequests.get(requestId);
        this._pendingRequests.delete(requestId);
        if (error) reject(new Error(error));
        else resolve(result);
      }
    }

    _sendToExtension(message) {
      window.postMessage({
        type: 'ANONYMAUS_SOLANA_FROM_PAGE',
        payload: message
      }, '*');
    }

    _emit(event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach(callback => {
          try {
            callback(data);
          } catch (error) {
            console.error('[AnonyMaus Solana] Error in event callback:', error);
          }
        });
      }
    }

    // Solana wallet adapter methods
    async connect(options) {
      console.log('%c🔵 [AnonyMaus Solana] connect() called', 'color: #2196F3; font-weight: bold;');
      
      return new Promise((resolve, reject) => {
        const requestId = ++this._requestId;
        this._pendingRequests.set(requestId, { resolve, reject });

        this._sendToExtension({
          requestId,
          method: 'connect',
          options: options
        });

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('AnonyMaus Solana: Connection timeout'));
          }
        }, 30000);
      }).then(result => {
        // Update internal state
        if (result && result.publicKey) {
          // Handle PublicKey object or string
          const pubkeyStr = typeof result.publicKey === 'string' ? result.publicKey : 
                           result.publicKey.toString ? result.publicKey.toString() : null;
          
          if (pubkeyStr) {
            // Create a PublicKey-like object for compatibility
            this._publicKey = {
              toString: () => pubkeyStr,
              toBase58: () => pubkeyStr,
              toBytes: () => {
                // Convert base58 to bytes (simplified - in production use proper base58 decode)
                return new Uint8Array(32); // Placeholder
              }
            };
            this._connected = true;
            this._emit('connect', { publicKey: this._publicKey });
          }
        }
        return result;
      });
    }

    async disconnect() {
      console.log('%c🔵 [AnonyMaus Solana] disconnect() called', 'color: #2196F3; font-weight: bold;');
      this._connected = false;
      this._publicKey = null;
      this._emit('disconnect');
      return Promise.resolve();
    }

    async signTransaction(transaction) {
      console.log('%c💸 [AnonyMaus Solana] signTransaction() called', 'color: #ff1493; font-weight: bold;');
      
      return new Promise((resolve, reject) => {
        const requestId = ++this._requestId;
        this._pendingRequests.set(requestId, { resolve, reject });

        this._sendToExtension({
          requestId,
          method: 'signTransaction',
          params: { transaction }
        });

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('AnonyMaus Solana: Sign timeout'));
          }
        }, 30000);
      });
    }

    async signAllTransactions(transactions) {
      console.log('%c💸 [AnonyMaus Solana] signAllTransactions() called', 'color: #ff1493; font-weight: bold;');
      
      return new Promise((resolve, reject) => {
        const requestId = ++this._requestId;
        this._pendingRequests.set(requestId, { resolve, reject });

        this._sendToExtension({
          requestId,
          method: 'signAllTransactions',
          params: { transactions }
        });

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('AnonyMaus Solana: Sign timeout'));
          }
        }, 30000);
      });
    }

    async signAndSendTransaction(transaction) {
      console.log('%c💸 [AnonyMaus Solana] signAndSendTransaction() called', 'color: #ff1493; font-weight: bold;');
      
      return new Promise((resolve, reject) => {
        const requestId = ++this._requestId;
        this._pendingRequests.set(requestId, { resolve, reject });

        this._sendToExtension({
          requestId,
          method: 'signAndSendTransaction',
          params: { transaction }
        });

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('AnonyMaus Solana: Sign timeout'));
          }
        }, 30000);
      });
    }

    async signMessage(message) {
      console.log('%c✍️ [AnonyMaus Solana] signMessage() called', 'color: #ff1493; font-weight: bold;');
      
      return new Promise((resolve, reject) => {
        const requestId = ++this._requestId;
        this._pendingRequests.set(requestId, { resolve, reject });

        this._sendToExtension({
          requestId,
          method: 'signMessage',
          params: { message }
        });

        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('AnonyMaus Solana: Sign timeout'));
          }
        }, 30000);
      });
    }

    // Properties (required for wallet adapter compatibility)
    get publicKey() { 
      return this._publicKey; 
    }
    get isConnected() { 
      return this._connected; 
    }
    
    // Additional wallet adapter compatibility properties
    get readyState() {
      return this._readyState || (this._connected ? 'Installed' : 'NotDetected');
    }
    
    // Wallet Standard support
    get features() {
      return {
        'standard:connect': {
          connect: () => this.connect()
        },
        'solana:signTransaction': {
          signTransaction: (params) => this.signTransaction(params.transaction)
        },
        'solana:signAndSendTransaction': {
          signAndSendTransaction: (params) => this.signAndSendTransaction(params.transaction)
        },
        'solana:signMessage': {
          signMessage: (params) => this.signMessage(params.message)
        }
      };
    }

    // Event listeners
    on(event, callback) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(callback);
    }

    removeListener(event, callback) {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
      }
    }
  }

  // ============================================================================
  // Wallet Injection & EIP-6963 Announcement
  // ============================================================================

  function injectWallets() {
    // Create Solana provider only
    const solanaProvider = new AnonyMausSolanaProvider();

    // Ethereum injection removed - Solana build only

    // ============================================================================
    // Solana Injection
    // ============================================================================

    // Store original solana if it exists (Phantom, etc.)
    const originalSolana = window.solana;
    const originalPhantomSolana = window.phantom?.solana;

    // DON'T replace window.solana - let Phantom work normally
    // Instead, expose AnonyMaus as a separate wallet option
    // Raydium and wallet adapters detect wallets by checking properties
    
    // Option 1: Expose AnonyMaus via window.anonymaus.solana (separate namespace)
    if (!window.anonymaus) {
      window.anonymaus = {};
    }
    window.anonymaus.solana = solanaProvider;
    console.log('%c✅ [AnonyMaus Solana] Exposed at window.anonymaus.solana', 'color: #4caf50; font-weight: bold;');

    // Option 2: Also expose via Wallet Standard (navigator.wallets)
    // This is the modern way wallets are detected - REQUIRED for Raydium
    // Check if navigator.wallets exists and is an array
    if (!window.navigator.wallets) {
      Object.defineProperty(window.navigator, 'wallets', {
        value: [],
        writable: true,
        configurable: true,
        enumerable: true
      });
    }
    
    // Ensure it's an array (some wallets might set it to a non-array)
    if (!Array.isArray(window.navigator.wallets)) {
      const existingWallets = window.navigator.wallets;
      Object.defineProperty(window.navigator, 'wallets', {
        value: Array.isArray(existingWallets) ? existingWallets : [],
        writable: true,
        configurable: true,
        enumerable: true
      });
    }
    
    // Add AnonyMaus to Wallet Standard registry with proper format
    // Wallet Standard requires: name, icon, url, chains, features, accounts
    const anonymausWallet = {
      name: 'AnonyMaus',
      icon: WALLET_INFO.solana.icon,
      url: 'https://anonymaus.io',
      chains: ['solana:mainnet-beta', 'solana:devnet', 'solana:testnet'], // Required: chains supported
      features: {
        'standard:connect': {
          version: '1.0.0',
          connect: async () => {
            const result = await solanaProvider.connect();
            // Update accounts after connection
            if (result && result.publicKey) {
              const pubkeyStr = typeof result.publicKey === 'string' ? result.publicKey : 
                               result.publicKey.toString ? result.publicKey.toString() : null;
              if (pubkeyStr) {
                anonymausWallet.accounts = [{
                  address: pubkeyStr,
                  publicKey: new Uint8Array(32), // Placeholder - would need proper base58 decode
                  chains: ['solana:mainnet-beta'],
                  features: ['solana:signTransaction', 'solana:signAndSendTransaction', 'solana:signMessage']
                }];
              }
            }
            return anonymausWallet.accounts || [];
          }
        },
        'standard:disconnect': {
          version: '1.0.0',
          disconnect: async () => {
            await solanaProvider.disconnect();
            anonymausWallet.accounts = [];
          }
        },
        'standard:events': {
          version: '1.0.0',
          on: (event, callback) => solanaProvider.on(event, callback),
          removeListener: (event, callback) => solanaProvider.removeListener(event, callback)
        },
        'solana:signTransaction': {
          version: '1.0.0',
          signTransaction: async (params) => {
            return await solanaProvider.signTransaction(params.transaction);
          }
        },
        'solana:signAndSendTransaction': {
          version: '1.0.0',
          signAndSendTransaction: async (params) => {
            return await solanaProvider.signAndSendTransaction(params.transaction);
          }
        },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async (params) => {
            return await solanaProvider.signMessage(params.message);
          }
        }
      },
      accounts: [] // Will be populated after connection
    };
    
    // Check if already added (safely handle array operations)
    try {
      if (Array.isArray(window.navigator.wallets)) {
        const existingIndex = window.navigator.wallets.findIndex(w => w && w.name === 'AnonyMaus');
        if (existingIndex >= 0) {
          window.navigator.wallets[existingIndex] = anonymausWallet;
        } else {
          window.navigator.wallets.push(anonymausWallet);
        }
      } else {
        // If it's not an array, create a new array with AnonyMaus
        Object.defineProperty(window.navigator, 'wallets', {
          value: [anonymausWallet],
          writable: true,
          configurable: true,
          enumerable: true
        });
      }
    } catch (e) {
      console.error('%c❌ [AnonyMaus] Error adding to navigator.wallets:', 'color: #ff1493; font-weight: bold;', e);
      // Fallback: try to create a new array
      try {
        Object.defineProperty(window.navigator, 'wallets', {
          value: [anonymausWallet],
          writable: true,
          configurable: true,
          enumerable: true
        });
      } catch (e2) {
        console.error('%c❌ [AnonyMaus] Failed to set navigator.wallets:', 'color: #ff1493; font-weight: bold;', e2);
      }
    }
    // Verify registration
    const isRegistered = Array.isArray(window.navigator.wallets) && 
                         window.navigator.wallets.some(w => w && w.name === 'AnonyMaus');
    
    if (isRegistered) {
      console.log('%c✅ [AnonyMaus Solana] Successfully registered in Wallet Standard (navigator.wallets)', 'color: #4caf50; font-weight: bold;');
      console.log('%c   Wallet Standard format: chains, features, accounts', 'color: #4caf50;');
      console.log('%c   AnonyMaus will appear as a DIRECT wallet option in Raydium', 'color: #4caf50; font-weight: bold;');
      console.log('%c   Total wallets in navigator.wallets:', 'color: #4caf50;', window.navigator.wallets.length);
      console.log('%c   Wallets:', 'color: #4caf50;', window.navigator.wallets.map(w => w?.name || 'unknown'));
    } else {
      console.error('%c❌ [AnonyMaus Solana] FAILED to register in Wallet Standard!', 'color: #ff1493; font-weight: bold;');
      console.error('   navigator.wallets type:', typeof window.navigator.wallets);
      console.error('   navigator.wallets is array:', Array.isArray(window.navigator.wallets));
      console.error('   navigator.wallets value:', window.navigator.wallets);
    }

    // Option 3: Legacy window.solana detection (for backward compatibility)
    // Some wallet adapters still check window.solana directly
    // We'll set AnonyMaus as window.solana if Phantom isn't there yet,
    // but Wallet Standard (navigator.wallets) is the primary method
    
    // Store original Phantom if it exists
    const originalPhantom = window.solana?.isPhantom ? window.solana : 
                           (window.phantom?.solana || null);
    
    // IMPORTANT: We rely on Wallet Standard (navigator.wallets) for detection
    // window.solana is often read-only (set by Phantom), so we can't override it
    // Instead, AnonyMaus will be detected via Wallet Standard registration
    if (originalPhantom) {
      // Phantom exists - store it for later use
      if (!window.__ANONYMAUS_ORIGINAL_PHANTOM__) {
        window.__ANONYMAUS_ORIGINAL_PHANTOM__ = originalPhantom;
      }
      
      // Try to set AnonyMaus as window.solana, but don't fail if it's read-only
      // Wallet Standard (navigator.wallets) is the primary detection method
      try {
        Object.defineProperty(window, 'solana', {
          value: solanaProvider,
          writable: true,
          configurable: true,
          enumerable: true
        });
        console.log('%c✅ [AnonyMaus Solana] Set as window.solana (DIRECT wallet option)', 'color: #4caf50; font-weight: bold;');
      } catch (e) {
        // window.solana is read-only (set by Phantom) - this is OK
        // AnonyMaus will be detected via Wallet Standard (navigator.wallets)
        console.log('%c⚠️ [AnonyMaus Solana] window.solana is read-only (Phantom set it)', 'color: #ffa500;');
        console.log('%c   AnonyMaus will be detected via Wallet Standard (navigator.wallets)', 'color: #4caf50; font-weight: bold;');
      }
      
      console.log('%c   Phantom available at: window.phantom.solana', 'color: #4caf50;');
      console.log('%c   Both wallets should appear in Raydium selector via Wallet Standard', 'color: #4caf50; font-weight: bold;');
    } else {
      // No Phantom detected - try to set AnonyMaus as window.solana
      try {
        Object.defineProperty(window, 'solana', {
          value: solanaProvider,
          writable: true,
          configurable: true,
          enumerable: true
        });
        console.log('%c✅ [AnonyMaus Solana] Set as window.solana (primary wallet, no Phantom)', 'color: #4caf50; font-weight: bold;');
      } catch (e) {
        // Fallback: direct assignment
        try {
          window.solana = solanaProvider;
          console.log('%c✅ [AnonyMaus Solana] Set as window.solana (fallback method)', 'color: #4caf50; font-weight: bold;');
        } catch (e2) {
          console.log('%c⚠️ [AnonyMaus Solana] Could not set window.solana:', 'color: #ffa500;', e2.message);
          console.log('%c   AnonyMaus will be detected via Wallet Standard (navigator.wallets)', 'color: #4caf50; font-weight: bold;');
        }
      }
      console.log('%c   AnonyMaus will appear as a DIRECT wallet option', 'color: #4caf50; font-weight: bold;');
    }
    
    // Make AnonyMaus provider available for direct access
    // Some dApps might access it directly
    Object.defineProperty(window, 'anonymausSolana', {
      get: () => solanaProvider,
      configurable: true,
      enumerable: true
    });
    
    // Also expose AnonyMaus via additional methods for compatibility
    Object.defineProperty(window, 'anonymausSolana', {
      get: () => solanaProvider,
      configurable: true,
      enumerable: true
    });
    
    // Create a wallet adapter array pattern for multi-wallet detection
    // Some adapters check for window.solana as an array or object with multiple wallets
    if (!window.solanaWallets) {
      window.solanaWallets = [];
    }
    // Add AnonyMaus to the array
    const existingWalletIndex = window.solanaWallets.findIndex(w => w && w.isAnonyMaus);
    if (existingWalletIndex >= 0) {
      window.solanaWallets[existingWalletIndex] = solanaProvider;
    } else {
      window.solanaWallets.push(solanaProvider);
    }
    // Also add Phantom if it exists
    if (originalPhantom && !window.solanaWallets.find(w => w && w.isPhantom)) {
      window.solanaWallets.push(originalPhantom);
    }
    console.log('%c✅ [AnonyMaus Solana] Added to window.solanaWallets array', 'color: #4caf50;');

    // Dispatch Solana wallet ready event (some adapters listen for this)
    window.dispatchEvent(new CustomEvent('solana#initialized'));
    
    // Also dispatch Wallet Standard ready event
    window.dispatchEvent(new CustomEvent('wallet-standard:ready'));
    
    // AnonyMaus is exposed as a browser extension wallet via:
    // 1. window.solana (primary - for direct wallet detection)
    // 2. navigator.wallets (Wallet Standard - for modern adapters)
    // This ensures AnonyMaus appears as a standalone wallet option

    console.log('%c✅ [AnonyMaus] Wallets injected and announced!', 'color: #4caf50; font-weight: bold; font-size: 16px;');
    console.log('%c📝 [AnonyMaus] Solana: window.solana', 'color: #ff1493;');
    console.log('%c📝 [AnonyMaus] Solana: window.anonymaus.solana', 'color: #ff1493;');
    console.log('%c📝 [AnonyMaus] Solana: navigator.wallets (Wallet Standard) - PRIMARY DETECTION METHOD', 'color: #ff1493; font-weight: bold;');
    console.log('%c📝 [AnonyMaus] Solana: window.solanaWallets (array)', 'color: #ff1493;');
    
    // Debug: Show what Raydium will see
    console.log('%c🔍 [AnonyMaus] Wallet detection summary:', 'color: #2196F3; font-weight: bold;');
    console.log('   navigator.wallets:', window.navigator.wallets);
    console.log('   window.solana:', window.solana?.name || window.solana?.isPhantom ? 'Phantom' : (window.solana?.isAnonyMaus ? 'AnonyMaus' : 'Other'));
    console.log('   AnonyMaus in navigator.wallets:', window.navigator.wallets?.find(w => w.name === 'AnonyMaus') ? '✅ YES' : '❌ NO');
    console.log('   window.solana is AnonyMaus:', window.solana?.isAnonyMaus ? '✅ YES' : '❌ NO');
    console.log('%c💡 [AnonyMaus] Detection methods:', 'color: #4caf50; font-weight: bold;');
    console.log('   1. window.solana (DIRECT wallet) - PRIMARY - AnonyMaus appears as standalone option');
    console.log('   2. Wallet Standard (navigator.wallets) - Secondary - For modern adapters');
    console.log('%c✅ [AnonyMaus] Direct wallet detection enabled', 'color: #4caf50; font-weight: bold;');
  }

  // Prevent double injection
  if (window.__ANONYMAUS_INJECTED__) {
    console.log('%c⚠️ [AnonyMaus] Wallet injector already loaded, skipping', 'color: #ffa500;');
    return;
  }
  window.__ANONYMAUS_INJECTED__ = true;

  // Inject immediately - don't wait for DOM
  // This needs to run as early as possible to register before other wallets
  try {
    injectWallets();
  } catch (error) {
    console.error('%c❌ [AnonyMaus] Error injecting wallets:', 'color: #ff1493; font-weight: bold;', error);
    // Retry after a short delay if injection failed
    setTimeout(() => {
      try {
        injectWallets();
      } catch (retryError) {
        console.error('%c❌ [AnonyMaus] Retry injection failed:', 'color: #ff1493; font-weight: bold;', retryError);
      }
    }, 100);
  }
})();

