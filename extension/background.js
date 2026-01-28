// Background service worker
// Handles provider requests and manages extension state

// ============================================================================
// IMPORTS
// ============================================================================
importScripts(
  'functions/solana-intent-builder.js',
  'functions/encryption.js',
  'functions/tee-client.js',
  'functions/console_logs.js'
);

// ============================================================================
// MAIN CLASS: AnonyMausBackground
// ============================================================================
class AnonyMausBackground {
  constructor() {
    // Initialize state
    this.pendingRequests = new Map();
    this.connectedTabs = new Set();
    this.pendingIntentSignatures = new Map();
    this.pendingTransactionSignatures = new Map();
    
    // Module instances
    this.solanaIntentBuilder = null;
    this.encryption = null;
    this.teeClient = null;
    
    // Configuration
    this.teeRpcStrategy = 'default';
    this.customRpcUrl = null;
    
    // Initialize extension
    this.initialize();
  }
  
  // ============================================================================
  // STEP 1: INITIALIZATION
  // ============================================================================
  async initialize() {
    this.log('🚀 [AnonyMaus Background] Service worker initializing...', 'info');
    
    // Step 1.1: Load configuration
    await this.loadConfiguration();
    
    // Step 1.2: Initialize modules
    this.initializeModules();
    
    // Step 1.3: Setup event listeners
    this.setupListeners();
    
    // Step 1.4: Auto-cleanup on startup
    this.autoCleanupMockTransactions();
    
    // Step 1.5: Initialize icon state
    this.initializeIconState();
    
    this.log('✅ [AnonyMaus Background] Service worker initialized', 'info');
  }
  
  async initializeIconState() {
    chrome.storage.local.get(['isConnected'], (result) => {
      const connected = result.isConnected === true;
      this.updateExtensionIcon(connected);
    });
  }
  
  // ============================================================================
  // STEP 2: CONFIGURATION LOADING
  // ============================================================================
  async loadConfiguration() {
    // Step 2.1: Load RPC settings
    await this.loadRpcSettings();
  }
  
