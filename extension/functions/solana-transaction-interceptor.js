// Solana Transaction Interceptor
// Intercepts transactions from Phantom wallet
// Allows reads to work normally, but routes transactions through AnonyMaus/TEE

(function() {
  'use strict';

  // Prevent double injection
  if (window.__ANONYMAUS_SOLANA_TRANSACTION_INTERCEPTOR__) {
    console.log('%c⚠️ [AnonyMaus Solana] Interceptor already loaded, skipping', 'color: #ffa500;');
    return;
  }
  window.__ANONYMAUS_SOLANA_TRANSACTION_INTERCEPTOR__ = true;
  
  // Track if interceptor has been set up (use window to persist across function calls)
  if (!window.__ANONYMAUS_SOLANA_INTERCEPTOR_SETUP__) {
    window.__ANONYMAUS_SOLANA_INTERCEPTOR_SETUP__ = false;
  }
  let interceptorSetup = window.__ANONYMAUS_SOLANA_INTERCEPTOR_SETUP__;

  console.log('%c🛡️ [AnonyMaus Solana] Transaction Interceptor loaded', 'color: #4caf50; font-weight: bold;');

  // Store original Phantom provider
  let originalPhantom = null;
  let interceptedPhantom = null;
  
  // Store original Phantom for direct access (for signing)
  if (typeof window !== 'undefined') {
    if (!window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__) {
      window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ = null;
    }
  }
  
  // Track intercepted transactions
  const interceptedTransactions = new Set();
  const INTERCEPTION_WINDOW = 60000; // 1 minute
  const TRANSACTION_TIMEOUT = 180000; // 3 minutes (vault + intent + TEE)
  
  // Global flag for transaction handling
  if (typeof window !== 'undefined') {
    window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ = false;
  }

  // Map serialized tx (base64) -> TEE signature
  if (typeof window !== 'undefined' && !window.__ANONYMAUS_TEE_SIG_MAP__) {
    window.__ANONYMAUS_TEE_SIG_MAP__ = {};
  }
  if (typeof window !== 'undefined' && !window.__ANONYMAUS_LAST_TEE_SIG__) {
    window.__ANONYMAUS_LAST_TEE_SIG__ = null;
  }
  if (typeof window !== 'undefined' && !window.__ANONYMAUS_LAST_TEE_SIG_TS__) {
    window.__ANONYMAUS_LAST_TEE_SIG_TS__ = 0;
  }

  function bytesToBase64(bytes) {
    if (!bytes) return null;
    let uint8;
    if (bytes instanceof Uint8Array) {
      uint8 = bytes;
    } else if (bytes instanceof ArrayBuffer) {
      uint8 = new Uint8Array(bytes);
    } else if (Array.isArray(bytes)) {
      uint8 = Uint8Array.from(bytes);
    } else {
      return null;
    }
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  }

  function base58ToBytes(input) {
    if (!input || typeof input !== 'string') return null;
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const base = alphabet.length;
    const bytes = [0];
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      const value = alphabet.indexOf(char);
      if (value < 0) return null;
      let carry = value;
      for (let j = 0; j < bytes.length; j++) {
        const x = bytes[j] * base + carry;
        bytes[j] = x & 0xff;
        carry = x >> 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    // Deal with leading zeros
    for (let k = 0; k < input.length && input[k] === '1'; k++) {
      bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
  }

  function patchSendRawTransaction(ConnectionCtor) {
    if (!ConnectionCtor || ConnectionCtor.__ANONYMAUS_PATCHED__) return;
    const original = ConnectionCtor.prototype?.sendRawTransaction;
    if (typeof original !== 'function') return;
    ConnectionCtor.prototype.sendRawTransaction = async function(rawTx, opts) {
      try {
        const now = Date.now();
        const lastSig = window.__ANONYMAUS_LAST_TEE_SIG__;
        const lastSigAgeMs = now - (window.__ANONYMAUS_LAST_TEE_SIG_TS__ || 0);
        const key = bytesToBase64(rawTx);
        const sig = (key && window.__ANONYMAUS_TEE_SIG_MAP__?.[key]) ||
          (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ && lastSig && lastSigAgeMs < 60000 ? lastSig : null);
        if (sig) {
          console.log(`%c✅ [AnonyMaus Solana] Returning TEE signature for sendRawTransaction`, 'color: #4caf50; font-weight: bold;');
          return sig;
        }
      } catch (e) {
        // fall through to original
      }
      return original.apply(this, arguments);
    };
    ConnectionCtor.__ANONYMAUS_PATCHED__ = true;
  }

  function ensureSendRawPatched() {
    patchSendRawTransaction(window.web3?.Connection);
    patchSendRawTransaction(window.solanaWeb3?.Connection);
    patchSendRawTransaction(window.SolanaWeb3?.Connection);
    if (window.solana && !window.solana.isPhantom && window.solana.Connection) {
      patchSendRawTransaction(window.solana.Connection);
    }
  }

  // Attempt patch at load
  if (typeof window !== 'undefined') {
    ensureSendRawPatched();
  }

  // Patch window.fetch to short-circuit RPC sendTransaction calls
  if (typeof window !== 'undefined' && !window.__ANONYMAUS_FETCH_PATCHED__) {
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      try {
        const body = init?.body;
        if (typeof body === 'string') {
          const payload = JSON.parse(body);
          const method = payload?.method;
          if (method === 'sendTransaction' || method === 'sendRawTransaction') {
            const raw = payload?.params?.[0];
            const now = Date.now();
            const lastSig = window.__ANONYMAUS_LAST_TEE_SIG__;
            const lastSigAgeMs = now - (window.__ANONYMAUS_LAST_TEE_SIG_TS__ || 0);
            const sig = (raw && window.__ANONYMAUS_TEE_SIG_MAP__?.[raw]) ||
              (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ && lastSig && lastSigAgeMs < 60000 ? lastSig : null);
            if (sig) {
              console.log(`%c✅ [AnonyMaus Solana] Returning TEE signature for RPC ${method}`, 'color: #4caf50; font-weight: bold;');
              return new Response(JSON.stringify({
                jsonrpc: '2.0',
                id: payload?.id ?? 1,
                result: sig
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }
        }
      } catch (e) {
        // Fall through to original fetch
      }
      return originalFetch.apply(this, arguments);
    };
    window.__ANONYMAUS_FETCH_PATCHED__ = true;
  }

  // Helper to detect Phantom
  function isPhantom(provider) {
    if (!provider) return false;
    return provider.isPhantom || 
           provider._isPhantom || 
           (provider.name && provider.name.toLowerCase().includes('phantom')) ||
           (window.phantom && window.phantom.solana === provider);
  }

  // Intercept Phantom provider methods
  function interceptPhantom(phantomProvider) {
    if (!phantomProvider || interceptedPhantom === phantomProvider) {
      return phantomProvider;
    }

    console.log(`%c🔍 [AnonyMaus Solana] Intercepting Phantom wallet`, 'color: #ffa500; font-weight: bold;');

    // Store original Phantom provider for direct access (for signing)
    if (typeof window !== 'undefined' && !window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__) {
      window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ = phantomProvider;
    }

    // Store original methods
    const originalConnect = phantomProvider.connect?.bind(phantomProvider);
    const originalDisconnect = phantomProvider.disconnect?.bind(phantomProvider);
    const originalSignTransaction = phantomProvider.signTransaction?.bind(phantomProvider);
    const originalSignAndSendTransaction = phantomProvider.signAndSendTransaction?.bind(phantomProvider);
    const originalSignAllTransactions = phantomProvider.signAllTransactions?.bind(phantomProvider);
    const originalSignMessage = phantomProvider.signMessage?.bind(phantomProvider);
    const originalRequest = phantomProvider.request?.bind(phantomProvider);

    // Intercept connect() - return executor/proxy public key instead of user's real key
    if (originalConnect) {
      phantomProvider.connect = async function(options) {
        console.log(`%c🔵 [AnonyMaus Solana] connect() intercepted from Phantom`, 'color: #ff1493; font-weight: bold;');
        
        // First, get user's real public key from Phantom (internal, never exposed)
        let userRealPublicKey = null;
        try {
          const realConnection = await originalConnect.call(this, options);
          userRealPublicKey = realConnection.publicKey;
          console.log(`%c👤 [AnonyMaus Solana] User's real public key (internal): ${userRealPublicKey.toString()}`, 'color: #4caf50;');
          
          // Store user's real key internally (never expose to dApp)
          if (!window.__ANONYMAUS_SOLANA_USER_KEY__) {
            window.__ANONYMAUS_SOLANA_USER_KEY__ = userRealPublicKey.toString();
          }
        } catch (error) {
          console.error(`%c❌ [AnonyMaus Solana] Failed to get user's real key: ${error.message}`, 'color: #ff1493;');
          throw error;
        }

        // Get executor/proxy public key from extension (what dApp will see)
        return new Promise((resolve, reject) => {
          const requestId = Date.now() + Math.random();
          
          window.postMessage({
            type: 'ANONYMAUS_SOLANA_FROM_PAGE',
            payload: {
              requestId,
              method: 'connect',
              userRealPublicKey: userRealPublicKey.toString()
            }
          }, '*');

          const responseHandler = (event) => {
            if (event.source !== window) return;
            if (event.data.type === 'ANONYMAUS_SOLANA_TO_PAGE' && event.data.payload.requestId === requestId) {
              window.removeEventListener('message', responseHandler);
              const { result, error } = event.data.payload;
              if (error) {
                reject(new Error(error));
              } else {
                // Return executor/proxy public key to dApp
                resolve(result);
              }
            }
          };

          window.addEventListener('message', responseHandler);

          setTimeout(() => {
            window.removeEventListener('message', responseHandler);
            reject(new Error('AnonyMaus Solana: Connection timeout'));
          }, 30000);
        });
      };
    }

    // Intercept signTransaction() - route through AnonyMaus/TEE
    if (originalSignTransaction) {
      // Replace the method directly on the provider object (works even if property is not configurable)
      phantomProvider.signTransaction = async function(transaction) {
        // CRITICAL: Bypass interception if this call is from phantom-signer (prevents infinite loop)
        const stack = new Error().stack || '';
        const isFromPhantomSigner = stack.includes('phantom-signer') || 
                                    stack.includes('ANONYMAUS_SOLANA_SIGN_REQUEST') ||
                                    window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ === true;
        
        if (isFromPhantomSigner) {
          console.log(`%c✅ [AnonyMaus Solana] Bypassing interception - call from phantom-signer`, 'color: #4caf50; font-weight: bold;');
          // Call original Phantom method directly (no interception)
          return originalSignTransaction.call(this, transaction);
        }
        
        // Check if already handling a transaction (prevent duplicate popups)
        if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ === true) {
          console.log(`%c⚠️ [AnonyMaus Solana] Transaction already being handled, bypassing interception`, 'color: #ffa500; font-weight: bold;');
          return originalSignTransaction.call(this, transaction);
        }
        
        console.log(`%c💸 [AnonyMaus Solana] signTransaction() INTERCEPTED from Phantom!`, 'color: #ff1493; font-weight: bold; font-size: 16px;');
        console.log(`%c🚫 [AnonyMaus Solana] BLOCKING Phantom - routing through TEE instead`, 'color: #ff1493; font-weight: bold;');
        console.log(`%c✅ [AnonyMaus Solana] Interception is ACTIVE - transaction will be routed through AnonyMaus`, 'color: #4caf50; font-weight: bold;');
        
        // Validate transaction
        if (!transaction) {
          console.error(`%c❌ [AnonyMaus Solana] ERROR: Transaction is undefined!`, 'color: #ff1493; font-weight: bold;');
          throw new Error('Transaction is undefined');
        }
        
        console.log(`📋 [AnonyMaus Solana] Transaction object:`, transaction);
        console.log(`   - Has serialize method: ${typeof transaction.serialize === 'function'}`);
        console.log(`   - Has message: ${!!transaction.message}`);
        console.log(`   - Message type: ${transaction.message?.constructor?.name || 'unknown'}`);
        console.log(`   - Message keys: ${transaction.message ? Object.keys(transaction.message).join(', ') : 'none'}`);
        console.log(`   - Has instructions (direct): ${!!transaction.instructions}`);
        console.log(`   - Has instructions (message): ${!!transaction.message?.instructions}`);
        console.log(`   - Has compiledInstructions (message): ${!!transaction.message?.compiledInstructions}`);
        console.log(`   - Instructions count (direct): ${transaction.instructions?.length || 0}`);
        console.log(`   - Instructions count (message): ${transaction.message?.instructions?.length || 0}`);
        console.log(`   - CompiledInstructions count (message): ${transaction.message?.compiledInstructions?.length || 0}`);
        
        // Try to inspect message structure more deeply
        if (transaction.message) {
          // Check if message has a method to get instructions
          if (typeof transaction.message.instructions === 'function') {
            console.log(`   - message.instructions is a function, trying to call it...`);
            try {
              const msgInstructions = transaction.message.instructions();
              console.log(`   - message.instructions() returned:`, msgInstructions);
            } catch (e) {
              console.error(`   - Error calling message.instructions():`, e);
            }
          }
        }
        
        // Set flag immediately to prevent duplicate handling
        if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ !== undefined) {
          window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ = true;
        }

        // Route through AnonyMaus/TEE
        return new Promise((resolve, reject) => {
          const requestId = Date.now() + Math.random();
          let transactionData = null;
          
          try {
            // Serialize transaction for transmission
            let serialized = null;
            try {
              if (transaction.serialize && typeof transaction.serialize === 'function') {
                const serializedBytes = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
                // Convert Uint8Array to base64 for JSON transmission
                if (serializedBytes) {
                  serialized = btoa(String.fromCharCode(...serializedBytes));
                  console.log(`✅ [AnonyMaus Solana] Transaction serialized: ${serializedBytes.length} bytes (base64: ${serialized.length} chars)`);
                }
              } else {
                console.warn(`⚠️ [AnonyMaus Solana] Transaction has no serialize method`);
              }
            } catch (e) {
              console.error(`❌ [AnonyMaus Solana] Error serializing transaction:`, e);
            }
            
            let instructions = null;
            try {
              // Try multiple ways to get instructions:
              // 1. transaction.message.instructions (property)
              // 2. transaction.message.instructions() (method)
              // 3. transaction.message.compiledInstructions
              // 4. transaction.instructions (direct)
              
              let instructionsArray = null;
              
              // Try as property first
              if (transaction.message?.instructions && Array.isArray(transaction.message.instructions)) {
                instructionsArray = transaction.message.instructions;
                console.log(`✅ [AnonyMaus Solana] Found instructions in message.instructions (property)`);
              }
              // Try as method
              else if (transaction.message && typeof transaction.message.instructions === 'function') {
                try {
                  instructionsArray = transaction.message.instructions();
                  console.log(`✅ [AnonyMaus Solana] Found instructions via message.instructions() (method)`);
                } catch (e) {
                  console.warn(`⚠️ [AnonyMaus Solana] Error calling message.instructions():`, e);
                }
              }
              // Try compiledInstructions
              else if (transaction.message?.compiledInstructions && Array.isArray(transaction.message.compiledInstructions)) {
                // compiledInstructions need to be decoded - for now, we'll try to use them
                instructionsArray = transaction.message.compiledInstructions;
                console.log(`✅ [AnonyMaus Solana] Found compiledInstructions in message`);
              }
              // Fall back to direct instructions
              else if (transaction.instructions && Array.isArray(transaction.instructions)) {
                instructionsArray = transaction.instructions;
                console.log(`✅ [AnonyMaus Solana] Found instructions in transaction.instructions (direct)`);
              }
              
              if (instructionsArray && Array.isArray(instructionsArray) && instructionsArray.length > 0) {
                instructions = instructionsArray.map(ix => {
                  try {
                    return {
                      programId: ix.programId?.toString() || (typeof ix.programId === 'string' ? ix.programId : null),
                      keys: ix.keys?.map(k => ({
                        pubkey: k.pubkey?.toString() || (typeof k.pubkey === 'string' ? k.pubkey : null),
                        isSigner: k.isSigner || false,
                        isWritable: k.isWritable || false
                      })) || [],
                      data: ix.data ? (Array.isArray(ix.data) ? ix.data : Array.from(ix.data)) : null
                    };
                  } catch (e) {
                    console.error(`❌ [AnonyMaus Solana] Error mapping instruction:`, e, ix);
                    return null;
                  }
                }).filter(ix => ix !== null);
                console.log(`✅ [AnonyMaus Solana] Instructions extracted: ${instructions.length}`);
              } else {
                console.warn(`⚠️ [AnonyMaus Solana] Transaction has no instructions array (checked all locations)`);
                // If we have serialized data, we can still send it - the backend can deserialize it
                console.log(`   💡 Will send serialized transaction - backend can deserialize to get instructions`);
              }
            } catch (e) {
              console.error(`❌ [AnonyMaus Solana] Error extracting instructions:`, e);
            }
            
            // Get user's real public key (from stored value or Phantom)
            let userRealPublicKeyValue = null;
            try {
              // Try to get from stored value first
              if (window.__ANONYMAUS_SOLANA_USER_KEY__) {
                userRealPublicKeyValue = window.__ANONYMAUS_SOLANA_USER_KEY__;
              } else {
                // Try to get from Phantom provider
                if (phantomProvider && phantomProvider.publicKey) {
                  userRealPublicKeyValue = phantomProvider.publicKey.toString();
                } else if (window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ && window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__.publicKey) {
                  userRealPublicKeyValue = window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__.publicKey.toString();
                }
              }
            } catch (e) {
              console.warn(`⚠️ [AnonyMaus Solana] Could not get user public key: ${e.message}`);
            }

            transactionData = {
              serialized: serialized,
              instructions: instructions,
              feePayer: transaction.feePayer?.toString() || userRealPublicKeyValue || null,
              recentBlockhash: transaction.recentBlockhash || null,
              userRealPublicKey: userRealPublicKeyValue || null
            };

            // Best-effort: extract Raydium poolId from instruction accounts
            if (instructions && instructions.length > 0) {
              const raydiumProgramIds = [
                '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
                'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
                'RVKd61ztZW9GUwhRbbLoYVRE5Xf9B2t3sc6qwfqE3zH',
                'CPMMoo8L3F4NbTegBCKVNunggL1tnt2ec5zM1YkqFhL2',
                'DRaybByLpbUL57LJARs3j8BitTxVfzBg351EaMr5UTCd', // Raydium Router
                'DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb', // Raydium Pool Program
              ];
              const raydiumIx = instructions.find(ix => {
                const programId = ix.programId?.toString() || ix.programId || '';
                return raydiumProgramIds.some(id => programId.includes(id) || id.includes(programId));
              });
              if (raydiumIx && Array.isArray(raydiumIx.keys) && raydiumIx.keys.length > 0) {
                transactionData.swapParams = transactionData.swapParams || {};
                
                // For Raydium swaps, pool is usually at position 6-15, not position 0
                // Try multiple positions
                const positionsToTry = [6, 7, 8, 9, 10, 13, 14, 15, 0, 1, 2];
                let extractedPoolId = null;
                
                for (const pos of positionsToTry) {
                  if (pos < raydiumIx.keys.length) {
                    const key = raydiumIx.keys[pos];
                    const pubkey = key?.pubkey || key;
                    if (pubkey) {
                      extractedPoolId = pubkey;
                      console.log(`%c🔍 [AnonyMaus] Trying poolId at position ${pos}: ${extractedPoolId}`, 'color: #2196F3;');
                      break; // Use first valid one
                    }
                  }
                }
                
                // Fallback to first account if nothing found
                if (!extractedPoolId && raydiumIx.keys[0]) {
                  extractedPoolId = raydiumIx.keys[0]?.pubkey || raydiumIx.keys[0];
                }
                
                transactionData.swapParams.poolId = extractedPoolId;
                if (extractedPoolId) {
                  console.log(`%c✅ [AnonyMaus] Extracted Raydium poolId from transaction: ${extractedPoolId}`, 'color: #4caf50; font-weight: bold;');
                }
              }
            }
            
            // Extract and log amounts from intercepted transaction
            let extractedAmounts = [];
            let totalExtractedLamports = 0n; // Use BigInt to handle large u64 values
            const seenRaydiumAmounts = new Set();
            
            // Helper function to parse u64 from buffer using BigInt (prevents Number overflow)
            const parseU64BigInt = (buffer) => {
              let value = 0n;
              for (let i = 0; i < buffer.length && i < 8; i++) {
                value += BigInt(buffer[i]) * (256n ** BigInt(i));
              }
              return value;
            };
            
            if (instructions && Array.isArray(instructions)) {
              instructions.forEach((ix, idx) => {
                // Check for System Program transfers (direct SOL transfers)
                if (ix.programId === '11111111111111111111111111111111' && ix.data && ix.data.length >= 9 && ix.data[0] === 2) {
                  const lamportsBuffer = ix.data.slice(1, 9);
                  const lamportsBigInt = parseU64BigInt(lamportsBuffer);
                  // Convert to Number, capping at MAX_SAFE_INTEGER
                  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
                  const lamports = lamportsBigInt > MAX_SAFE ? Number.MAX_SAFE_INTEGER : Number(lamportsBigInt);
                  if (lamports > 0) {
                    extractedAmounts.push({
                      instruction: idx,
                      lamports: lamports,
                      sol: (lamports / 1e9).toFixed(6),
                      type: 'SOL_TRANSFER'
                    });
                    totalExtractedLamports += lamportsBigInt;
                  }
                }
                
                // Check for Raydium swap instructions - try to extract amount from swap data
                const raydiumProgramIds = [
                  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
                  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
                  'RVKd61ztZW9GUwhRbbLoYVRE5Xf9B2t3sc6qwfqE3zH', // Raydium CLMM (devnet)
                  'CPMMoo8L3F4NbTegBCKVNunggL1tnt2ec5zM1YkqFhL2', // Raydium CPMM
                ];
                
                const programId = ix.programId?.toString() || ix.programId || '';
                const isRaydiumSwap = raydiumProgramIds.some(id => programId.includes(id) || id.includes(programId));
                
                if (isRaydiumSwap && ix.data && ix.data.length > 0) {
                  // Raydium swap instructions contain amount in the instruction data
                  // The structure varies by swap type, but typically amount is in the first few bytes after discriminator
                  // For now, we'll try to extract from common positions
                  // Note: This is a simplified extraction - full parsing would require Raydium instruction schema
                  try {
                    // Try to read amount from different positions (Raydium swaps vary)
                    // Position 1-9: u64 amount (little-endian) - common in many swap instructions
                    if (ix.data.length >= 9) {
                      const amountBuffer = ix.data.slice(1, 9);
                      // Use BigInt to parse u64 safely (prevents Number overflow)
                      let amount = 0n;
                      for (let i = 0; i < amountBuffer.length && i < 8; i++) {
                        amount += BigInt(amountBuffer[i]) * (256n ** BigInt(i));
                      }
                      
                      // Convert to Number for comparison and storage (cap at MAX_SAFE_INTEGER)
                      const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
                      const amountNum = amount > MAX_SAFE ? Number.MAX_SAFE_INTEGER : Number(amount);
                      
                      // Only consider if it's a reasonable amount (not too small, not too large)
                      if (amountNum > 1000 && amountNum < 1e15) { // Between 0.000001 and 1M SOL
                        const dedupeKey = `${programId}:${amountNum}`;
                        if (!seenRaydiumAmounts.has(dedupeKey)) {
                          seenRaydiumAmounts.add(dedupeKey);
                          extractedAmounts.push({
                            instruction: idx,
                            lamports: amountNum,
                            sol: (amountNum / 1e9).toFixed(6),
                            type: 'RAYDIUM_SWAP',
                            programId: programId
                          });
                          totalExtractedLamports += amountNum;
                        }
                      }
                    }
                  } catch (e) {
                    // Ignore extraction errors
                    console.warn(`⚠️ [AnonyMaus Solana] Error extracting Raydium amount:`, e);
                  }
                }
              });
            }
            
            // Store extracted amount in transaction data for background to use
            // Convert BigInt to Number, capping at MAX_SAFE_INTEGER to prevent overflow
            const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
            const totalLamportsNum = totalExtractedLamports > MAX_SAFE 
              ? Number.MAX_SAFE_INTEGER 
              : Number(totalExtractedLamports);
            transactionData.extractedAmountLamports = totalLamportsNum;
            transactionData.extractedAmounts = extractedAmounts;
            
            console.log(`%c📦 [AnonyMaus Solana] 📋 RAYDIUM TRANSACTION INTERCEPTED:`, 'color: #ff1493; font-weight: bold; font-size: 14px;');
            console.log(`%c   🎯 Transaction built by Raydium:`, 'color: #ff1493; font-weight: bold;');
            console.log(`   Request ID: ${requestId}`, 'color: #4caf50;');
            console.log(`   Serialized size: ${serialized?.length || 0} bytes`, 'color: #4caf50;');
            console.log(`   Instructions count: ${instructions?.length || 0}`, 'color: #4caf50;');
            if (extractedAmounts.length > 0) {
              console.log(`%c   💰 Amounts found in transaction:`, 'color: #ff1493; font-weight: bold;');
              extractedAmounts.forEach((amt, idx) => {
                console.log(`      Instruction ${amt.instruction} (${amt.type}): ${amt.sol} SOL (${amt.lamports} lamports)`, 'color: #ff1493;');
              });
              const totalLamportsNum = totalExtractedLamports > BigInt(Number.MAX_SAFE_INTEGER) 
                ? Number.MAX_SAFE_INTEGER 
                : Number(totalExtractedLamports);
              console.log(`%c   💰 Total extracted: ${(totalLamportsNum / 1e9).toFixed(6)} SOL (${totalLamportsNum} lamports)`, 'color: #4caf50; font-weight: bold;');
            } else {
              console.log(`%c   💰 No amounts found - will use minimum deposit amount`, 'color: #ffa500;');
            }
            console.log(`   Fee payer: ${transactionData.feePayer || 'N/A'}`, 'color: #4caf50;');
            console.log(`   Blockhash: ${transactionData.recentBlockhash?.substring(0, 20) || 'N/A'}...`, 'color: #4caf50;');
            console.log(`%c✅ [AnonyMaus Solana] Transaction data prepared for background`, 'color: #4caf50; font-weight: bold;');
            
            window.postMessage({
              type: 'ANONYMAUS_SOLANA_FROM_PAGE',
              payload: {
                requestId,
                method: 'signTransaction',
                transaction: transactionData,
                userRealPublicKey: userRealPublicKeyValue
              }
            }, '*');
          } catch (error) {
            console.error(`❌ [AnonyMaus Solana] Error preparing transaction data:`, error);
            reject(error);
            return;
          }

          const clearHandlingFlag = () => {
            if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ !== undefined) {
              window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ = false;
            }
          };

          const responseHandler = (event) => {
            if (event.source !== window) return;
            if (event.data.type === 'ANONYMAUS_SOLANA_TO_PAGE' && event.data.payload.requestId === requestId) {
              window.removeEventListener('message', responseHandler);
              clearHandlingFlag();
              const { result, error } = event.data.payload;
              if (error) {
                reject(new Error(error));
              } else {
                const responseSignature = result?.signature ||
                  result?.txid ||
                  result?.transactionSignature ||
                  (typeof result?.explorerUrl === 'string'
                    ? result.explorerUrl.split('/tx/')[1]?.split('?')[0]
                    : null);
                if (responseSignature && transactionData?.serialized) {
                  window.__ANONYMAUS_TEE_SIG_MAP__[transactionData.serialized] = responseSignature;
                  window.__ANONYMAUS_LAST_TEE_SIG__ = responseSignature;
                  window.__ANONYMAUS_LAST_TEE_SIG_TS__ = Date.now();
                  ensureSendRawPatched();
                }
                if (responseSignature && transaction) {
                  const sigBytes = base58ToBytes(responseSignature);
                  try {
                    const signer = transaction.feePayer || transaction.signatures?.[0]?.publicKey;
                    if (sigBytes) {
                      if (signer && typeof transaction.addSignature === 'function') {
                        transaction.addSignature(signer, sigBytes);
                      } else if (Array.isArray(transaction.signatures) && transaction.signatures.length) {
                        const firstSig = transaction.signatures[0];
                        if (firstSig && (firstSig instanceof Uint8Array || ArrayBuffer.isView(firstSig))) {
                          transaction.signatures[0] = sigBytes;
                        } else if (firstSig && typeof firstSig === 'object') {
                          transaction.signatures[0].signature = sigBytes;
                        } else {
                          transaction.signature = sigBytes;
                        }
                      } else {
                        transaction.signature = sigBytes;
                      }
                    }
                    // Also store base58 signature string for UI consumers when missing
                    if (!transaction.signature) {
                      transaction.signature = responseSignature;
                    }
                  } catch (e) {
                    // best-effort only
                  }
                }
                // Return the original transaction with server signature
                // Raydium expects a Transaction object with serialize() method
                // Since transaction is already executed on server, return original transaction
                // with signature property set
                if (result && typeof result.serialize === 'function') {
                  resolve(result);
                } else if (responseSignature && transaction) {
                  // Add signature to original transaction (fallback)
                  if (!transaction.signature) {
                    transaction.signature = responseSignature;
                  }
                  resolve(transaction);
                } else {
                  resolve(result);
                }
              }
            }
          };

          window.addEventListener('message', responseHandler);

          const timeoutId = setTimeout(() => {
            window.removeEventListener('message', responseHandler);
            clearHandlingFlag();
            reject(new Error('AnonyMaus Solana: Transaction timeout'));
          }, TRANSACTION_TIMEOUT);
          
          // Store original resolve/reject to clear timeout
          const originalResolve = resolve;
          const originalReject = reject;
          resolve = (value) => {
            clearTimeout(timeoutId);
            clearHandlingFlag();
            originalResolve(value);
          };
          reject = (error) => {
            clearTimeout(timeoutId);
            clearHandlingFlag();
            originalReject(error);
          };
        });
      };
    }

    // Intercept signAndSendTransaction() - route through AnonyMaus/TEE
    if (originalSignAndSendTransaction) {
      phantomProvider.signAndSendTransaction = async function(transaction) {
        // CRITICAL: Bypass interception if this call is from phantom-signer (prevents infinite loop)
        const stack = new Error().stack || '';
        const isFromPhantomSigner = stack.includes('phantom-signer') || 
                                    stack.includes('ANONYMAUS_SOLANA_SIGN_REQUEST') ||
                                    window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ === true;
        
        if (isFromPhantomSigner) {
          console.log(`%c✅ [AnonyMaus Solana] Bypassing interception - call from phantom-signer`, 'color: #4caf50; font-weight: bold;');
          // Call original Phantom method directly (no interception)
          return originalSignAndSendTransaction.call(this, transaction);
        }
        
        // Check if already handling a transaction (prevent duplicate popups)
        if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ === true) {
          console.log(`%c⚠️ [AnonyMaus Solana] Transaction already being handled, bypassing interception`, 'color: #ffa500; font-weight: bold;');
          return originalSignAndSendTransaction.call(this, transaction);
        }
        
        console.log(`%c💸 [AnonyMaus Solana] signAndSendTransaction() INTERCEPTED from Phantom!`, 'color: #ff1493; font-weight: bold; font-size: 16px;');
        console.log(`%c🚫 [AnonyMaus Solana] BLOCKING Phantom - routing through TEE instead`, 'color: #ff1493; font-weight: bold;');
        
        // Validate transaction
        if (!transaction) {
          console.error(`%c❌ [AnonyMaus Solana] ERROR: Transaction is undefined!`, 'color: #ff1493; font-weight: bold;');
          throw new Error('Transaction is undefined');
        }
        
        console.log(`📋 [AnonyMaus Solana] Transaction object:`, transaction);
        console.log(`   - Has serialize method: ${typeof transaction.serialize === 'function'}`);
        console.log(`   - Has message: ${!!transaction.message}`);
        console.log(`   - Has instructions (direct): ${!!transaction.instructions}`);
        console.log(`   - Has instructions (message): ${!!transaction.message?.instructions}`);
        console.log(`   - Instructions count (direct): ${transaction.instructions?.length || 0}`);
        console.log(`   - Instructions count (message): ${transaction.message?.instructions?.length || 0}`);
        
        // Set flag immediately to prevent duplicate handling
        if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ !== undefined) {
          window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ = true;
        }

        // Route through AnonyMaus/TEE
        return new Promise((resolve, reject) => {
          const requestId = Date.now() + Math.random();
          
          try {
            // Serialize transaction for transmission
            let serialized = null;
            try {
              if (transaction.serialize && typeof transaction.serialize === 'function') {
                const serializedBytes = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
                // Convert Uint8Array to base64 for JSON transmission
                if (serializedBytes) {
                  serialized = btoa(String.fromCharCode(...serializedBytes));
                  console.log(`✅ [AnonyMaus Solana] Transaction serialized: ${serializedBytes.length} bytes (base64: ${serialized.length} chars)`);
                }
              } else {
                console.warn(`⚠️ [AnonyMaus Solana] Transaction has no serialize method`);
              }
            } catch (e) {
              console.error(`❌ [AnonyMaus Solana] Error serializing transaction:`, e);
            }
            
            let instructions = null;
            try {
              // Try to get instructions from transaction.message.instructions first (Phantom format)
              // Then fall back to transaction.instructions (direct format)
              const instructionsArray = transaction.message?.instructions || transaction.instructions;
              
              if (instructionsArray && Array.isArray(instructionsArray)) {
                instructions = instructionsArray.map(ix => {
                  try {
                    return {
                      programId: ix.programId?.toString() || (typeof ix.programId === 'string' ? ix.programId : null),
                      keys: ix.keys?.map(k => ({
                        pubkey: k.pubkey?.toString() || (typeof k.pubkey === 'string' ? k.pubkey : null),
                        isSigner: k.isSigner || false,
                        isWritable: k.isWritable || false
                      })) || [],
                      data: ix.data ? (Array.isArray(ix.data) ? ix.data : Array.from(ix.data)) : null
                    };
                  } catch (e) {
                    console.error(`❌ [AnonyMaus Solana] Error mapping instruction:`, e, ix);
                    return null;
                  }
                }).filter(ix => ix !== null);
                console.log(`✅ [AnonyMaus Solana] Instructions extracted: ${instructions.length}`);
              } else {
                console.warn(`⚠️ [AnonyMaus Solana] Transaction has no instructions array (checked message.instructions and instructions)`);
              }
            } catch (e) {
              console.error(`❌ [AnonyMaus Solana] Error extracting instructions:`, e);
            }
            
            // Get user's real public key (from stored value or Phantom)
            let userRealPublicKeyValue = null;
            try {
              if (window.__ANONYMAUS_SOLANA_USER_KEY__) {
                userRealPublicKeyValue = window.__ANONYMAUS_SOLANA_USER_KEY__;
              } else if (phantomProvider && phantomProvider.publicKey) {
                userRealPublicKeyValue = phantomProvider.publicKey.toString();
              } else if (window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ && window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__.publicKey) {
                userRealPublicKeyValue = window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__.publicKey.toString();
              }
            } catch (e) {
              console.warn(`⚠️ [AnonyMaus Solana] Could not get user public key: ${e.message}`);
            }

            const transactionData = {
              serialized: serialized,
              instructions: instructions,
              feePayer: transaction.feePayer?.toString() || userRealPublicKeyValue || null,
              recentBlockhash: transaction.recentBlockhash || null,
              userRealPublicKey: userRealPublicKeyValue || null
            };
            
            console.log(`📦 [AnonyMaus Solana] Sending transaction data:`, {
              hasSerialized: !!transactionData.serialized,
              hasInstructions: !!transactionData.instructions,
              instructionCount: transactionData.instructions?.length || 0
            });
            
            window.postMessage({
              type: 'ANONYMAUS_SOLANA_FROM_PAGE',
              payload: {
                requestId,
                method: 'signAndSendTransaction',
                transaction: transactionData
              }
            }, '*');
          } catch (error) {
            console.error(`❌ [AnonyMaus Solana] Error preparing transaction data:`, error);
            // Clear handling flag on error
            if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ !== undefined) {
              window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ = false;
            }
            reject(error);
            return;
          }

          const clearHandlingFlag = () => {
            if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ !== undefined) {
              window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ = false;
            }
          };

          const responseHandler = (event) => {
            if (event.source !== window) return;
            if (event.data.type === 'ANONYMAUS_SOLANA_TO_PAGE' && event.data.payload.requestId === requestId) {
              window.removeEventListener('message', responseHandler);
              clearHandlingFlag();
              const { result, error } = event.data.payload;
              if (error) {
                reject(new Error(error));
              } else {
                const responseSignature = result?.signature ||
                  result?.txid ||
                  result?.transactionSignature ||
                  (typeof result?.explorerUrl === 'string'
                    ? result.explorerUrl.split('/tx/')[1]?.split('?')[0]
                    : null);
                if (responseSignature && transactionData?.serialized) {
                  window.__ANONYMAUS_TEE_SIG_MAP__[transactionData.serialized] = responseSignature;
                  window.__ANONYMAUS_LAST_TEE_SIG__ = responseSignature;
                  window.__ANONYMAUS_LAST_TEE_SIG_TS__ = Date.now();
                  ensureSendRawPatched();
                }
                resolve(responseSignature || result);
              }
            }
          };

          window.addEventListener('message', responseHandler);

          const timeoutId = setTimeout(() => {
            window.removeEventListener('message', responseHandler);
            clearHandlingFlag();
            reject(new Error('AnonyMaus Solana: Transaction timeout'));
          }, TRANSACTION_TIMEOUT);
          
          // Store original resolve/reject to clear timeout and flag
          const originalResolve = resolve;
          const originalReject = reject;
          resolve = (value) => {
            clearTimeout(timeoutId);
            clearHandlingFlag();
            originalResolve(value);
          };
          reject = (error) => {
            clearTimeout(timeoutId);
            clearHandlingFlag();
            originalReject(error);
          };
        });
      };
    }

    // Intercept signAllTransactions() - route through AnonyMaus/TEE
    if (originalSignAllTransactions) {
      phantomProvider.signAllTransactions = async function(transactions) {
        // CRITICAL: Bypass interception if this call is from phantom-signer (prevents infinite loop)
        const stack = new Error().stack || '';
        const isFromPhantomSigner = stack.includes('phantom-signer') || 
                                    stack.includes('ANONYMAUS_SOLANA_SIGN_REQUEST') ||
                                    window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ === true;
        
        if (isFromPhantomSigner) {
          console.log(`%c✅ [AnonyMaus Solana] Bypassing interception - call from phantom-signer`, 'color: #4caf50; font-weight: bold;');
          // Call original Phantom method directly (no interception)
          return originalSignAllTransactions.call(this, transactions);
        }
        
        // Check if already handling a transaction (prevent duplicate popups)
        if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ === true) {
          console.log(`%c⚠️ [AnonyMaus Solana] Transaction already being handled, bypassing interception`, 'color: #ffa500; font-weight: bold;');
          return originalSignAllTransactions.call(this, transactions);
        }
        
        console.log(`%c💸 [AnonyMaus Solana] signAllTransactions() INTERCEPTED from Phantom!`, 'color: #ff1493; font-weight: bold;');
        
        // Set flag immediately to prevent duplicate handling
        if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ !== undefined) {
          window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ = true;
        }

        // Route through AnonyMaus/TEE
        return new Promise((resolve, reject) => {
          const requestId = Date.now() + Math.random();
          
          const transactionsData = transactions.map(tx => {
            // Try to get instructions from tx.message.instructions first (Phantom format)
            // Then fall back to tx.instructions (direct format)
            const instructionsArray = tx.message?.instructions || tx.instructions;
            
            let instructions = null;
            if (instructionsArray && Array.isArray(instructionsArray)) {
              instructions = instructionsArray.map(ix => {
                try {
                  return {
                    programId: ix.programId?.toString() || (typeof ix.programId === 'string' ? ix.programId : null),
                    keys: ix.keys?.map(k => ({
                      pubkey: k.pubkey?.toString() || (typeof k.pubkey === 'string' ? k.pubkey : null),
                      isSigner: k.isSigner || false,
                      isWritable: k.isWritable || false
                    })) || [],
                    data: ix.data ? (Array.isArray(ix.data) ? ix.data : Array.from(ix.data)) : null
                  };
                } catch (e) {
                  console.error(`❌ [AnonyMaus Solana] Error mapping instruction:`, e, ix);
                  return null;
                }
              }).filter(ix => ix !== null);
            }
            
            let serialized = null;
            if (tx.serialize && typeof tx.serialize === 'function') {
              const serializedBytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
              if (serializedBytes) {
                serialized = btoa(String.fromCharCode(...serializedBytes));
              }
            }
            return {
              serialized: serialized,
              instructions: instructions
            };
          });
          
          window.postMessage({
            type: 'ANONYMAUS_SOLANA_FROM_PAGE',
            payload: {
              requestId,
              method: 'signAllTransactions',
              transactions: transactionsData
            }
          }, '*');

          const clearHandlingFlag = () => {
            if (window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ !== undefined) {
              window.__ANONYMAUS_SOLANA_HANDLING_TRANSACTION__ = false;
            }
          };

          const responseHandler = (event) => {
            if (event.source !== window) return;
            if (event.data.type === 'ANONYMAUS_SOLANA_TO_PAGE' && event.data.payload.requestId === requestId) {
              window.removeEventListener('message', responseHandler);
              clearHandlingFlag();
              const { result, error } = event.data.payload;
              if (error) {
                reject(new Error(error));
              } else {
                resolve(result);
              }
            }
          };

          window.addEventListener('message', responseHandler);

          const timeoutId = setTimeout(() => {
            window.removeEventListener('message', responseHandler);
            clearHandlingFlag();
            reject(new Error('AnonyMaus Solana: Transaction timeout'));
          }, TRANSACTION_TIMEOUT);
          
          // Store original resolve/reject to clear timeout and flag
          const originalResolve = resolve;
          const originalReject = reject;
          resolve = (value) => {
            clearTimeout(timeoutId);
            clearHandlingFlag();
            originalResolve(value);
          };
          reject = (error) => {
            clearTimeout(timeoutId);
            clearHandlingFlag();
            originalReject(error);
          };
        });
      };
    }

    // For other methods (disconnect, signMessage, etc.), delegate to original
    if (originalDisconnect) {
      phantomProvider.disconnect = originalDisconnect;
    }
    
    if (originalSignMessage) {
      phantomProvider.signMessage = originalSignMessage;
    }

    interceptedPhantom = phantomProvider;
    return phantomProvider;
  }

  // Function to intercept window.solana and window.phantom.solana
  function setupSolanaInterceptor() {
    // Prevent multiple setups - check flag FIRST (check window flag too)
    if (interceptorSetup || window.__ANONYMAUS_SOLANA_INTERCEPTOR_SETUP__) {
      console.log(`%c✅ [AnonyMaus Solana] Interceptor already set up, skipping`, 'color: #4caf50;');
      return;
    }
    
    // Intercept window.phantom.solana (Phantom's preferred location)
    // Since it might be non-configurable, intercept at method level instead
    if (window.phantom && window.phantom.solana && isPhantom(window.phantom.solana)) {
      originalPhantom = window.phantom.solana;
      // Store original before intercepting
      if (typeof window !== 'undefined' && !window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__) {
        window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ = window.phantom.solana;
      }
      
      // Try to intercept at property level first
      const phantomDescriptor = Object.getOwnPropertyDescriptor(window.phantom, 'solana');
      if (phantomDescriptor && !phantomDescriptor.configurable) {
        // Property is not configurable - intercept at method level instead
        console.log(`%c⚠️ [AnonyMaus Solana] window.phantom.solana is not configurable, intercepting methods directly`, 'color: #ffa500;');
        // This modifies the provider object in place - methods will be intercepted
        interceptPhantom(window.phantom.solana);
        console.log(`%c✅ [AnonyMaus Solana] Methods intercepted on window.phantom.solana (non-configurable)`, 'color: #4caf50; font-weight: bold;');
        console.log(`   💡 Methods are intercepted directly on the provider object`, 'color: #4caf50;');
        // Don't try to redefine the property
      } else {
        // Try to intercept at property level
        try {
          Object.defineProperty(window.phantom, 'solana', {
            value: interceptPhantom(window.phantom.solana),
            writable: true,
            configurable: true,
            enumerable: true
          });
          console.log(`%c✅ [AnonyMaus Solana] Intercepted window.phantom.solana`, 'color: #4caf50; font-weight: bold;');
        } catch (e) {
          // Fallback: intercept methods directly on the provider
          console.log(`%c⚠️ [AnonyMaus Solana] Could not intercept window.phantom.solana property, intercepting methods directly: ${e.message}`, 'color: #ffa500;');
          interceptPhantom(window.phantom.solana);
        }
      }
    }

    // Watch for Phantom being set (use getter/setter to catch future assignments)
    // Check if window.solana is already defined as a property with getter/setter
    const existingDescriptor = Object.getOwnPropertyDescriptor(window, 'solana');
    
    // If already intercepted by us (has getter/setter), skip
    if (existingDescriptor && (existingDescriptor.get || existingDescriptor.set)) {
      console.log(`%c✅ [AnonyMaus Solana] window.solana already intercepted (has getter/setter)`, 'color: #4caf50;');
      interceptorSetup = true;
      return;
    }
    
    // Store current value first (needed for checks below)
    let currentSolana = window.solana;
    
    // If not configurable, intercept at method level instead
    if (existingDescriptor && !existingDescriptor.configurable) {
      console.warn(`%c⚠️ [AnonyMaus Solana] window.solana is not configurable, intercepting methods directly`, 'color: #ffa500;');
      // Intercept methods directly on the provider (modifies provider object in place)
      if (currentSolana && isPhantom(currentSolana) && !currentSolana.isAnonyMaus) {
        originalPhantom = currentSolana;
        if (typeof window !== 'undefined' && !window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__) {
          window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ = currentSolana;
        }
        // This modifies the provider object in place - methods will be intercepted
        interceptPhantom(currentSolana);
        console.log(`%c✅ [AnonyMaus Solana] Intercepted methods on window.solana (non-configurable property)`, 'color: #4caf50; font-weight: bold;');
        console.log(`   💡 Methods are intercepted directly on the provider object`, 'color: #4caf50;');
      }
      interceptorSetup = true;
      window.__ANONYMAUS_SOLANA_INTERCEPTOR_SETUP__ = true;
      return;
    }
    
    // If already defined as a value property by us (check for our marker), skip
    if (existingDescriptor && existingDescriptor.value && existingDescriptor.value.isAnonyMaus) {
      console.log(`%c✅ [AnonyMaus Solana] window.solana already intercepted (AnonyMaus value)`, 'color: #4caf50;');
      interceptorSetup = true;
      window.__ANONYMAUS_SOLANA_INTERCEPTOR_SETUP__ = true;
      return;
    }
    
    // If Phantom is already there, intercept it now
    if (currentSolana && isPhantom(currentSolana) && !currentSolana.isAnonyMaus) {
      originalPhantom = currentSolana;
      if (typeof window !== 'undefined' && !window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__) {
        window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ = currentSolana;
      }
      currentSolana = interceptPhantom(currentSolana);
      console.log(`%c✅ [AnonyMaus Solana] Intercepted existing Phantom at window.solana`, 'color: #4caf50; font-weight: bold;');
    } else if (currentSolana && currentSolana.isAnonyMaus) {
      // AnonyMaus is already at window.solana - don't intercept it
      console.log(`%c✅ [AnonyMaus Solana] AnonyMaus detected at window.solana - not intercepting`, 'color: #4caf50; font-weight: bold;');
      interceptorSetup = true;
      return;
    }
    
    // Set up getter/setter to catch future assignments
    // Final check right before defineProperty to prevent race conditions
    const finalCheck = Object.getOwnPropertyDescriptor(window, 'solana');
    if (finalCheck && (finalCheck.get || finalCheck.set)) {
      console.log(`%c✅ [AnonyMaus Solana] window.solana already has getter/setter, skipping`, 'color: #4caf50;');
      interceptorSetup = true;
      return;
    }
    
    try {
      Object.defineProperty(window, 'solana', {
        get: function() {
          return currentSolana;
        },
        set: function(value) {
          // Only intercept Phantom, not AnonyMaus
          if (value && isPhantom(value) && !value.isAnonyMaus) {
            originalPhantom = value;
            if (typeof window !== 'undefined' && !window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__) {
              window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ = value;
            }
            currentSolana = interceptPhantom(value);
            console.log(`%c✅ [AnonyMaus Solana] Intercepted new Phantom provider`, 'color: #4caf50; font-weight: bold;');
          } else if (value && value.isAnonyMaus) {
            // AnonyMaus is being set - allow it (don't intercept)
            currentSolana = value;
            console.log(`%c✅ [AnonyMaus Solana] AnonyMaus set at window.solana`, 'color: #4caf50; font-weight: bold;');
          } else {
            currentSolana = value;
          }
        },
        configurable: true,
        enumerable: true
      });
      console.log(`%c✅ [AnonyMaus Solana] Set up window.solana interceptor`, 'color: #4caf50; font-weight: bold;');
    } catch (error) {
      console.warn(`%c⚠️ [AnonyMaus Solana] Could not define window.solana property: ${error.message}`, 'color: #ffa500;');
      // Continue anyway - might still work if Phantom is already intercepted
    }

    // Watch for window.phantom.solana
    if (window.phantom) {
      let currentPhantomSolana = window.phantom.solana;
      
      // Check if window.phantom.solana is already defined as a property
      const existingPhantomDescriptor = Object.getOwnPropertyDescriptor(window.phantom, 'solana');
      if (existingPhantomDescriptor && !existingPhantomDescriptor.configurable) {
        console.warn(`%c⚠️ [AnonyMaus Solana] window.phantom.solana is not configurable, cannot intercept`, 'color: #ffa500;');
      } else {
        try {
          Object.defineProperty(window.phantom, 'solana', {
            get: function() {
              return currentPhantomSolana;
            },
            set: function(value) {
              // Only intercept Phantom, not AnonyMaus
              if (value && isPhantom(value) && !value.isAnonyMaus) {
                originalPhantom = value;
                currentPhantomSolana = interceptPhantom(value);
                console.log(`%c✅ [AnonyMaus Solana] Intercepted new window.phantom.solana`, 'color: #4caf50; font-weight: bold;');
              } else {
                currentPhantomSolana = value;
              }
            },
            configurable: true,
            enumerable: true
          });
        } catch (error) {
          console.warn(`%c⚠️ [AnonyMaus Solana] Could not define window.phantom.solana property: ${error.message}`, 'color: #ffa500;');
        }
      }
    }
    
    // Mark as set up (both local and window flag)
    interceptorSetup = true;
    window.__ANONYMAUS_SOLANA_INTERCEPTOR_SETUP__ = true;
  }

  // Setup interceptor
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupSolanaInterceptor);
  } else {
    setupSolanaInterceptor();
  }

  // Poll for Phantom if not immediately available
  const checkInterval = setInterval(() => {
    if (interceptorSetup) {
      clearInterval(checkInterval);
      return;
    }
    
    if (window.phantom?.solana && isPhantom(window.phantom.solana) && !interceptedPhantom) {
      setupSolanaInterceptor();
      clearInterval(checkInterval);
    } else if (window.solana && isPhantom(window.solana) && !interceptedPhantom) {
      setupSolanaInterceptor();
      clearInterval(checkInterval);
    }
  }, 100);

  // Stop polling after 10 seconds
  setTimeout(() => clearInterval(checkInterval), 10000);

  console.log('%c✅ [AnonyMaus Solana] Transaction interceptor ready - will intercept Phantom transactions', 'color: #4caf50; font-weight: bold;');
})();
