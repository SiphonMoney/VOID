// Content script - runs in page context
// Injects wallet providers and bridges communication

(function() {
  'use strict';

  // ============================================================================
  // STEP 1: INITIALIZATION
  // ============================================================================
  console.log('%c🚀🚀🚀 [VØID] CONTENT SCRIPT LOADED!', 'color: #4caf50; font-weight: bold; font-size: 20px; background: #4caf50; color: white; padding: 10px; border-radius: 5px;');
  console.log('📍 [VØID] URL:', window.location.href);
  console.log('📍 [VØID] Document ready state:', document.readyState);

  // ============================================================================
  // STEP 2: SCRIPT INJECTION
  // ============================================================================
  // Inject scripts in order:
  // 1. Porto blocker (MUST run first to block Porto before it intercepts)
  // 2. Solana transaction interceptor (intercepts Phantom transactions)
  // 3. Phantom signer (handles Solana signing in page context)
  // NOTE: Wallet injector is NOT injected - we don't want VØID to appear as a wallet option
  // Users connect with their existing wallets (Phantom, etc.), and we intercept transactions

  // Step 2.1: Inject Porto blocker FIRST
  injectPortoBlocker();
  
  // Step 2.2: Inject interception scripts with delays to ensure proper order
  setTimeout(() => {
    injectSolanaTransactionInterceptor();
    
    setTimeout(() => {
      injectPhantomSigner();
    }, 10);
  }, 10);

  console.log('%c📍 [VØID] Content script loaded on:', 'color: #2196F3; font-weight: bold;', window.location.href);

  // ============================================================================
  // STEP 2.1: PORTO BLOCKER INJECTION
  // ============================================================================
  function injectPortoBlocker() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('functions/porto-blocker.js');
      script.onload = function() {
        console.log('%c✅ [VØID] Porto blocker loaded', 'color: #4caf50; font-weight: bold;');
        this.remove();
      };
      script.onerror = function() {
        console.error('%c❌ [VØID] Failed to load Porto blocker', 'color: #ff1493; font-weight: bold;');
      };
      
      const target = document.head || document.documentElement;
      if (target) {
        target.insertBefore(script, target.firstChild);
      } else {
        setTimeout(() => {
          const retryTarget = document.head || document.documentElement;
          if (retryTarget) {
            retryTarget.insertBefore(script, retryTarget.firstChild);
          }
        }, 0);
      }
    } catch (error) {
      console.error('%c❌ [VØID] Error injecting Porto blocker:', 'color: #ff1493; font-weight: bold;', error);
    }
  }

  // ============================================================================
  // STEP 2.2: SOLANA TRANSACTION INTERCEPTOR INJECTION
  // ============================================================================
  // NOTE: Wallet injector is intentionally NOT injected
  // We only intercept transactions from existing wallets, we don't appear as a wallet option
  function injectSolanaTransactionInterceptor() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('functions/solana-transaction-interceptor.js');
      script.onload = function() {
        console.log('%c✅ [VØID Solana] Transaction interceptor loaded', 'color: #4caf50; font-weight: bold;');
        this.remove();
      };
      script.onerror = function() {
        console.error('%c❌ [VØID Solana] Failed to load transaction interceptor', 'color: #ff1493; font-weight: bold;');
      };
      
      const target = document.head || document.documentElement;
      if (target) {
        target.insertBefore(script, target.firstChild);
      } else {
        setTimeout(() => {
          const retryTarget = document.head || document.documentElement;
          if (retryTarget) {
            retryTarget.insertBefore(script, retryTarget.firstChild);
          }
        }, 0);
      }
    } catch (error) {
      console.error('%c❌ [VØID Solana] Error injecting transaction interceptor:', 'color: #ff1493; font-weight: bold;', error);
    }
  }

  // ============================================================================
  // STEP 2.3: PHANTOM SIGNER INJECTION
  // ============================================================================
  function injectPhantomSigner() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('functions/phantom-signer.js');
      script.onload = function() {
        console.log('%c✅ [VØID Solana] Phantom signer loaded', 'color: #4caf50; font-weight: bold;');
        this.remove();
      };
      script.onerror = function() {
        console.error('%c❌ [VØID Solana] Failed to load Phantom signer', 'color: #ff1493; font-weight: bold;');
      };
      
      const target = document.head || document.documentElement;
      if (target) {
        target.insertBefore(script, target.firstChild);
      } else {
        setTimeout(() => {
          const retryTarget = document.head || document.documentElement;
          if (retryTarget) {
            retryTarget.insertBefore(script, retryTarget.firstChild);
          }
        }, 0);
      }
    } catch (error) {
      console.error('%c❌ [VØID Solana] Error injecting Phantom signer:', 'color: #ff1493; font-weight: bold;', error);
    }
  }

  // ============================================================================
  // STEP 3: MESSAGE BRIDGING SETUP
  // ============================================================================
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    // Wrap runtime.sendMessage to avoid unhandled rejections
    try {
      const originalRuntimeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => {
        const promise = originalRuntimeSend(...args);
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => {});
        }
        return promise;
      };
    } catch (e) {
      // Ignore wrapper failures
    }
    // Step 3.1: Setup page-to-extension message forwarding
    setupPageToExtensionBridge();
    
    // Step 3.2: Setup extension-to-page message forwarding
    setupExtensionToPageBridge();
  } else {
    console.error('❌ [VØID] chrome.runtime not available in content script');
  }

  // ============================================================================
  // STEP 3.1: PAGE-TO-EXTENSION MESSAGE BRIDGE
  // ============================================================================
  function setupPageToExtensionBridge() {
    window.addEventListener('message', (event) => {
      // Only accept messages from same window
      if (event.source !== window) return;

      // Forward Solana messages from page to extension
      if (event.data && event.data.type === 'ANONYMAUS_SOLANA_FROM_PAGE') {
        handlePageToExtensionMessage(event);
      }
    });
  }

  // ============================================================================
  // STEP 3.2: EXTENSION-TO-PAGE MESSAGE BRIDGE
  // ============================================================================
  function setupExtensionToPageBridge() {
    if (chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.expectedOrigin && message.expectedOrigin !== window.location.origin) {
          if (sendResponse) {
            sendResponse({ ignored: true });
          }
          return false;
        }
        // Handle Solana intent signing request from background
        if (message.type === 'SIGN_SOLANA_INTENT_WITH_PHANTOM') {
          if (sendResponse) {
            sendResponse({ ack: true });
          }
          handlePhantomSigning(message, sendResponse).catch(err => {
            if (sendResponse) {
              try {
                sendResponse({ success: false, error: err.message });
              } catch (e) {
                // Channel closed, ignore
              }
            }
          });
          return false;
        }

        // Handle Solana transaction signing request from background
        if (message.type === 'SIGN_SOLANA_TRANSACTION_WITH_PHANTOM') {
          if (sendResponse) {
            sendResponse({ ack: true });
          }
          handlePhantomTransactionSigning(message, sendResponse).catch(err => {
            if (sendResponse) {
              try {
                sendResponse({ success: false, error: err.message });
              } catch (e) {
                // Channel closed, ignore
              }
            }
          });
          return false;
        }
        
        // Handle Solana vault transfer request from background
        if (message.type === 'ANONYMAUS_SOLANA_VAULT_TRANSFER_REQUEST') {
          if (sendResponse) {
            sendResponse({ ack: true });
          }
          handleSolanaVaultTransfer(message, sendResponse).catch(err => {
            if (sendResponse) {
              try {
                sendResponse({ success: false, error: err.message });
              } catch (e) {
                // Channel closed, ignore
              }
            }
          });
          return false;
        }

        if (message.type === 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_REQUEST') {
          console.log('%c📥 [VØID Solana] PrivacyCash deposit request received from background', 'color: #4caf50; font-weight: bold;');
          chrome.runtime.sendMessage({
            type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_ACK',
            requestId: message.requestId
          });
          if (sendResponse) {
            sendResponse({ ack: true });
          }
          handleSolanaPrivacycashDeposit(message, sendResponse).catch(err => {
            if (sendResponse) {
              try {
                sendResponse({ success: false, error: err.message });
              } catch (e) {
                // Channel closed, ignore
              }
            }
          });
          return false;
        }
        
        // Forward messages from extension to page (Solana)
        if (message.type === 'ANONYMAUS_SOLANA_TO_PAGE') {
          if (message?.payload?.expectedOrigin && message.payload.expectedOrigin !== window.location.origin) {
            if (sendResponse) {
              sendResponse({ ignored: true });
            }
            return false;
          }
          console.log('📬 [VØID Content] Forwarding Solana to page:', message.payload);
          window.postMessage(message, '*');
          if (sendResponse) {
            sendResponse({ success: true });
          }
          return false; // Synchronous response
        }
        
        // Unknown message type - don't keep channel open
        return false;
      });
    }
  }

  // ============================================================================
  // STEP 4: MESSAGE HANDLERS
  // ============================================================================
  function handlePageToExtensionMessage(event) {
    const method = event.data.payload.method;
    console.log('📨 [VØID Content] Forwarding Solana to background:', method);
    
    // Log transaction details for signing methods
    if (method === 'signTransaction' || method === 'signAndSendTransaction') {
      logTransactionDetails(event.data.payload.transaction);
    } else if (method === 'signAllTransactions') {
      console.log('💸 [VØID Content] SOLANA TRANSACTIONS CAUGHT!', event.data.payload.transactions);
      console.log('📋 [VØID Content] Transactions count:', event.data.payload.transactions?.length || 0);
    }
    
    // Send message to background and wait for response
    safeSendMessage({
      ...event.data.payload,
      chain: 'solana'
    }).then(response => {
      // Send response back to page if we got one directly
      if (response && response.requestId) {
        window.postMessage({
          type: 'ANONYMAUS_SOLANA_TO_PAGE',
          payload: response
        }, '*');
      }
    }).catch((error) => {
      handleMessageError(error, event.data.payload.requestId);
    });
  }

  // ============================================================================
  // STEP 4.1: PHANTOM SIGNING HANDLER
  // ============================================================================
  async function handlePhantomSigning(message, sendResponse) {
    const { intent, requestId } = message;
    
    try {
      console.log('%c✍️ [VØID Solana] Requesting Phantom signature...', 'color: #ff1493; font-weight: bold;');
      
      await new Promise((resolve, reject) => {
        // Step 4.1.1: Setup message listener for response
        const messageListener = setupPhantomSigningListener(requestId, intent, sendResponse, resolve, reject);
        
        // Step 4.1.2: Send signing request to page context
        sendPhantomSigningRequest(intent, requestId);
        
        // Step 4.1.3: Setup timeout
        setupPhantomSigningTimeout(requestId, intent, messageListener, sendResponse, reject);
      });
      
    } catch (error) {
      handlePhantomSigningError(error, requestId, intent, sendResponse);
      throw error; // Re-throw so caller knows it failed
    }
  }

  // ============================================================================
  // STEP 4.1B: PHANTOM TRANSACTION SIGNING HANDLER
  // ============================================================================
  async function handlePhantomTransactionSigning(message, sendResponse) {
    const { transaction, requestId } = message;
    try {
      console.log('%c✍️ [VØID Solana] Requesting Phantom signature for transaction...', 'color: #ff1493; font-weight: bold;');

      return new Promise((resolve, reject) => {
        const messageListener = (event) => {
          if (event.source !== window) return;
          if (event.data && event.data.type === 'ANONYMAUS_SOLANA_SIGN_RESULT' && event.data.requestId === requestId) {
            window.removeEventListener('message', messageListener);
            if (event.data.success) {
              chrome.runtime.sendMessage({
                type: 'SOLANA_TRANSACTION_SIGNATURE_RESULT',
                requestId: requestId,
                signedTransaction: event.data.signedTransaction,
                signature: event.data.signature,
                publicKey: event.data.publicKey
              });
              if (sendResponse) {
                sendResponse({ success: true, signature: event.data.signature });
              }
              resolve(event.data);
            } else {
              const error = new Error(event.data.error || 'Signing failed');
              chrome.runtime.sendMessage({
                type: 'SOLANA_TRANSACTION_SIGNATURE_RESULT',
                requestId: requestId,
                error: error.message
              });
              if (sendResponse) {
                sendResponse({ success: false, error: error.message });
              }
              reject(error);
            }
          }
        };

        window.addEventListener('message', messageListener);

        // Send transaction signing request to page context
        window.postMessage({
          type: 'ANONYMAUS_SOLANA_SIGN_REQUEST',
          transaction: transaction,
          intent: null,
          signingMethod: 'signTransaction',
          requestId: requestId
        }, '*');

        setTimeout(() => {
          window.removeEventListener('message', messageListener);
          const timeoutError = new Error('Phantom transaction signing timeout');
          chrome.runtime.sendMessage({
            type: 'SOLANA_TRANSACTION_SIGNATURE_RESULT',
            requestId: requestId,
            error: timeoutError.message
          });
          if (sendResponse) {
            sendResponse({ success: false, error: timeoutError.message });
          }
          reject(timeoutError);
        }, 150000);
      });
    } catch (error) {
      chrome.runtime.sendMessage({
        type: 'SOLANA_TRANSACTION_SIGNATURE_RESULT',
        requestId: requestId,
        error: error.message || 'Signing failed'
      });
      if (sendResponse) {
        sendResponse({ success: false, error: error.message });
      }
    }
  }

  // ============================================================================
  // STEP 4.1.1: SETUP PHANTOM SIGNING LISTENER
  // ============================================================================
  function setupPhantomSigningListener(requestId, intent, sendResponse, resolve, reject) {
    const messageListener = (event) => {
      // Only accept messages from same window
      if (event.source !== window) return;
      
      if (event.data && event.data.type === 'ANONYMAUS_SOLANA_SIGN_RESULT' && event.data.requestId === requestId) {
        window.removeEventListener('message', messageListener);
        
        if (event.data.success) {
          handlePhantomSigningSuccess(event.data, requestId, intent, sendResponse, resolve);
        } else {
          handlePhantomSigningFailure(event.data, requestId, intent, sendResponse, reject);
        }
      }
    };
    
    window.addEventListener('message', messageListener);
    return messageListener;
  }

  // ============================================================================
  // STEP 4.1.2: SEND PHANTOM SIGNING REQUEST
  // ============================================================================
  function sendPhantomSigningRequest(intent, requestId) {
    const transactionData = intent.transaction;
    window.postMessage({
      type: 'ANONYMAUS_SOLANA_SIGN_REQUEST',
      transaction: transactionData,
      intent: intent,
      signingMethod: intent.transactionType === 'signAndSendTransaction' ? 'signAndSendTransaction' : 'signTransaction',
      requestId: requestId
    }, '*');
  }

  // ============================================================================
  // STEP 4.1.3: SETUP PHANTOM SIGNING TIMEOUT
  // ============================================================================
  function setupPhantomSigningTimeout(requestId, intent, messageListener, sendResponse, reject) {
    setTimeout(() => {
      window.removeEventListener('message', messageListener);
      const timeoutError = new Error('Phantom signing timeout - popup did not appear or user did not respond');
      console.error(`%c❌ [VØID Solana] ${timeoutError.message}`, 'color: #ff1493; font-weight: bold;');
      
      // Send timeout error back to background
      chrome.runtime.sendMessage({
        type: 'SOLANA_SIGNATURE_RESULT',
        requestId: requestId,
        error: timeoutError.message,
        intent: intent
      });
      
      if (sendResponse) {
        sendResponse({ success: false, error: timeoutError.message });
      }
      
      reject(timeoutError);
    }, 150000); // 2.5 minutes
  }

  // ============================================================================
  // STEP 4.1.4: HANDLE PHANTOM SIGNING SUCCESS
  // ============================================================================
  function handlePhantomSigningSuccess(data, requestId, intent, sendResponse, resolve) {
    console.log(`%c✅ [VØID Solana] Phantom signature received`, 'color: #4caf50; font-weight: bold;');
    console.log(`%c👤 [VØID Solana] Signed with account: ${data.publicKey}`, 'color: #4caf50; font-weight: bold;');
    
    // Send signature back to background
    chrome.runtime.sendMessage({
      type: 'SOLANA_SIGNATURE_RESULT',
      requestId: requestId,
      signedTransaction: data.signedTransaction,
      signature: data.signature,
      publicKey: data.publicKey,
      intent: intent
    }).then(() => {
      console.log(`%c✅ [VØID Solana] Signature result sent to background successfully`, 'color: #4caf50; font-weight: bold;');
    }).catch((error) => {
      console.error(`%c❌ [VØID Solana] Error sending signature result to background: ${error.message}`, 'color: #ff1493; font-weight: bold;');
    });
    
    if (sendResponse) {
      sendResponse({ success: true, signature: data.signature });
    }
    
    resolve(data);
  }

  // ============================================================================
  // STEP 4.1.5: HANDLE PHANTOM SIGNING FAILURE
  // ============================================================================
  function handlePhantomSigningFailure(data, requestId, intent, sendResponse, reject) {
    const error = new Error(data.error || 'Signing failed');
    console.error(`%c❌ [VØID Solana] Phantom signing error: ${error.message}`, 'color: #ff1493; font-weight: bold;');
    
    // Send error back to background
    chrome.runtime.sendMessage({
      type: 'SOLANA_SIGNATURE_RESULT',
      requestId: requestId,
      error: error.message,
      intent: intent
    });
    
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
    
    reject(error);
  }

  // ============================================================================
  // STEP 4.1.6: HANDLE PHANTOM SIGNING ERROR
  // ============================================================================
  function handlePhantomSigningError(error, requestId, intent, sendResponse) {
    console.error(`%c❌ [VØID Solana] Phantom signing error: ${error.message}`, 'color: #ff1493; font-weight: bold;');
    
    // Send error back to background
    chrome.runtime.sendMessage({
      type: 'SOLANA_SIGNATURE_RESULT',
      requestId: requestId,
      error: error.message || 'Signing failed',
      intent: intent
    });
    
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  }

  // ============================================================================
  // STEP 4.2: VAULT TRANSFER HANDLER
  // ============================================================================
  async function handleSolanaVaultTransfer(message, sendResponse) {
    const { executorProgramId, lamports, requestId, rpcUrl } = message;
    
    try {
      console.log('%c💰 [VØID Solana] Requesting vault transfer via Phantom...', 'color: #ff1493; font-weight: bold;');
      console.log(`   Executor Program: ${executorProgramId}`, 'color: #ff1493;');
      console.log(`   Amount: ${lamports} lamports (${lamports / 1e9} SOL)`, 'color: #ff1493;');
      
      await new Promise((resolve, reject) => {
        // Step 4.2.1: Setup message listener for response
        const messageListener = setupVaultTransferListener(requestId, sendResponse, resolve, reject);
        
        // Step 4.2.2: Send vault transfer request to page context
        sendVaultTransferRequest(executorProgramId, lamports, rpcUrl, requestId);
        
        // Step 4.2.3: Setup timeout
        setupVaultTransferTimeout(requestId, messageListener, sendResponse, reject);
      });
      
    } catch (error) {
      handleVaultTransferError(error, requestId, sendResponse);
      throw error; // Re-throw so caller knows it failed
    }
  }

  // ============================================================================
  // STEP 4.3: PRIVACYCASH DEPOSIT HANDLER
  // ============================================================================
  async function handleSolanaPrivacycashDeposit(message, sendResponse) {
    const { privacyProgramId, authorityPubkey, lamports, requestId, rpcUrl } = message;

    // Wrap in try-catch to ensure sendResponse is always called
    try {
      console.log('%c🔎 [VØID Solana] PrivacyCash deposit handler invoked', 'color: #4caf50; font-weight: bold;');
      console.log(`   requestId: ${requestId}`, 'color: #4caf50;');

      console.log('%c🔒 [VØID Solana] Requesting PrivacyCash deposit via Phantom...', 'color: #ff1493; font-weight: bold;');
      console.log(`   Program: ${privacyProgramId}`, 'color: #ff1493;');
      console.log(`   Authority: ${authorityPubkey}`, 'color: #ff1493;');
      console.log(`   Amount: ${lamports} lamports (${lamports / 1e9} SOL)`, 'color: #ff1493;');

      // Wait for phantom-signer to be ready first (before creating Promise)
      let signerReady = window.__ANONYMAUS_PHANTOM_SIGNER_READY__ || document.documentElement?.getAttribute('data-anonymaus-phantom-signer') === 'ready';
      if (!signerReady) {
        console.log('%c⏳ [VØID Solana] Waiting for phantom-signer to be ready...', 'color: #ffa500;');
        // Wait up to 2 seconds for phantom-signer to be ready
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          signerReady = window.__ANONYMAUS_PHANTOM_SIGNER_READY__ || document.documentElement?.getAttribute('data-anonymaus-phantom-signer') === 'ready';
          if (signerReady) break;
        }
      }
      
      console.log(`%c🔍 [VØID Solana] Phantom signer ready: ${signerReady}`, signerReady ? 'color: #4caf50;' : 'color: #ff1493;');
      
      if (!signerReady) {
        // Try to ping phantom-signer to verify it's actually running
        console.log('%c🔍 [VØID Solana] Testing phantom-signer connectivity...', 'color: #ffa500;');
        const pingPromise = new Promise((resolve) => {
          const pingListener = (event) => {
            if (event.data && event.data.type === 'ANONYMAUS_PHANTOM_SIGNER_PONG') {
              window.removeEventListener('message', pingListener);
              console.log('%c✅ [VØID Solana] Phantom-signer is responsive!', 'color: #4caf50;');
              resolve(true);
            }
          };
          window.addEventListener('message', pingListener);
          window.postMessage({ type: 'ANONYMAUS_PHANTOM_SIGNER_PING' }, '*');
          setTimeout(() => {
            window.removeEventListener('message', pingListener);
            console.log('%c⚠️ [VØID Solana] Phantom-signer ping timeout', 'color: #ffa500;');
            resolve(false);
          }, 1000);
        });
        
        const pingResult = await pingPromise;
        if (!pingResult) {
          const error = new Error('Phantom signer not responding - page may need to be reloaded');
          console.error('%c❌ [VØID Solana]', 'color: #ff1493; font-weight: bold;', error.message);
          chrome.runtime.sendMessage({
            type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT',
            requestId,
            error: error.message,
            success: false
          });
          if (sendResponse) {
            sendResponse({ success: false, error: error.message });
          }
          return; // Return instead of throw to avoid unhandled promise rejection
        }
        // If ping succeeded, continue even if ready flag wasn't set
        console.log('%c✅ [VØID Solana] Phantom-signer verified, proceeding...', 'color: #4caf50;');
      }

      console.log('%c📨 [VØID Solana] Sending PrivacyCash deposit request to page...', 'color: #ff1493; font-weight: bold;');
      
      // Verify phantom-signer is actually loaded and test connectivity (before creating Promise)
      const phantomSignerExists = window.__ANONYMAUS_PHANTOM_SIGNER__ === true;
      console.log(`%c🔍 [VØID Solana] Phantom-signer loaded: ${phantomSignerExists}`, phantomSignerExists ? 'color: #4caf50;' : 'color: #ff1493;');
      console.log(`%c🔍 [VØID Solana] Window.__ANONYMAUS_PHANTOM_SIGNER_READY__: ${window.__ANONYMAUS_PHANTOM_SIGNER_READY__}`, 'color: #ffa500;');
      console.log(`%c🔍 [VØID Solana] Document attribute: ${document.documentElement?.getAttribute('data-anonymaus-phantom-signer')}`, 'color: #ffa500;');
      
      // Test if phantom-signer can receive messages by sending a ping first
      const pingTest = new Promise((resolve) => {
        const pingListener = (event) => {
          if (event.data && event.data.type === 'ANONYMAUS_PHANTOM_SIGNER_PONG') {
            window.removeEventListener('message', pingListener);
            console.log('%c✅ [VØID Solana] Phantom-signer ping successful - it is receiving messages!', 'color: #4caf50; font-weight: bold;');
            resolve(true);
          }
        };
        window.addEventListener('message', pingListener);
        window.postMessage({ type: 'ANONYMAUS_PHANTOM_SIGNER_PING' }, '*');
        setTimeout(() => {
          window.removeEventListener('message', pingListener);
          console.log('%c⚠️ [VØID Solana] Phantom-signer ping timeout - may not be receiving messages', 'color: #ffa500;');
          resolve(false);
        }, 1000);
      });
      
      const pingResult = await pingTest;
      if (!pingResult && !phantomSignerExists) {
        console.error('%c❌ [VØID Solana] Phantom-signer appears to not be loaded!', 'color: #ff1493; font-weight: bold;');
        const error = new Error('Phantom-signer not loaded - page may need to be reloaded');
        chrome.runtime.sendMessage({
          type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT',
          requestId,
          error: error.message,
          success: false
        });
        if (sendResponse) {
          sendResponse({ success: false, error: error.message });
        }
        return; // Return instead of throw
      }

      return new Promise((resolve, reject) => {
        const messageListener = (event) => {
          // Debug: log all messages to trace issues
          if (event.data && event.data.type && event.data.type.includes('PRIVACYCASH')) {
            console.log('%c🔍 [VØID Solana] Content script received message:', 'color: #ffa500;', event.data.type, 'requestId:', event.data.requestId, 'expected:', requestId);
          }
          
          if (event.source !== window) {
            console.log('%c⚠️ [VØID Solana] Rejecting message from non-window source', 'color: #ffa500;');
            return;
          }
          
          if (event.data && event.data.type === 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT' && event.data.requestId === requestId) {
            console.log('%c✅ [VØID Solana] PrivacyCash deposit response received from page', 'color: #4caf50; font-weight: bold;');
            console.log('%c   Response data:', 'color: #4caf50;', event.data);
            window.removeEventListener('message', messageListener);
            if (event.data.success) {
              chrome.runtime.sendMessage({
                type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT',
                requestId,
                signature: event.data.signature,
                success: true
              });
              if (sendResponse) {
                sendResponse({ success: true, signature: event.data.signature });
              }
              resolve(event.data);
            } else {
              console.log('%c❌ [VØID Solana] PrivacyCash deposit error from page', 'color: #ff1493; font-weight: bold;', event.data.error);
              chrome.runtime.sendMessage({
                type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT',
                requestId,
                error: event.data.error,
                success: false
              });
              if (sendResponse) {
                sendResponse({ success: false, error: event.data.error });
              }
              reject(new Error(event.data.error || 'PrivacyCash deposit failed'));
            }
          }
        };

        window.addEventListener('message', messageListener);
        
        const messagePayload = {
          type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_REQUEST',
          privacyProgramId,
          authorityPubkey,
          lamports,
          rpcUrl,
          requestId,
          timestamp: Date.now()
        };
        console.log('%c📤 [VØID Solana] Message payload:', 'color: #ff1493;', messagePayload);
        console.log('%c📤 [VØID Solana] Sending via window.postMessage...', 'color: #ff1493;');
        
        // Send message multiple times to ensure it's received (in case of timing issues)
        // Use both window.postMessage and document.dispatchEvent for maximum compatibility
        window.postMessage(messagePayload, '*');
        console.log('%c✅ [VØID Solana] window.postMessage called', 'color: #4caf50;');
        
        // Also try dispatching a custom event as backup
        try {
          const customEvent = new CustomEvent('anonymaus-privacycash-deposit', {
            detail: messagePayload,
            bubbles: true,
            cancelable: true
          });
          document.dispatchEvent(customEvent);
          console.log('%c📤 [VØID Solana] Custom event dispatched as backup', 'color: #ffa500;');
        } catch (e) {
          console.log('%c⚠️ [VØID Solana] Custom event dispatch failed:', 'color: #ffa500;', e);
        }
        
        // Send again after a short delay as backup
        setTimeout(() => {
          console.log('%c📤 [VØID Solana] Sending backup message (100ms)...', 'color: #ffa500;');
          window.postMessage(messagePayload, '*');
        }, 100);
        
        // Send one more time after longer delay
        setTimeout(() => {
          console.log('%c📤 [VØID Solana] Sending final backup message (500ms)...', 'color: #ffa500;');
          window.postMessage(messagePayload, '*');
        }, 500);
        
        console.log('%c📤 [VØID Solana] postMessage sent, waiting for response...', 'color: #ff1493;');
        console.log(`%c   RequestId: ${requestId}`, 'color: #ff1493;');
        console.log(`%c   Timeout: 30 seconds`, 'color: #ff1493;');

        setTimeout(() => {
          window.removeEventListener('message', messageListener);
          const timeoutError = new Error('PrivacyCash deposit timeout (no page response)');
          chrome.runtime.sendMessage({
            type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT',
            requestId,
            error: timeoutError.message,
            success: false
          });
          if (sendResponse) {
            sendResponse({ success: false, error: timeoutError.message });
          }
          reject(timeoutError);
        }, 30000);
      });
    } catch (error) {
      chrome.runtime.sendMessage({
        type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT',
        requestId,
        error: error.message,
        success: false
      });
      if (sendResponse) {
        sendResponse({ success: false, error: error.message });
      }
    }
  }

  // ============================================================================
  // STEP 4.2.1: SETUP VAULT TRANSFER LISTENER
  // ============================================================================
  function setupVaultTransferListener(requestId, sendResponse, resolve, reject) {
    const messageListener = (event) => {
      // Only accept messages from same window
      if (event.source !== window) return;
      
      if (event.data && event.data.type === 'ANONYMAUS_SOLANA_VAULT_TRANSFER_RESULT' && event.data.requestId === requestId) {
        window.removeEventListener('message', messageListener);
        
        if (event.data.success) {
          handleVaultTransferSuccess(event.data, requestId, sendResponse, resolve);
        } else {
          handleVaultTransferFailure(event.data, requestId, sendResponse, reject);
        }
      }
    };
    
    window.addEventListener('message', messageListener);
    return messageListener;
  }

  // ============================================================================
  // STEP 4.2.2: SEND VAULT TRANSFER REQUEST
  // ============================================================================
  function sendVaultTransferRequest(executorProgramId, lamports, rpcUrl, requestId) {
    window.postMessage({
      type: 'ANONYMAUS_SOLANA_VAULT_TRANSFER_REQUEST',
      executorProgramId: executorProgramId,
      lamports: lamports,
      rpcUrl: rpcUrl,
      requestId: requestId
    }, '*');
  }

  // ============================================================================
  // STEP 4.2.3: SETUP VAULT TRANSFER TIMEOUT
  // ============================================================================
  function setupVaultTransferTimeout(requestId, messageListener, sendResponse, reject) {
    setTimeout(() => {
      window.removeEventListener('message', messageListener);
      const timeoutError = new Error('Vault transfer timeout - Phantom popup did not appear or user did not respond');
      console.error(`%c❌ [VØID Solana] ${timeoutError.message}`, 'color: #ff1493; font-weight: bold;');
      
      // Send timeout error back to background
      chrome.runtime.sendMessage({
        type: 'ANONYMAUS_SOLANA_VAULT_TRANSFER_RESULT',
        requestId: requestId,
        error: timeoutError.message,
        success: false
      });
      
      if (sendResponse) {
        sendResponse({ success: false, error: timeoutError.message });
      }
      
      reject(timeoutError);
    }, 150000); // 2.5 minutes
  }

  // ============================================================================
  // STEP 4.2.4: HANDLE VAULT TRANSFER SUCCESS
  // ============================================================================
  function handleVaultTransferSuccess(data, requestId, sendResponse, resolve) {
    console.log(`%c✅ [VØID Solana] Vault transfer transaction submitted: ${data.signature}`, 'color: #4caf50; font-weight: bold;');
    
    // Send result back to background
    chrome.runtime.sendMessage({
      type: 'ANONYMAUS_SOLANA_VAULT_TRANSFER_RESULT',
      requestId: requestId,
      signature: data.signature,
      success: true
    });
    
    if (sendResponse) {
      sendResponse({ success: true, signature: data.signature });
    }
    
    resolve(data);
  }

  // ============================================================================
  // STEP 4.2.5: HANDLE VAULT TRANSFER FAILURE
  // ============================================================================
  function handleVaultTransferFailure(data, requestId, sendResponse, reject) {
    const rawMessage = data.error || 'Vault transfer failed';
    const error = new Error(rawMessage);
    const friendlyMessage = `${rawMessage} (flow: intercept → build deposit → user approves → intent signed → executor executes)`;
    console.error(`%c❌ [VØID Solana] Vault transfer error: ${friendlyMessage}`, 'color: #ff1493; font-weight: bold;');
    
    // Send error back to background
    chrome.runtime.sendMessage({
      type: 'ANONYMAUS_SOLANA_VAULT_TRANSFER_RESULT',
      requestId: requestId,
      error: friendlyMessage,
      success: false
    });
    
    if (sendResponse) {
      sendResponse({ success: false, error: friendlyMessage });
    }
    
    reject(new Error(friendlyMessage));
  }

  // ============================================================================
  // STEP 4.2.6: HANDLE VAULT TRANSFER ERROR
  // ============================================================================
  function handleVaultTransferError(error, requestId, sendResponse) {
    console.error(`%c❌ [VØID Solana] Vault transfer error: ${error.message}`, 'color: #ff1493; font-weight: bold;');
    
    // Send error back to background
    chrome.runtime.sendMessage({
      type: 'ANONYMAUS_SOLANA_VAULT_TRANSFER_RESULT',
      requestId: requestId,
      error: error.message || 'Vault transfer failed',
      success: false
    });
    
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  }

  // ============================================================================
  // STEP 5: UTILITY FUNCTIONS
  // ============================================================================
  
  // Step 5.1: Extension context validation
  function isExtensionContextValid() {
    try {
      return typeof chrome !== 'undefined' && 
             chrome.runtime && 
             chrome.runtime.id && 
             chrome.runtime.sendMessage;
    } catch (e) {
      return false;
    }
  }
  
  // Step 5.2: Safe message sending
  function safeSendMessage(message) {
    if (!isExtensionContextValid()) {
      const error = new Error('Extension context invalidated');
      return Promise.reject(error);
    }
    
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (error) {
      return Promise.resolve(null);
    }
  }

  // Step 5.2b: Fire-and-forget runtime send (avoid unhandled rejections)
  function fireAndForgetRuntimeSend(message) {
    if (!isExtensionContextValid()) {
      return Promise.resolve();
    }
    try {
      return chrome.runtime.sendMessage(message).catch(() => {});
    } catch (error) {
      return Promise.resolve();
    }
  }

  // Step 5.3: Message error handling
  function handleMessageError(error, requestId) {
    // Handle extension context invalidated error gracefully
    if (error && error.message && error.message.includes('Extension context invalidated')) {
      console.error('❌ [VØID Content] Extension context invalidated - extension may have been reloaded');
      window.postMessage({
        type: 'ANONYMAUS_SOLANA_TO_PAGE',
        payload: {
          requestId: requestId,
          error: 'Extension context invalidated. Please reload the page.'
        }
      }, '*');
    } else {
      console.error('❌ [VØID Content] Error forwarding to background:', error);
    }
  }

  // Step 5.4: Transaction details logging
  function logTransactionDetails(transaction) {
    console.log(`%c💸 [VØID Content] SOLANA TRANSACTION CAUGHT!`, 'color: #ff1493; font-weight: bold; font-size: 14px;');
    console.log(`%c📋 [VØID Content] Transaction data:`, 'color: #4caf50; font-weight: bold;', {
      hasSerialized: !!transaction?.serialized,
      serializedSize: transaction?.serialized?.length || 0,
      hasInstructions: !!transaction?.instructions,
      instructionCount: transaction?.instructions?.length || 0,
      feePayer: transaction?.feePayer || 'N/A',
      hasBlockhash: !!transaction?.recentBlockhash
    });
    
    // Log amounts if found in instructions
    if (transaction?.instructions && Array.isArray(transaction.instructions)) {
      const amounts = transaction.instructions
        .map((ix, idx) => {
          if (ix.programId === '11111111111111111111111111111111' && ix.data && ix.data.length >= 9 && ix.data[0] === 2) {
            const lamportsBuffer = Array.isArray(ix.data) ? ix.data.slice(1, 9) : new Uint8Array(ix.data).slice(1, 9);
            const lamports = lamportsBuffer.reduce((sum, byte, index) => sum + (byte * Math.pow(256, index)), 0);
            return { instruction: idx, lamports, sol: (lamports / 1e9).toFixed(6) };
          }
          return null;
        })
        .filter(Boolean);
      
      if (amounts.length > 0) {
        console.log(`%c   💰 Amounts in transaction:`, 'color: #ff1493; font-weight: bold;');
        amounts.forEach(amt => {
          console.log(`      Instruction ${amt.instruction}: ${amt.sol} SOL`, 'color: #ff1493;');
        });
      }
    }
    
    console.log(`%c✅ [VØID Content] Interception verified - data flow working!`, 'color: #4caf50; font-weight: bold;');
  }

})();