  async loadRpcSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['teeRpcStrategy', 'customRpcUrl'], (result) => {
        this.teeRpcStrategy = result.teeRpcStrategy || 'default';
        this.customRpcUrl = result.customRpcUrl || null;
        this.log(`📡 [AnonyMaus] RPC Strategy: ${this.teeRpcStrategy}`, 'info');
        resolve();
      });
    });
  }
  
  
  // ============================================================================
  // STEP 3: MODULE INITIALIZATION
  // ============================================================================
  initializeModules() {
    try {
      // Step 3.1: Validate required modules are loaded
      this.validateModules();
      
      // Step 3.2: Initialize module instances
      this.solanaIntentBuilder = new SolanaIntentBuilder();
      this.teeClient = new TEEClient();
      this.encryption = new IntentEncryption();
      this.encryption.teeEndpoint = this.teeClient.endpoint;
      
      this.log('✅ [AnonyMaus] Modules initialized (Solana build)', 'info');
    } catch (error) {
      this.log(`❌ [AnonyMaus] Module initialization error: ${error.message}`, 'error');
      throw error;
    }
  }
  
  validateModules() {
    if (typeof SolanaIntentBuilder === 'undefined') {
      throw new Error('SolanaIntentBuilder not loaded');
    }
    if (typeof IntentEncryption === 'undefined') {
      throw new Error('IntentEncryption not loaded');
    }
    if (typeof TEEClient === 'undefined') {
      throw new Error('TEEClient not loaded');
    }
  }
  
  // ============================================================================
  // STEP 4: EVENT LISTENERS SETUP
  // ============================================================================
  setupListeners() {
    this.log('👂 [AnonyMaus Background] Setting up listeners', 'info');
    
    // Step 4.1: Setup message listener
    this.setupMessageListener();
    
    // Step 4.2: Setup tab cleanup listener
    this.setupTabCleanupListener();
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.log(`📨 [AnonyMaus Background] Message received: ${message.method || message.type || 'unknown'}`, 'info');
      
      // Handle different message types
      const handled =
        this.handleSignatureResult(message, sendResponse) ||
        this.handleIntentMessages(message, sendResponse) ||
        this.handleConfigurationMessages(message, sendResponse) ||
        this.handleSolanaProviderRequest(message, sender, sendResponse);
      
      // Unknown message type
      if (!handled) {
        sendResponse({ error: 'Unsupported request type for Solana build' });
      }
      return false;
    });
  }
  
  setupTabCleanupListener() {
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.connectedTabs.delete(tabId);
    });
  }
  
  // ============================================================================
  // STEP 5: MESSAGE HANDLERS
  // ============================================================================
  handleSignatureResult(message, sendResponse) {
    if (message.type === 'SOLANA_TRANSACTION_SIGNATURE_RESULT') {
      const { requestId, signedTransaction, signature, error, publicKey } = message;
      this.log(`📨 [AnonyMaus Solana] Received transaction signature result for requestId: ${requestId}`, 'info');
      if (this.pendingTransactionSignatures.has(requestId)) {
        const { resolve, reject } = this.pendingTransactionSignatures.get(requestId);
        this.pendingTransactionSignatures.delete(requestId);
        if (error) {
          this.log(`❌ [AnonyMaus Solana] Phantom transaction signing failed: ${error}`, 'error');
          reject(new Error(error));
        } else {
          resolve({
            signedTransaction,
            signature,
            signer: publicKey || 'unknown'
          });
        }
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'SOLANA_SIGNATURE_RESULT' || message.type === 'ANONYMAUS_SOLANA_SIGN_RESULT') {
      const { requestId, signedTransaction, signature, error, publicKey, intent } = message;
      
      this.log(`📨 [AnonyMaus Solana] Received signature result for requestId: ${requestId}`, 'info');
      
      if (this.pendingIntentSignatures.has(requestId)) {
        const { resolve, reject } = this.pendingIntentSignatures.get(requestId);
        this.pendingIntentSignatures.delete(requestId);
        
        if (error) {
          this.log(`❌ [AnonyMaus Solana] Phantom signing failed: ${error}`, 'error');
          reject(new Error(error));
        } else {
          this.log(`✅ [AnonyMaus Solana] Intent signed by ${publicKey || 'user'}`, 'info');

          (async () => {
            try {
              const intentHash = await this.createSolanaIntentHash(intent);
              resolve({ 
                ...intent, 
                signature: signature || signedTransaction?.signature,
                signedTransaction,
                intentHash,
                signer: publicKey || 'unknown'
              });
            } catch (hashError) {
              reject(hashError);
            }
          })();
        }
      }
      sendResponse({ success: true });
      return true;
    }
    return false;
  }
  
  handleIntentMessages(message, sendResponse) {
    if (message.type === 'INTENT_SIGNED') {
      this.handleIntentSigned(message);
      sendResponse({ success: true });
      return true;
    }
    
    if (message.type === 'INTENT_REJECTED') {
      this.handleIntentRejected(message);
      sendResponse({ success: true });
      return true;
    }
    
    return false;
  }
  
  handleConfigurationMessages(message, sendResponse) {
    if (message.type === 'CLEAR_PENDING_TRANSACTIONS') {
      this.clearPendingTransactions().then(count => {
        sendResponse({ success: true, cleared: count });
      });
      return true;
    }
    
    if (message.type === 'UPDATE_TEE_RPC_STRATEGY') {
      this.teeRpcStrategy = message.strategy || 'default';
      this.customRpcUrl = message.customRpc || null;
      this.log(`📡 [AnonyMaus] RPC Strategy updated to: ${this.teeRpcStrategy}`, 'info');
      sendResponse({ success: true });
      return true;
    }
    
    if (message.type === 'UPDATE_ICON') {
      this.updateExtensionIcon(message.connected);
      sendResponse({ success: true });
      return true;
    }
    
    
    return false;
  }
  
  updateExtensionIcon(connected) {
    chrome.action.setIcon({
      path: connected ? {
        16: 'assets/void_icon_active_16.png',
        48: 'assets/void_icon_active_48.png',
        128: 'assets/void_icon_active_128.png'
      } : {
        16: 'assets/void_icon_16.png',
        48: 'assets/void_icon_48.png',
        128: 'assets/void_icon_128.png'
      }
    }).catch((err) => {
      this.log(`Icon update error: ${err}`, 'warning');
    });
  }
  
  handleIntentSigned(message) {
    const { intent, signature, intentHash, signer } = message;
    const requestId = intent.requestId;
    
    this.log(`✅ [AnonyMaus] Intent signed by ${signer || 'user'}: ${intentHash}`, 'info');
    
    if (this.pendingIntentSignatures.has(requestId)) {
      const { resolve } = this.pendingIntentSignatures.get(requestId);
      this.pendingIntentSignatures.delete(requestId);
      resolve({ 
        ...intent, 
        signature, 
        intentHash,
        signer: signer || 'unknown'
      });
    }
  }
  
  handleIntentRejected(message) {
    const { intent } = message;
    const requestId = intent.requestId;
    
    this.log(`❌ [AnonyMaus] Intent rejected by user`, 'info');
    
    if (this.pendingIntentSignatures.has(requestId)) {
      const { reject } = this.pendingIntentSignatures.get(requestId);
      this.pendingIntentSignatures.delete(requestId);
      reject(new Error('User rejected intent signature'));
    }
  }
  
  // ============================================================================
  // STEP 6: SOLANA PROVIDER REQUEST HANDLING
  // ============================================================================
  async handleSolanaProviderRequest(message, sender, sendResponse) {
    const { requestId, method, params, transaction, transactions, userRealPublicKey } = message;
    
    // Validate request first (synchronously)
    if (!this.isSolanaRequest(method)) {
      return false;
    }
    
    // Respond immediately to keep the message channel alive
    // Final result is delivered via ANONYMAUS_SOLANA_TO_PAGE
    let responseAllowed = true;
    if (sendResponse) {
      try {
        // Do not include requestId to avoid forwarding ack to page
        sendResponse({ ack: true });
      } catch (e) {
        // Ignore channel errors; fall back to page messaging
      }
      responseAllowed = false;
    }

    // Wrap async work; send final response via page message
    (async () => {
      const safeSendResponse = (response) => {
        if (responseAllowed && sendResponse) {
          try {
            sendResponse(response);
            return;
          } catch (e) {
            // Channel may have closed, fall through to page message
          }
        }
        this.sendToPage(sender.tab.id, response, 'ANONYMAUS_SOLANA_TO_PAGE');
      };
      
      // Initialize expectedOrigin outside try block to ensure it's always defined
      let expectedOrigin = null;
      try {
        // Get tab info for logging
        let tabInfo = { url: 'unknown', title: 'unknown' };
        try {
          const tab = await chrome.tabs.get(sender.tab.id);
          tabInfo = { url: tab.url, title: tab.title };
        } catch (e) {}
        try {
          if (tabInfo.url) {
            expectedOrigin = new URL(tabInfo.url).origin;
          }
        } catch (e) {}
        
        this.log(`🔵 [AnonyMaus Solana] Provider Request: ${method} from ${tabInfo.url}`, 'info');
        
        let result;
        switch (method) {
          case 'connect':
            result = await this.handleSolanaConnect(userRealPublicKey, sender.tab.id);
            break;
          
          case 'signTransaction':
            this.log(`💸 [AnonyMaus Solana] signTransaction() CAUGHT!`, 'transaction');
            if (!transaction) throw new Error('Transaction data is missing');
            this.attachSwapParamsFromUrl(transaction, tabInfo.url);
            result = await this.handleSolanaSignTransaction(transaction, sender.tab.id);
            break;
          
          case 'signAndSendTransaction':
            this.log(`💸 [AnonyMaus Solana] signAndSendTransaction() CAUGHT!`, 'transaction');
            if (!transaction) throw new Error('Transaction data is missing');
            this.attachSwapParamsFromUrl(transaction, tabInfo.url);
            result = await this.handleSolanaSignAndSendTransaction(transaction, sender.tab.id);
            break;
          
          case 'signAllTransactions':
            this.log(`💸 [AnonyMaus Solana] signAllTransactions() CAUGHT!`, 'transaction');
            if (!transactions) throw new Error('Transactions data is missing');
            transactions.forEach(tx => this.attachSwapParamsFromUrl(tx, tabInfo.url));
            result = await this.handleSolanaSignAllTransactions(transactions, sender.tab.id);
            break;
          
          default:
            throw new Error(`Unknown Solana method: ${method}`);
        }
        
        // Send success response
        safeSendResponse({ requestId, result, expectedOrigin });
      } catch (error) {
        this.log(`❌ [AnonyMaus Solana] Error: ${error.message} (${method})`, 'error');
        safeSendResponse({ requestId, error: error.message || 'Unknown error', expectedOrigin: expectedOrigin || null });
      }
    })();
    
    return true; // Keep channel open for async response
  }

  attachSwapParamsFromUrl(transactionData, url) {
    try {
      if (!transactionData || !url) return;
      const parsedUrl = new URL(url);
      const inputMint = parsedUrl.searchParams.get('inputMint');
      const outputMint = parsedUrl.searchParams.get('outputMint');
      const poolId = parsedUrl.searchParams.get('poolId'); // Extract poolId if present in URL
      
      if (inputMint || outputMint || poolId) {
        transactionData.swapParams = transactionData.swapParams || {};
        if (inputMint) transactionData.swapParams.inputMint = inputMint;
        if (outputMint) transactionData.swapParams.outputMint = outputMint;
        if (poolId) {
          transactionData.swapParams.poolId = poolId;
          this.log(`✅ [AnonyMaus Solana] Found poolId in URL: ${poolId}`, 'info');
        }
      }
      if (!transactionData.swapParams?.amountInLamports && transactionData.extractedAmountLamports) {
        transactionData.swapParams = transactionData.swapParams || {};
        transactionData.swapParams.amountInLamports = transactionData.extractedAmountLamports;
      }
    } catch (e) {
      this.log(`⚠️ [AnonyMaus Solana] Failed to parse swap params from URL: ${e.message}`, 'warn');
    }
  }
  
  isSolanaRequest(method) {
    return method === 'connect' || 
           method === 'signTransaction' || 
           method === 'signAndSendTransaction' ||
           method === 'signAllTransactions';
  }
  
  // ============================================================================
  // STEP 7: SOLANA CONNECTION HANDLING
  // ============================================================================
  async handleSolanaConnect(userRealPublicKey, tabId) {
    const executorPublicKey = await this.getExecutorPublicKey();
    
    // Store user's real public key internally (never expose to dApp)
    if (userRealPublicKey) {
      await chrome.storage.local.set({ 
        solanaUserRealPublicKey: userRealPublicKey 
      });
      this.log(`👤 [AnonyMaus Solana] User's real public key stored (internal): ${userRealPublicKey}`, 'info');
    }
    
    this.log(`🔑 [AnonyMaus Solana] Returning executor public key to dApp: ${executorPublicKey}`, 'info');
    
    return {
      publicKey: {
        toString: () => executorPublicKey,
        toBase58: () => executorPublicKey
      }
    };
  }
  
  // ============================================================================
  // STEP 8: SOLANA TRANSACTION HANDLING (MAIN FLOW)
  // ============================================================================
  async handleSolanaSignTransaction(transactionData, tabId) {
    // Prevent duplicate handling
    const transactionKey = transactionData.serialized || JSON.stringify(transactionData.instructions || []);
    const handlingKey = `solana_tx_${tabId}_${transactionKey.substring(0, 50)}`;
    
    if (this.pendingTransactions?.has(handlingKey)) {
      this.log(`⚠️ [AnonyMaus Solana] Transaction already being handled, skipping duplicate`, 'warn');
      throw new Error('Transaction is already being processed');
    }
    
    if (!this.pendingTransactions) {
      this.pendingTransactions = new Set();
    }
    this.pendingTransactions.add(handlingKey);
    
    try {
      const result = await this.handleSolanaTransaction(transactionData, 'signTransaction', tabId);
      this.pendingTransactions.delete(handlingKey);
      return result;
    } catch (error) {
      this.pendingTransactions.delete(handlingKey);
      throw error;
    }
  }
  
  async handleSolanaSignAndSendTransaction(transactionData, tabId) {
    // Prevent duplicate handling
    const transactionKey = transactionData.serialized || JSON.stringify(transactionData.instructions || []);
    const handlingKey = `solana_tx_${tabId}_${transactionKey.substring(0, 50)}`;
    
    if (this.pendingTransactions?.has(handlingKey)) {
      this.log(`⚠️ [AnonyMaus Solana] Transaction already being handled, skipping duplicate`, 'warn');
      throw new Error('Transaction is already being processed');
    }
    
    if (!this.pendingTransactions) {
      this.pendingTransactions = new Set();
    }
    this.pendingTransactions.add(handlingKey);
    
    try {
      const result = await this.handleSolanaTransaction(transactionData, 'signAndSendTransaction', tabId);
      this.pendingTransactions.delete(handlingKey);
      return result;
    } catch (error) {
      this.pendingTransactions.delete(handlingKey);
      throw error;
    }
  }
  
  async handleSolanaSignAllTransactions(transactionsData, tabId) {
    const results = [];
    for (const transactionData of transactionsData) {
      const result = await this.handleSolanaTransaction(transactionData, 'signTransaction', tabId);
      results.push(result);
    }
    return results;
  }
  
  async handleSolanaTransaction(transactionData, method, tabId) {
    this.log(`🎯 [AnonyMaus Solana] ===== TRANSACTION RECEIVED =====`, 'info');
    this.logTransactionDetails(transactionData);
    
    try {
      // STEP 8.1: Extract required SOL amount from transaction
      const requiredLamports = await this.step1_ExtractRequiredAmount(transactionData);
      
      // STEP 8.2: Get executor public key and validate deployment
      const { executorPublicKey } = await this.step2_ValidateExecutor();
      
      // STEP 8.3: Request vault transfer (if needed)
      const vaultTransferSignature = await this.step3_RequestVaultTransfer(
        executorPublicKey, 
        requiredLamports, 
        tabId
      );
      
      // STEP 8.4: Wait for vault transfer confirmation
      await this.step4_WaitForVaultTransfer(vaultTransferSignature);
      
      // STEP 8.5: Build intent from transaction
      const intent = await this.step5_BuildIntent(transactionData, method);
      
      // STEP 8.6: Request user signature for intent
      const signedIntent = await this.step6_RequestUserSignature(intent, tabId);
      
      // STEP 8.7: Submit transaction via TEE
      const result = await this.step7_SubmitTransaction(
        transactionData, 
        signedIntent, 
        method, 
        executorPublicKey, 
        tabId
      );
      
      this.log(`🎉 [AnonyMaus Solana] Transaction flow complete!`, 'info');
      return result;
      
    } catch (error) {
      this.log(`❌ [AnonyMaus Solana] Transaction handling error: ${error.message}`, 'error');
      throw error;
    }
  }
  
  // ============================================================================
  // STEP 8.1: EXTRACT REQUIRED AMOUNT
  // ============================================================================
  async step1_ExtractRequiredAmount(transactionData) {
    this.log(`💰 [AnonyMaus Solana] Step 1: Analyzing transaction...`, 'info');
    
    this.log(`   🔍 [DEBUG] BEFORE extractRequiredLamports - transactionData.extractedAmountLamports: ${transactionData.extractedAmountLamports} (type: ${typeof transactionData.extractedAmountLamports})`, 'info');
    
    const requiredLamports = this.extractRequiredLamports(transactionData);
    
    // CRITICAL: Ensure extractedAmountLamports is set on transactionData for later use
    if (requiredLamports > 0) {
      transactionData.extractedAmountLamports = requiredLamports;
      this.log(`   ✅ [DEBUG] Set transactionData.extractedAmountLamports to: ${requiredLamports}`, 'info');
    }
    
    this.log(`   📋 Transaction from dApp:`, 'info');
    this.log(`      Instructions: ${transactionData.instructions?.length || 0}`, 'info');
    this.log(`      Serialized size: ${transactionData.serialized?.length || 0} bytes`, 'info');
    
    if (transactionData.extractedAmounts && transactionData.extractedAmounts.length > 0) {
      this.log(`   💰 Extracted amounts:`, 'info');
      transactionData.extractedAmounts.forEach((amt, idx) => {
        this.log(`      ${idx + 1}. Instruction ${amt.instruction} (${amt.type}): ${amt.sol} SOL`, 'info');
      });
    }
    
    this.log(`   💰 Total required: ${requiredLamports} lamports (${(requiredLamports / 1e9).toFixed(6)} SOL)`, 'info');
    this.log(`   🔍 [DEBUG] AFTER extractRequiredLamports - transactionData.extractedAmountLamports: ${transactionData.extractedAmountLamports} (type: ${typeof transactionData.extractedAmountLamports})`, 'info');
    
    if (requiredLamports === 0) {
      this.log(`   ⚠️  No SOL amount extracted - will use minimum deposit for fees`, 'warn');
    }
    
    return requiredLamports;
  }
  
  // ============================================================================
  // STEP 8.2: VALIDATE EXECUTOR
  // ============================================================================
  async step2_ValidateExecutor() {
    const executorPublicKey = await this.getExecutorPublicKey();
    
    if (!executorPublicKey || executorPublicKey === '11111111111111111111111111111111') {
      throw new Error('Executor program not deployed. Please deploy the program first. Run: npm run deploy-solana-program in the server directory and set SOLANA_EXECUTOR_PROGRAM_ID in .env');
    }
    
    this.log(`✅ [AnonyMaus Solana] Executor validated: ${executorPublicKey}`, 'info');
    return { executorPublicKey };
  }
  
  // ============================================================================
  // STEP 8.3: REQUEST VAULT TRANSFER
  // ============================================================================
  async step3_RequestVaultTransfer(executorPublicKey, requiredLamports, tabId) {
    
    // Calculate transfer amount
    const transferAmountLamports = this.calculateTransferAmount(requiredLamports);
    
    if (transferAmountLamports === 0) {
      this.log(`💰 [AnonyMaus Solana] Step 3: No SOL transfer needed`, 'info');
      return null;
    }
    
    this.log(`💰 [AnonyMaus Solana] Step 3: Building deposit transaction...`, 'info');
    this.logDepositDetails(requiredLamports, transferAmountLamports, executorPublicKey);
    
    try {
      const rpcUrl = 'https://solana-devnet.g.alchemy.com/v2/Sot3NTHhsx_C1Eunyg9ni';
      const vaultTransferSignature = await this.requestSolanaVaultTransfer(
        executorPublicKey, 
        transferAmountLamports, 
        tabId, 
        rpcUrl
      );
      
      this.log(`✅ [AnonyMaus Solana] Vault transfer submitted: ${vaultTransferSignature}`, 'success');
      return vaultTransferSignature;
    } catch (error) {
      const friendlyMessage = `${error.message} (flow: intercept → build deposit → user approves → intent signed → executor executes)`;
      this.log(`❌ [AnonyMaus Solana] Vault transfer failed: ${friendlyMessage}`, 'error');
      throw new Error(friendlyMessage);
    }
  }
  
  // ============================================================================
  // STEP 8.4: WAIT FOR VAULT TRANSFER
  // ============================================================================
  async step4_WaitForVaultTransfer(vaultTransferSignature) {
    if (!vaultTransferSignature) {
      return;
    }
    
    this.log(`⏳ [AnonyMaus Solana] Step 4: Waiting for vault transfer confirmation...`, 'info');
    await this.waitForSolanaTransactionConfirmation(vaultTransferSignature, 5000);
    this.log(`✅ [AnonyMaus Solana] Vault transfer confirmed - funds are now in vault`, 'success');
  }
  
  // ============================================================================
  // STEP 8.5: BUILD INTENT
  // ============================================================================
  async step5_BuildIntent(transactionData, method) {
    this.log(`📝 [AnonyMaus Solana] Step 5: Building intent from transaction...`, 'info');
    
    // Handle missing instructions
    if ((!transactionData.instructions || transactionData.instructions.length === 0) && transactionData.serialized) {
      this.log(`⚠️ [AnonyMaus Solana] Instructions missing, but we have serialized transaction`, 'info');
      transactionData.instructions = [];
    }
    
    const intent = await this.buildSolanaIntent(transactionData, method);
    
    this.log(`✅ [AnonyMaus Solana] Intent built:`, 'success');
    this.logIntentDetails(intent);
    
    // Validate intent
    if (this.solanaIntentBuilder && this.solanaIntentBuilder.validateIntent) {
      const validation = this.solanaIntentBuilder.validateIntent(intent);
      if (!validation.valid) {
        throw new Error(`Invalid intent: ${validation.errors.join(', ')}`);
      }
      this.log(`✅ [AnonyMaus Solana] Intent validation passed`, 'success');
    }
    
    return intent;
  }
  
  // ============================================================================
  // STEP 8.6: REQUEST USER SIGNATURE
  // ============================================================================
  async step6_RequestUserSignature(intent, tabId) {
    this.log(`👤 [AnonyMaus Solana] Step 6: Requesting user signature for intent...`, 'info');
    this.log(`   💡 This signature authorizes transaction execution`, 'info');
    
    const signedIntent = await this.requestSolanaUserSignature(intent, tabId);
    
    this.log(`✅ [AnonyMaus Solana] Intent signed by user (${signedIntent.signer})`, 'success');
    this.log(`📝 [AnonyMaus Solana] Signature: ${signedIntent.signature?.substring(0, 20) || 'pending'}...`, 'info');
    
    return signedIntent;
  }
  
  // ============================================================================
  // STEP 8.7: SUBMIT TRANSACTION
  // ============================================================================
  async step7_SubmitTransaction(transactionData, signedIntent, method, executorPublicKey, tabId) {
    // Step 7.1: Get TEE approval
    this.log(`🔐 [AnonyMaus Solana] Step 7.1: Sending to TEE for approval...`, 'info');
    const teeApproval = await this.requestTEEApproval(signedIntent);
    this.log(`✅ [AnonyMaus Solana] TEE Approval received`, 'info');
    
    // Step 7.2: Submit transaction via TEE
    this.log(`🚀 [AnonyMaus Solana] Step 7.2: Submitting transaction to TEE...`, 'info');
    
    try {
      const result = await this.submitSolanaTransaction(transactionData, signedIntent, method);
      this.log(`✅ [AnonyMaus Solana] Transaction Submitted`, 'info');
      this.log(`📝 [AnonyMaus Solana] Signature: ${result.signature || 'pending'}`, 'info');
      if (result.explorerUrl) {
        this.log(`🔗 [AnonyMaus Solana] Explorer: ${result.explorerUrl}`, 'info');
      }
      
      // Return result with signature - Raydium will use the signature
      // The transaction is already executed on server, so we just return the signature
      return {
        signature: result.signature,
        // Include original transaction data for compatibility
        ...transactionData
      };
    } catch (error) {
      if (error.needsUserSignature) {
        this.log(`⚠️ [AnonyMaus Solana] Executor cannot sign; requesting user transaction signature`, 'warn');
        const signedTx = await this.requestSolanaUserTransactionSignature(transactionData, tabId);
        return signedTx;
      }
      if (error.needsPrivacyDeposit) {
        return await this.step7_HandlePrivacyDepositError(error, transactionData, signedIntent, method, executorPublicKey, tabId);
      }
      // Handle deposit requirement error
      if (error.needsDeposit || (error.message && error.message.includes('deposit'))) {
        return await this.step7_HandleDepositError(error, transactionData, signedIntent, method, executorPublicKey, tabId);
      }
      throw error;
    }
  }
  
  
  async step7_HandleDepositError(error, transactionData, signedIntent, method, executorPublicKey, tabId) {
    this.log(`💰 [AnonyMaus Solana] Deposit required before execution`, 'info');
    
    const depositExecutorPublicKey = error.executorProgramId || executorPublicKey || 'GG6FnZiz7qo4pfHWNHn8feTTgaqPcB4Zb29jH6zsH3Lv';
    const rpcUrl = 'https://solana-devnet.g.alchemy.com/v2/Sot3NTHhsx_C1Eunyg9ni';
    
    const txValueLamports = Math.floor(parseFloat(transactionData.value || '0') * 1e9);
    const depositAmount = Math.floor(Math.max(txValueLamports, 0.01 * 1e9) * 1.1);
    
    this.log(`💰 [AnonyMaus Solana] Requesting deposit: ${(depositAmount / 1e9).toFixed(6)} SOL`, 'info');
    const depositSignature = await this.requestSolanaVaultTransfer(depositExecutorPublicKey, depositAmount, tabId, rpcUrl);
    this.log(`✅ [AnonyMaus Solana] Deposit submitted: ${depositSignature}`, 'success');
    
    await this.waitForSolanaTransactionConfirmation(depositSignature);
    this.log(`✅ [AnonyMaus Solana] Deposit confirmed, retrying execution...`, 'success');
    
    const result = await this.submitSolanaTransaction(transactionData, signedIntent, method);
    return result;
  }

  async step7_HandlePrivacyDepositError(error, transactionData, signedIntent, method, executorPublicKey, tabId) {
    this.log(`🔒 [AnonyMaus Solana] PrivacyCash deposit required before execution`, 'info');
    const privacyProgramId = error.privacyProgramId;
    const authorityPubkey = error.authorityPubkey;
    const amountLamports = parseInt(error.amountLamports || '0', 10);
    const rpcUrl = 'https://solana-devnet.g.alchemy.com/v2/Sot3NTHhsx_C1Eunyg9ni';

    if (!privacyProgramId || !authorityPubkey || !amountLamports) {
      throw new Error('Missing privacy deposit params from server');
    }

    this.log(`🔒 [AnonyMaus Solana] Requesting PrivacyCash deposit`, 'info');
    const depositSignature = await this.requestSolanaPrivacycashDeposit(
      privacyProgramId,
      authorityPubkey,
      amountLamports,
      tabId,
      rpcUrl
    );
    this.log(`✅ [AnonyMaus Solana] PrivacyCash deposit submitted: ${depositSignature}`, 'success');

    await this.waitForSolanaTransactionConfirmation(depositSignature);
    this.log(`✅ [AnonyMaus Solana] PrivacyCash deposit confirmed, retrying execution...`, 'success');

    const result = await this.submitSolanaTransaction(transactionData, signedIntent, method);
    return result;
  }
  
  // ============================================================================
  // HELPER METHODS: TRANSACTION PROCESSING
  // ============================================================================
  extractRequiredLamports(transactionData) {
    // Use pre-extracted amount if available
    if (transactionData.extractedAmountLamports && transactionData.extractedAmountLamports > 0) {
      this.log(`💰 [AnonyMaus Solana] Using pre-extracted amount: ${transactionData.extractedAmountLamports} lamports`, 'info');
      // Ensure it's a number (not BigInt) for compatibility
      const amount = typeof transactionData.extractedAmountLamports === 'bigint' 
        ? Number(transactionData.extractedAmountLamports > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : transactionData.extractedAmountLamports)
        : transactionData.extractedAmountLamports;
      return amount;
    }
    
    // Fallback: Parse instructions
    const instructions = transactionData.instructions || [];
    let totalLamports = 0n; // Use BigInt to handle large u64 values
    const seenRaydiumAmounts = new Set();
    
    // Helper function to parse u64 from buffer using BigInt (prevents Number overflow)
    const parseU64BigInt = (buffer) => {
      let value = 0n;
      for (let i = 0; i < buffer.length && i < 8; i++) {
        value += BigInt(buffer[i]) * (256n ** BigInt(i));
      }
      return value;
    };
    
    for (const instruction of instructions) {
      // System Program transfer
      if (instruction.programId === '11111111111111111111111111111111' || 
          instruction.programId?.toString() === '11111111111111111111111111111111') {
        if (instruction.data && instruction.data.length >= 9 && instruction.data[0] === 2) {
          const lamportsBuffer = instruction.data.slice(1, 9);
          const lamports = parseU64BigInt(lamportsBuffer);
          totalLamports += lamports;
        }
      }
      
      // Raydium swap instructions
      const raydiumProgramIds = [
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
        'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
        'RVKd61ztZW9GUwhRbbLoYVRE5Xf9B2t3sc6qwfqE3zH',
        'CPMMoo8L3F4NbTegBCKVNunggL1tnt2ec5zM1YkqFhL2',
      ];
      
      const programId = instruction.programId?.toString() || instruction.programId || '';
      const isRaydiumSwap = raydiumProgramIds.some(id => programId.includes(id) || id.includes(programId));
      
      if (isRaydiumSwap && instruction.data && instruction.data.length >= 9) {
        try {
          const amountBuffer = instruction.data.slice(1, 9);
          const amount = parseU64BigInt(amountBuffer);
          
          // Check if amount is reasonable (between 1000 and 1e15 lamports)
          if (amount > 1000n && amount < BigInt(1e15)) {
            const dedupeKey = `${programId}:${amount.toString()}`;
            if (!seenRaydiumAmounts.has(dedupeKey)) {
              seenRaydiumAmounts.add(dedupeKey);
              totalLamports += amount;
            }
          }
        } catch (e) {
          // Ignore extraction errors
        }
      }
    }
    
    // Convert BigInt to Number, capping at MAX_SAFE_INTEGER to prevent overflow
    const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
    let finalAmount;
    if (totalLamports > MAX_SAFE) {
      this.log(`⚠️ [AnonyMaus Solana] Total lamports ${totalLamports.toString()} exceeds safe integer limit. Capping to ${Number.MAX_SAFE_INTEGER}`, 'warn');
      finalAmount = Number.MAX_SAFE_INTEGER;
    } else {
      finalAmount = Number(totalLamports);
    }
    
    // CRITICAL: Update transactionData.extractedAmountLamports so it's available later
    transactionData.extractedAmountLamports = finalAmount;
    this.log(`🔍 [DEBUG] extractRequiredLamports set transactionData.extractedAmountLamports to: ${finalAmount}`, 'info');
    
    return finalAmount;
  }
  
  calculateTransferAmount(requiredLamports) {
    const baseFeeLamports = 5000;
    const estimatedSignatures = 1;
    const estimatedFees = baseFeeLamports * estimatedSignatures;
    
    const baseAmount = requiredLamports > 0 ? requiredLamports : 0;
    const totalRequired = baseAmount + estimatedFees;
    const transferAmountLamports = Math.max(
      Math.floor(totalRequired * 1.1),
      requiredLamports > 0 ? Math.floor(requiredLamports * 1.1) : 10000000
    );
    
    return transferAmountLamports;
  }
  
  async buildSolanaIntent(transactionData, method) {
    if (!this.solanaIntentBuilder) {
      throw new Error('SolanaIntentBuilder not initialized');
    }
    
    const transactionType = this.determineSolanaTransactionType(transactionData);
    return this.solanaIntentBuilder.buildIntent(transactionData, transactionType);
  }
  
  determineSolanaTransactionType(transactionData) {
    const instructions = transactionData.instructions || [];
    
    for (const instruction of instructions) {
      const programId = instruction.programId?.toLowerCase() || '';
      
      if (programId.includes('jupiter') || programId.includes('orca') || programId.includes('swap')) {
        return 'SWAP/TRANSFER';
      }
      
      if (programId.includes('token') && instruction.data && instruction.data[0] === 4) {
        return 'APPROVAL';
      }
    }
    
    return 'SWAP/TRANSFER';
  }
  
  // ============================================================================
  // HELPER METHODS: VAULT TRANSFER
  // ============================================================================
  async requestSolanaVaultTransfer(executorProgramId, lamports, tabId, rpcUrl) {
    this.log(`💰 [AnonyMaus Solana] Requesting user to deposit SOL to executor program...`, 'info');
    this.log(`   Executor Program: ${executorProgramId}`, 'info');
    this.log(`   Amount: ${lamports} lamports (${(lamports / 1e9).toFixed(6)} SOL)`, 'info');
    
    return new Promise(async (resolve, reject) => {
      const requestId = `solana_vault_transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Listen for transfer result
      const transferHandler = async (message, sender, sendResponse) => {
        if (message.type === 'ANONYMAUS_SOLANA_VAULT_TRANSFER_RESULT' && message.requestId === requestId) {
          chrome.runtime.onMessage.removeListener(transferHandler);
          
          if (message.error) {
            const friendlyMessage = `${message.error} (flow: intercept → build deposit → user approves → intent signed → executor executes)`;
            this.log(`❌ [AnonyMaus Solana] Vault transfer error: ${friendlyMessage}`, 'error');
            reject(new Error(friendlyMessage));
          } else if (message.signature) {
            this.log(`✅ [AnonyMaus Solana] Vault transfer signature received: ${message.signature}`, 'success');
            resolve(message.signature);
          } else {
            const errorMsg = 'Vault transfer result missing signature';
            this.log(`❌ [AnonyMaus Solana] ${errorMsg}`, 'error');
            this.log(`   Message received: ${JSON.stringify(message)}`, 'error');
            reject(new Error(errorMsg));
          }
          return true;
        }
      };
      
      chrome.runtime.onMessage.addListener(transferHandler);
      
      try {
        let expectedOrigin = null;
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.url) {
            expectedOrigin = new URL(tab.url).origin;
          }
        } catch (e) {}

        await chrome.tabs.sendMessage(tabId, {
          type: 'ANONYMAUS_SOLANA_VAULT_TRANSFER_REQUEST',
          executorProgramId: executorProgramId,
          lamports: lamports,
          rpcUrl: rpcUrl,
          requestId: requestId,
          expectedOrigin: expectedOrigin
        });
        
        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(transferHandler);
          reject(new Error('Vault transfer request timeout'));
        }, 300000);
        
      } catch (error) {
        chrome.runtime.onMessage.removeListener(transferHandler);
        this.log(`❌ [AnonyMaus Solana] Error requesting vault transfer: ${error.message}`, 'error');
        reject(new Error('Failed to request vault transfer. Please reload and try again.'));
      }
    });
  }

  async requestSolanaPrivacycashDeposit(privacyProgramId, authorityPubkey, lamports, tabId, rpcUrl) {
    this.log(`🔒 [AnonyMaus Solana] Requesting PrivacyCash deposit...`, 'info');
    this.log(`   Program: ${privacyProgramId}`, 'info');
    this.log(`   Authority: ${authorityPubkey}`, 'info');
    this.log(`   Amount: ${lamports} lamports (${(lamports / 1e9).toFixed(6)} SOL)`, 'info');

    return new Promise(async (resolve, reject) => {
      const requestId = `solana_privacy_deposit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.log(`🔎 [AnonyMaus Solana] PrivacyCash deposit requestId: ${requestId}`, 'info');

      const handler = async (message, sender, sendResponse) => {
        if (message.type === 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT' && message.requestId === requestId) {
          chrome.runtime.onMessage.removeListener(handler);
          chrome.runtime.onMessage.removeListener(ackHandler);
          if (message.error) {
            reject(new Error(message.error));
          } else if (message.signature) {
            resolve(message.signature);
          } else {
            reject(new Error('PrivacyCash deposit result missing signature'));
          }
          return true;
        }
      };

      const ackHandler = async (message, sender, sendResponse) => {
        if (message.type === 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_ACK' && message.requestId === requestId) {
          this.log(`✅ [AnonyMaus Solana] PrivacyCash deposit request received by content script`, 'info');
          chrome.runtime.onMessage.removeListener(ackHandler);
          return true;
        }
      };

      chrome.runtime.onMessage.addListener(handler);
      chrome.runtime.onMessage.addListener(ackHandler);

      try {
        setTimeout(() => {
          this.log(`⏳ [AnonyMaus Solana] Waiting for PrivacyCash deposit response...`, 'info');
        }, 8000);

        const sendToTab = (targetTabId) => new Promise((resolveSend, rejectSend) => {
          chrome.tabs.sendMessage(targetTabId, {
            type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_REQUEST',
            privacyProgramId,
            authorityPubkey,
            lamports,
            rpcUrl,
            requestId
          }, () => {
            const err = chrome.runtime.lastError;
            if (err) {
              rejectSend(err);
            } else {
              resolveSend();
            }
          });
        });

        try {
          await sendToTab(tabId);
        } catch (err) {
          this.log(`⚠️ [AnonyMaus Solana] PrivacyCash deposit send failed for tab ${tabId}: ${err?.message || err}`, 'warn');
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs && tabs[0]?.id && tabs[0].id !== tabId) {
            this.log(`🔁 [AnonyMaus Solana] Retrying PrivacyCash deposit on active tab ${tabs[0].id}`, 'info');
            await sendToTab(tabs[0].id);
          } else {
            throw err;
          }
        }

        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(handler);
          chrome.runtime.onMessage.removeListener(ackHandler);
          reject(new Error('PrivacyCash deposit request timeout'));
        }, 300000);
      } catch (error) {
        chrome.runtime.onMessage.removeListener(handler);
        chrome.runtime.onMessage.removeListener(ackHandler);
        reject(new Error('Failed to request PrivacyCash deposit'));
      }
    });
  }
  
  async waitForSolanaTransactionConfirmation(signature, maxWaitTime = 30000) {
    this.log(`⏳ [AnonyMaus Solana] Waiting for transaction confirmation...`, 'info');
    this.log(`   Signature: ${signature}`, 'info');
    
    // Poll for transaction confirmation using direct RPC calls (service workers can't use dynamic imports)
    const startTime = Date.now();
    const rpcUrl = 'https://solana-devnet.g.alchemy.com/v2/Sot3NTHhsx_C1Eunyg9ni';
    
    // Start with faster polling (500ms), then slow down after 5 seconds
    let pollInterval = 500;
    let fastPollEndTime = startTime + 5000;
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Direct RPC call to getSignatureStatus
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getSignatureStatus',
            params: [signature, { searchTransactionHistory: true }]
          })
        });
        
        const data = await response.json();
        if (data.result?.value) {
          const status = data.result.value;
          if (status.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
          }
          const confirmationStatus = status.confirmationStatus;
          if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
            this.log(`✅ [AnonyMaus Solana] Transaction confirmed: ${confirmationStatus}`, 'success');
            // Wait a bit more for account to be visible
            await new Promise(resolve => setTimeout(resolve, 1000));
            return;
          }
        }
      } catch (err) {
        this.log(`⚠️ [AnonyMaus Solana] Error checking status: ${err.message}`, 'warn');
      }
      
      // Use faster polling initially, then slower
      const currentTime = Date.now();
      if (currentTime < fastPollEndTime) {
        pollInterval = 500;
      } else {
        pollInterval = 2000;
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    this.log(`⚠️ [AnonyMaus Solana] Transaction confirmation timeout after ${maxWaitTime / 1000}s, assuming confirmed`, 'warn');
  }
  
  // ============================================================================
  // HELPER METHODS: USER SIGNATURE
  // ============================================================================
  async requestSolanaUserSignature(intent, tabId) {
    const requestId = `solana_intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    intent.requestId = requestId;
    
    this.log(`✍️ [AnonyMaus Solana] Requesting Phantom signature for intent...`, 'info');
    
    return new Promise((resolve, reject) => {
      this.pendingIntentSignatures.set(requestId, { resolve, reject });
      
      (async () => {
        let expectedOrigin = null;
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.url) expectedOrigin = new URL(tab.url).origin;
        } catch (e) {}

        await chrome.tabs.sendMessage(tabId, {
          type: 'SIGN_SOLANA_INTENT_WITH_PHANTOM',
          intent: intent,
          requestId: requestId,
          expectedOrigin: expectedOrigin
        });
      })().catch(error => {
        this.log(`❌ [AnonyMaus Solana] Error sending signature request: ${error.message}`, 'error');
        reject(error);
      });
      
      setTimeout(() => {
        if (this.pendingIntentSignatures.has(requestId)) {
          this.pendingIntentSignatures.delete(requestId);
          reject(new Error('Solana intent signature timeout'));
        }
      }, 300000);
    });
  }

  async requestSolanaUserTransactionSignature(transactionData, tabId) {
    const requestId = `solana_tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.log(`✍️ [AnonyMaus Solana] Requesting Phantom signature for transaction...`, 'info');
    return new Promise((resolve, reject) => {
      this.pendingTransactionSignatures.set(requestId, { resolve, reject });
      (async () => {
        let expectedOrigin = null;
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.url) expectedOrigin = new URL(tab.url).origin;
        } catch (e) {}

        await chrome.tabs.sendMessage(tabId, {
          type: 'SIGN_SOLANA_TRANSACTION_WITH_PHANTOM',
          transaction: transactionData,
          requestId: requestId,
          expectedOrigin: expectedOrigin
        });
      })().catch(error => {
        this.log(`❌ [AnonyMaus Solana] Error sending transaction signature request: ${error.message}`, 'error');
        reject(error);
      });
      setTimeout(() => {
        if (this.pendingTransactionSignatures.has(requestId)) {
          this.pendingTransactionSignatures.delete(requestId);
          reject(new Error('Solana transaction signature timeout'));
        }
      }, 300000);
    });
  }
  
  // ============================================================================
  // HELPER METHODS: TEE SUBMISSION
  // ============================================================================
  async requestTEEApproval(signedIntent) {
    if (!this.encryption || !this.teeClient) {
      this.initializeModules();
    }
    
    if (!signedIntent) {
      throw new Error('Missing signed intent');
    }

    this.log(`🔐 [AnonyMaus] Encrypting signed intent...`, 'info');
    
    try {
      const encryptedIntent = await this.encryption.encryptIntent(signedIntent);
      this.log(`✅ [AnonyMaus] Intent encrypted successfully`, 'info');
      
      this.log(`📡 [AnonyMaus] Sending encrypted intent to TEE network...`, 'info');
      const teeApproval = await this.teeClient.requestApproval(encryptedIntent);
      this.log(`✅ [AnonyMaus] TEE approval received`, 'info');
      
      return teeApproval;
    } catch (error) {
      this.log(`❌ [AnonyMaus] TEE approval failed: ${error.message}`, 'error');
      throw error;
    }
  }
  
  async submitSolanaTransaction(transactionData, signedIntent, method) {
    if (!signedIntent) {
      throw new Error('Missing signed intent');
    }
    const encryptedIntent = await this.encryption.encryptIntent(signedIntent);
    
    // Log BEFORE sanitization
    this.log(`🔍 [DEBUG] BEFORE sanitization - transactionData.extractedAmountLamports: ${transactionData.extractedAmountLamports} (type: ${typeof transactionData.extractedAmountLamports})`, 'info');
    this.log(`🔍 [DEBUG] BEFORE sanitization - transactionData.swapParams: ${JSON.stringify(transactionData.swapParams)}`, 'info');
    
    // Ensure extractedAmountLamports is a number before sanitization
    let amountToPreserve = transactionData.extractedAmountLamports;
    if (amountToPreserve !== undefined && amountToPreserve !== null) {
      if (typeof amountToPreserve === 'bigint') {
        const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
        amountToPreserve = amountToPreserve > MAX_SAFE ? Number.MAX_SAFE_INTEGER : Number(amountToPreserve);
      } else if (typeof amountToPreserve !== 'number') {
        amountToPreserve = Number(amountToPreserve) || 0;
      }
    }
    
    // Ensure BigInt values are converted to numbers/strings before JSON.stringify
    // JSON.stringify doesn't handle BigInt natively
    const sanitizedTransactionData = JSON.parse(JSON.stringify(transactionData, (key, value) => {
      if (typeof value === 'bigint') {
        // Convert BigInt to number for JSON serialization (cap at MAX_SAFE_INTEGER)
        const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
        return value > MAX_SAFE ? Number.MAX_SAFE_INTEGER : Number(value);
      }
      return value;
    }));
    
    // CRITICAL: Preserve extractedAmountLamports after sanitization
    if (amountToPreserve !== undefined && amountToPreserve !== null && amountToPreserve > 0) {
      sanitizedTransactionData.extractedAmountLamports = amountToPreserve;
      // Also ensure it's in swapParams
      if (!sanitizedTransactionData.swapParams) {
        sanitizedTransactionData.swapParams = {};
      }
      sanitizedTransactionData.swapParams.amountInLamports = sanitizedTransactionData.swapParams.amountInLamports || amountToPreserve;
      this.log(`✅ [DEBUG] Preserved amount: ${amountToPreserve} lamports`, 'info');
    } else {
      this.log(`⚠️ [DEBUG] No amount to preserve! amountToPreserve: ${amountToPreserve}`, 'warn');
    }
    
    this.log(`🔍 [AnonyMaus Solana] Sending transactionData with extractedAmountLamports: ${sanitizedTransactionData.extractedAmountLamports}`, 'info');
    this.log(`🔍 [AnonyMaus Solana] swapParams.amountInLamports: ${sanitizedTransactionData.swapParams?.amountInLamports}`, 'info');
    this.log(`🔍 [DEBUG] AFTER sanitization - sanitizedTransactionData.extractedAmountLamports: ${sanitizedTransactionData.extractedAmountLamports}`, 'info');
    
    const response = await fetch(`${this.teeClient.endpoint.replace('/api', '')}/api/submit-solana-transaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        encryptedIntent,
        transactionData: sanitizedTransactionData,
        method
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      const error = new Error(errorData.error || 'TEE Solana transaction submission failed');
      if (errorData.needsDeposit) {
        error.needsDeposit = true;
        error.executorProgramId = errorData.executorProgramId;
        error.userDepositPDA = errorData.userDepositPDA;
        error.vaultPDA = errorData.vaultPDA;
        error.userAddress = errorData.userAddress;
      }
      if (errorData.needsPrivacyDeposit) {
        error.needsPrivacyDeposit = true;
        error.privacyProgramId = errorData.privacyProgramId;
        error.amountLamports = errorData.amountLamports;
        error.authorityPubkey = errorData.authorityPubkey;
      }
      if (errorData.needsUserSignature) {
        error.needsUserSignature = true;
      }
      throw error;
    }
    
    const result = await response.json();
    return result;
  }
  
  // ============================================================================
  // HELPER METHODS: EXECUTOR
  // ============================================================================
  async getExecutorPublicKey() {
    try {
      const teeEndpoint = this.teeClient?.endpoint || 'http://localhost:3001/api';
      const response = await fetch(`${teeEndpoint.replace('/api', '')}/api/status`);
      if (response.ok) {
        const data = await response.json();
        if (data.executorPublicKey && data.executorPublicKey !== '11111111111111111111111111111111') {
          this.log(`📋 [AnonyMaus Solana] Executor public key from server: ${data.executorPublicKey}`, 'info');
          return data.executorPublicKey;
        } else {
          throw new Error('Executor public key not configured on server. Set SOLANA_EXECUTOR_PROGRAM_ID in server .env file.');
        }
      } else {
        throw new Error(`Server returned status ${response.status}. Make sure the TEE server is running.`);
      }
    } catch (e) {
      this.log(`❌ [AnonyMaus Solana] Could not fetch executor public key: ${e.message}`, 'error');
      throw new Error(`Failed to get executor public key: ${e.message}. Make sure the TEE server is running and SOLANA_EXECUTOR_PROGRAM_ID is set in .env`);
    }
  }
  
  // ============================================================================
  // UTILITY METHODS: LOGGING
  // ============================================================================
  async log(message, type = 'info') {
    if (typeof ConsoleLogsManager !== 'undefined') {
      const logsManager = new ConsoleLogsManager();
      await logsManager.addExtensionLog(message, type);
    } else {
      const timestamp = Date.now();
      chrome.storage.local.get(['consoleLogs'], (result) => {
        const logs = JSON.parse(result.consoleLogs || '[]');
        logs.push({ message, type, source: 'extension', timestamp });
        const recentLogs = logs.slice(-500);
        chrome.storage.local.set({ consoleLogs: JSON.stringify(recentLogs) });
      });
    }
    console.log(message);
  }
  
  logTransactionDetails(transactionData) {
    this.log(`📋 [AnonyMaus Solana] Transaction Data Summary:`, 'info');
    this.log(`   - Has serialized: ${!!transactionData.serialized}`, 'info');
    this.log(`   - Serialized size: ${transactionData.serialized?.length || 0} bytes`, 'info');
    this.log(`   - Has instructions: ${!!transactionData.instructions}`, 'info');
    this.log(`   - Instruction count: ${transactionData.instructions?.length || 0}`, 'info');
    this.log(`   - Fee payer: ${transactionData.feePayer || 'N/A'}`, 'info');
    this.log(`   - Has blockhash: ${!!transactionData.recentBlockhash}`, 'info');
  }
  
  logDepositDetails(requiredLamports, transferAmountLamports, executorPublicKey) {
    const baseAmount = requiredLamports;
    const baseFeeLamports = 5000;
    const estimatedFees = baseFeeLamports;
    const totalRequired = baseAmount + estimatedFees;
    
    this.log(`   📝 Deposit transaction details:`, 'info');
    this.log(`      Amount: ${(transferAmountLamports / 1e9).toFixed(6)} SOL (${transferAmountLamports} lamports)`, 'info');
    this.log(`      Extracted from transaction: ${(baseAmount / 1e9).toFixed(6)} SOL`, 'info');
    this.log(`      Estimated fees: ${(estimatedFees / 1e9).toFixed(6)} SOL`, 'info');
    this.log(`      Total with 10% buffer: ${(transferAmountLamports / 1e9).toFixed(6)} SOL`, 'info');
    this.log(`      Executor Program: ${executorPublicKey}`, 'info');
    this.log(`   💡 This deposit will create/update user deposit PDA account`, 'info');
  }
  
  logIntentDetails(intent) {
    this.log(`   🎯 Intent Details:`, 'info');
    this.log(`      Action: ${intent.action}`, 'info');
    this.log(`      Type: ${intent.transactionType}`, 'info');
    this.log(`      Timestamp: ${new Date(intent.timestamp).toLocaleString()}`, 'info');
    this.log(`      Expiry: ${new Date(intent.expiry).toLocaleString()}`, 'info');
    this.log(`      dApp: ${intent.metadata?.dappName || 'Unknown'}`, 'info');
    this.log(`      Instructions: ${intent.transaction?.instructions?.length || 0}`, 'info');
    if (intent.swapDetails) {
      this.log(`      Swap details: ${JSON.stringify(intent.swapDetails)}`, 'info');
    }
  }
  
  async createSolanaIntentHash(intent) {
    // Create a deterministic SHA-256 hash of the intent (64 hex chars)
    const intentString = JSON.stringify(intent);
    const intentBytes = new TextEncoder().encode(intentString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', intentBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  sendToPage(tabId, data, type) {
    chrome.tabs.sendMessage(tabId, { type, payload: data }).catch(() => {});
  }
  
  // ============================================================================
  // UTILITY METHODS: CLEANUP
  // ============================================================================
  async clearPendingTransactions() {
    this.log(`🧹 [AnonyMaus] Clearing all pending transactions...`, 'info');
    
    const allData = await chrome.storage.local.get(null);
    const txKeys = Object.keys(allData).filter(key => key.startsWith('tx_'));
    
    await chrome.storage.local.remove(txKeys);
    
    this.log(`✅ [AnonyMaus] Cleared ${txKeys.length} transactions`, 'info');
    return txKeys.length;
  }
  
  async autoCleanupMockTransactions() {
    this.log(`🧹 [AnonyMaus] Auto-cleaning up old transactions...`, 'info');
    
    const allData = await chrome.storage.local.get(null);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const toRemove = [];
    
    Object.keys(allData).forEach(key => {
      if (key.startsWith('tx_') && allData[key]) {
        try {
          const txData = JSON.parse(allData[key]);
          const age = now - (txData.submittedAt || txData.failedAt || txData.updatedAt || 0);
          if (age > maxAge) {
            toRemove.push(key);
          }
        } catch (e) {
          toRemove.push(key);
        }
      }
    });
    
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      this.log(`✅ [AnonyMaus] Auto-cleaned ${toRemove.length} old transactions`, 'info');
    } else {
      this.log(`✅ [AnonyMaus] No old transactions to clean`, 'info');
    }
    
    // Schedule periodic cleanup
    setInterval(() => {
      this.autoCleanupMockTransactions();
    }, 60 * 60 * 1000);
  }
  
  // ============================================================================
  // LEGACY METHODS (for compatibility)
  // ============================================================================
  async getInitialState() {
    return {
      accounts: [],
      chainId: null,
      isConnected: false
    };
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================
const background = new AnonyMausBackground();
