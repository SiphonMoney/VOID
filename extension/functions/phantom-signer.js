// Phantom Signer - runs in page context
// Handles Phantom signing requests via window.postMessage

(function() {
  'use strict';

  // Prevent double injection
  if (window.__ANONYMAUS_PHANTOM_SIGNER__) {
    return;
  }
  window.__ANONYMAUS_PHANTOM_SIGNER__ = true;
  window.__ANONYMAUS_PHANTOM_SIGNER_READY__ = true;
  if (document?.documentElement) {
    document.documentElement.setAttribute('data-anonymaus-phantom-signer', 'ready');
  }

  console.log('%c✍️ [AnonyMaus Solana] Phantom Signer loaded in page context', 'color: #4caf50; font-weight: bold;');

  const INCO_LIGHTNING_PROGRAM_ID = '5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj';
  
  // Test message handler to verify connectivity
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'ANONYMAUS_PHANTOM_SIGNER_PING') {
      console.log('%c✅ [AnonyMaus Solana] Phantom-signer ping received, responding...', 'color: #4caf50;');
      window.postMessage({
        type: 'ANONYMAUS_PHANTOM_SIGNER_PONG',
        timestamp: Date.now()
      }, '*');
    }
  });
  
  // Also listen for custom events as backup
  document.addEventListener('anonymaus-privacycash-deposit', (event) => {
    if (event.detail && event.detail.type === 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_REQUEST') {
      console.log('%c🔍 [AnonyMaus Solana] PrivacyCash deposit request received via custom event', 'color: #4caf50;');
      // Trigger the main message handler by posting to window
      window.postMessage(event.detail, '*');
    }
  });

  // Helper to derive PDA address (simplified - uses Web Crypto API)
  async function derivePDA(seeds, programId) {
    // Convert seeds to bytes
    const seedBytes = typeof seeds === 'string' ? new TextEncoder().encode(seeds) : seeds;
    
    // Base58 decode program ID (simplified - we'll use a library-free approach)
    // For now, let's use a fetch to get the PDA from an RPC call or calculate it
    // Actually, the simplest is to use Phantom's transaction building
    
    // For a proper implementation, we'd need base58 decoding
    // But for now, let's use a workaround: calculate it server-side or use a known address
    // Actually, let's just build the transaction and let Phantom derive it if needed
    
    // Return a placeholder - we'll get the actual PDA from background or calculate it
    return null;
  }

  // Helper to find Phantom provider
  function findPhantomProvider() {
    // Check window.phantom.solana (preferred)
    if (window.phantom?.solana?.isPhantom) {
      return window.phantom.solana;
    }
    
    // Check window.solana (legacy/compatibility)
    if (window.solana?.isPhantom) {
      return window.solana;
    }
    
    // Check if it's wrapped/intercepted
    if (window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__) {
      return window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__;
    }
    
    return null;
  }

  // Listen for signing requests from content script
  window.addEventListener('message', async (event) => {
    // Debug: log ALL messages to trace issues
    if (event.data && event.data.type) {
      const sourceInfo = event.source === window ? 'window' : (event.source === document ? 'document' : (event.source ? 'other' : 'null'));
      console.log('%c🔍 [AnonyMaus Solana] Phantom-signer received message type:', 'color: #ffa500;', event.data.type, 'from:', sourceInfo, 'origin:', event.origin);
    }
    
    // Accept messages from same window OR from content script (which posts to window)
    // Content scripts post to window, so event.source should be window, but sometimes it's null
    if (event.source && event.source !== window && event.source !== document) {
      console.log('%c⚠️ [AnonyMaus Solana] Rejecting message from non-window source', 'color: #ffa500;', 'source:', event.source);
      return;
    }
    
    // Debug: log all messages to see if phantom-signer is receiving anything
    if (event.data && event.data.type && event.data.type.includes('PRIVACYCASH')) {
      console.log('%c🔍 [AnonyMaus Solana] Phantom-signer received PRIVACYCASH message:', 'color: #4caf50; font-weight: bold;', event.data.type, event.data);
    }

    // Handle Solana vault transfer request
    if (event.data && event.data.type === 'ANONYMAUS_SOLANA_VAULT_TRANSFER_REQUEST') {
      const { executorProgramId, lamports, requestId, rpcUrl, vaultPDA, encryptedDeposit, teeEndpoint } = event.data;

      try {
        // CRITICAL: Set flag to prevent re-interception (prevents infinite loop)
        window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = true;
        
        // Safety timeout: clear flag after 30 seconds
        let flagTimeout = setTimeout(() => {
          if (window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__) {
            console.warn(`%c⚠️ [AnonyMaus Solana] Clearing phantom-signer flag after timeout`, 'color: #ffa500;');
            window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;
          }
        }, 30000);
        
        console.log(`%c💰 [AnonyMaus Solana] Processing vault transfer request...`, 'color: #ff1493; font-weight: bold;');
        console.log(`   Amount: ${lamports} lamports (${(lamports / 1e9).toFixed(6)} SOL)`, 'color: #ff1493;');

        // Find Phantom provider - use original if available to avoid interception
        let phantomProvider = findPhantomProvider();
        if (!phantomProvider) {
          throw new Error('Phantom wallet not found. Please ensure Phantom is installed and connected.');
        }
        
        // Prefer original provider to avoid interception loop
        if (window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ && 
            window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__.isPhantom) {
          phantomProvider = window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__;
          console.log(`%c✅ [AnonyMaus Solana] Using original Phantom provider to avoid interception`, 'color: #4caf50;');
        }

        // Get user's public key from Phantom
        if (!phantomProvider.publicKey) {
          try {
            await phantomProvider.connect();
          } catch (error) {
            throw new Error(`Phantom connection required: ${error.message}`);
          }
        }

        const userPublicKey = phantomProvider.publicKey;
        console.log(`%c👤 [AnonyMaus Solana] Transferring from account: ${userPublicKey.toString()}`, 'color: #4caf50; font-weight: bold;');

        const executorProgramIdStr = executorProgramId || 'GG6FnZiz7qo4pfHWNHn8feTTgaqPcB4Zb29jH6zsH3Lv';
        const connectionRpcUrl = rpcUrl || 'https://solana-devnet.g.alchemy.com/v2/Sot3NTHhsx_C1Eunyg9ni';

        // Check if @solana/web3.js is available (most Solana dApps load it)
        let solanaWeb3 = null;
        if (window.web3 && window.web3.Transaction && window.web3.SystemProgram && window.web3.PublicKey) {
          solanaWeb3 = window.web3;
          console.log(`%c✅ [AnonyMaus Solana] Found @solana/web3.js in window.web3`, 'color: #4caf50;');
        } else if (window.solana && window.solana.Transaction && !window.solana.isPhantom && window.solana.SystemProgram) {
          solanaWeb3 = window.solana;
          console.log(`%c✅ [AnonyMaus Solana] Found @solana/web3.js in window.solana`, 'color: #4caf50;');
        }

        // If not found, try to load from CDN
        if (!solanaWeb3) {
          console.log(`%c⏳ [AnonyMaus Solana] @solana/web3.js not found, loading from CDN...`, 'color: #ffa500;');
          try {
            // Try loading via dynamic import (ESM)
            const module = await import('https://unpkg.com/@solana/web3.js@latest/lib/index.esm.js');
            solanaWeb3 = module;
            // Also set it on window for future use
            if (!window.web3) {
              window.web3 = module;
            }
            console.log(`%c✅ [AnonyMaus Solana] @solana/web3.js loaded from CDN (ESM)`, 'color: #4caf50;');
          } catch (importError) {
            // Try loading via script tag (UMD)
            console.log(`%c⏳ [AnonyMaus Solana] ESM failed, trying script tag...`, 'color: #ffa500;');
            solanaWeb3 = await new Promise((resolve, reject) => {
              // Check if already loading
              const existingScript = document.querySelector('script[data-solana-web3-loading]');
              if (existingScript) {
                // Wait for it to load
                existingScript.addEventListener('load', () => {
                  if (!window.web3) {
                    window.web3 = window.solanaWeb3 || window.SolanaWeb3;
                  }
                  if (window.web3 && window.web3.Transaction) {
                    resolve(window.web3);
                  } else {
                    reject(new Error('Script loaded but @solana/web3.js not found'));
                  }
                });
                existingScript.addEventListener('error', () => {
                  reject(new Error('Failed to load @solana/web3.js script'));
                });
                return;
              }
              
              const script = document.createElement('script');
              script.setAttribute('data-solana-web3-loading', 'true');
              // Try jsDelivr CDN as alternative (often more reliable)
              script.src = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@latest/lib/index.iife.min.js';
              script.onload = () => {
                // Wait a bit for the library to initialize
                setTimeout(() => {
                  // Check multiple possible global names
                  if (!window.web3) {
                    window.web3 = window.solanaWeb3 || window.SolanaWeb3;
                  }
                  if (window.web3 && window.web3.Transaction) {
                    resolve(window.web3);
                  } else if (window.solanaWeb3 && window.solanaWeb3.Transaction) {
                    window.web3 = window.solanaWeb3;
                    resolve(window.web3);
                  } else if (window.SolanaWeb3 && window.SolanaWeb3.Transaction) {
                    window.web3 = window.SolanaWeb3;
                    resolve(window.web3);
                  } else if (window.solana && window.solana.Transaction && !window.solana.isPhantom) {
                    window.web3 = window.solana;
                    resolve(window.web3);
                  } else {
                    // Try unpkg as fallback
                    console.log(`%c⏳ [AnonyMaus Solana] jsDelivr format not found, trying unpkg...`, 'color: #ffa500;');
                    const script2 = document.createElement('script');
                    script2.src = 'https://unpkg.com/@solana/web3.js@1.95.8/dist/index.iife.min.js';
                    script2.onload = () => {
                      setTimeout(() => {
                        if (!window.web3) {
                          window.web3 = window.solanaWeb3 || window.SolanaWeb3;
                        }
                        if (window.web3 && window.web3.Transaction) {
                          resolve(window.web3);
                        } else {
                          reject(new Error('@solana/web3.js loaded but not accessible. Please ensure the dApp loads @solana/web3.js library.'));
                        }
                      }, 100);
                    };
                    script2.onerror = () => {
                      reject(new Error('Failed to load @solana/web3.js from CDN. Please ensure the dApp loads @solana/web3.js library.'));
                    };
                    document.head.appendChild(script2);
                  }
                }, 100);
              };
              script.onerror = () => {
                // Try unpkg as fallback
                console.log(`%c⏳ [AnonyMaus Solana] jsDelivr failed, trying unpkg...`, 'color: #ffa500;');
                const script2 = document.createElement('script');
                script2.src = 'https://unpkg.com/@solana/web3.js@1.95.8/dist/index.iife.min.js';
                script2.onload = () => {
                  setTimeout(() => {
                    if (!window.web3) {
                      window.web3 = window.solanaWeb3 || window.SolanaWeb3;
                    }
                    if (window.web3 && window.web3.Transaction) {
                      resolve(window.web3);
                    } else {
                      reject(new Error('Failed to load @solana/web3.js from CDN'));
                    }
                  }, 100);
                };
                script2.onerror = () => {
                  reject(new Error('Failed to load @solana/web3.js from CDN. Please reload the page or ensure the dApp loads @solana/web3.js library.'));
                };
                document.head.appendChild(script2);
              };
              document.head.appendChild(script);
            });
            console.log(`%c✅ [AnonyMaus Solana] @solana/web3.js loaded from CDN (UMD)`, 'color: #4caf50;');
          }
        }

        if (!solanaWeb3 || !solanaWeb3.Transaction || !solanaWeb3.SystemProgram || !solanaWeb3.PublicKey) {
          console.error(`%c❌ [AnonyMaus Solana] @solana/web3.js is required but could not be loaded.`, 'color: #ff1493; font-weight: bold;');
          throw new Error('@solana/web3.js is required to build transactions. Please ensure the dApp loads @solana/web3.js library or allow CDN access.');
        }

        const { Transaction, SystemProgram, PublicKey, Connection, TransactionInstruction } = solanaWeb3;

        // Create Connection instance for RPC calls
        const connection = new Connection(connectionRpcUrl, 'confirmed');

        // Derive PDAs for deposit instruction
        const executorProgramPubkey = new PublicKey(executorProgramIdStr);
        const incoProgramPubkey = new PublicKey(INCO_LIGHTNING_PROGRAM_ID);
        
        // Verify program exists on-chain
        const programInfo = await connection.getAccountInfo(executorProgramPubkey);
        if (!programInfo || !programInfo.executable) {
          throw new Error(`Executor program not found or not executable at ${executorProgramIdStr}. Please ensure the program is deployed and SOLANA_EXECUTOR_PROGRAM_ID is correct.`);
        }
        console.log(`%c✅ [AnonyMaus Solana] Executor program verified on-chain`, 'color: #4caf50;');
        
        // Use TextEncoder for browser compatibility (Buffer is Node.js only)
        const vaultSeed = new TextEncoder().encode('vault');
        
        const [vaultPDA] = PublicKey.findProgramAddressSync(
          [vaultSeed],
          executorProgramPubkey
        );

        const userDepositSeed = new TextEncoder().encode('user_deposit');
        const [userDepositPDA] = PublicKey.findProgramAddressSync(
          [userDepositSeed, userPublicKey.toBuffer()],
          executorProgramPubkey
        );
        
        console.log(`%c📋 [AnonyMaus Solana] PDA Addresses:`, 'color: #4caf50;');
        console.log(`   Vault PDA: ${vaultPDA.toString()}`, 'color: #4caf50;');
        console.log(`   User Deposit PDA: ${userDepositPDA.toString()}`, 'color: #4caf50;');

        console.log(`%c📋 [AnonyMaus Solana] 💰 TRANSFER TRANSACTION WE BUILT:`, 'color: #ff1493; font-weight: bold; font-size: 14px;');
        console.log(`%c   📝 Transfer details:`, 'color: #4caf50; font-weight: bold;');
        console.log(`      Executor Program: ${executorProgramIdStr}`, 'color: #4caf50;');
        console.log(`      Vault PDA: ${vaultPDA.toString()}`, 'color: #4caf50;');
        console.log(`      From (User): ${userPublicKey.toString()}`, 'color: #4caf50;');
        console.log(`      To (Vault PDA): ${vaultPDA.toString()}`, 'color: #4caf50;');
        console.log(`      User Deposit PDA: ${userDepositPDA.toString()}`, 'color: #4caf50;');
        console.log(`%c      💰 Amount: ${(lamports / 1e9).toFixed(6)} SOL (${lamports} lamports)`, 'color: #ff1493; font-weight: bold;');
        console.log(`%c   💡 This transfer funds the executor vault for intent execution`, 'color: #4caf50;');

        // Check user balance - they need: transfer amount + fees
        const userBalance = await connection.getBalance(userPublicKey);
        const estimatedFee = 5000; // Conservative estimate for transaction fee
        const totalRequired = lamports + estimatedFee;

        console.log(`%c💰 [AnonyMaus Solana] Balance check:`, 'color: #4caf50; font-weight: bold;');
        console.log(`   User balance: ${(userBalance / 1e9).toFixed(6)} SOL (${userBalance} lamports)`, 'color: #4caf50;');
        console.log(`   Transfer amount: ${(lamports / 1e9).toFixed(6)} SOL (${lamports} lamports)`, 'color: #4caf50;');
        console.log(`   Estimated fee: ${(estimatedFee / 1e9).toFixed(6)} SOL (${estimatedFee} lamports)`, 'color: #4caf50;');
        console.log(`   Total required: ${(totalRequired / 1e9).toFixed(6)} SOL (${totalRequired} lamports)`, userBalance >= totalRequired ? 'color: #4caf50;' : 'color: #ff1493;');

        if (userBalance < totalRequired) {
          const missing = totalRequired - userBalance;
          throw new Error(`Insufficient balance. Required: ${(totalRequired / 1e9).toFixed(6)} SOL, Available: ${(userBalance / 1e9).toFixed(6)} SOL, Missing: ${(missing / 1e9).toFixed(6)} SOL`);
        }

        // Create deposit transaction (program instruction creates/updates user deposit PDA)
        const depositTransaction = new Transaction();
        const DEPOSIT_INSTRUCTION = 1; // Must match program discriminator

        let depositCiphertext = encryptedDeposit?.ciphertext;
        if (!depositCiphertext) {
          try {
            const baseUrl = (teeEndpoint || 'http://localhost:3001/api').replace('/api', '');
            const response = await fetch(`${baseUrl}/api/inco-encrypt`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ values: { amountLamports: lamports } })
            });
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({ error: response.statusText }));
              throw new Error(errorData.error || 'Inco encrypt failed');
            }
            const data = await response.json();
            depositCiphertext = data?.handles?.amountLamports?.ciphertext || null;
          } catch (error) {
            throw new Error(`Missing encrypted deposit ciphertext (${error.message})`);
          }
        }

        const hexToBytes = (hex) => {
          const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
          const bytes = new Uint8Array(normalized.length / 2);
          for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(normalized.substr(i * 2, 2), 16);
          }
          return bytes;
        };

        // Build instruction data:
        // [discriminator (1 byte)] + [amount (8 bytes LE)]
        // + [ciphertext_len (4 bytes LE)] + [ciphertext bytes] + [input_type (1 byte)]
        const amountBigInt = BigInt(lamports);
        const ciphertextBytes = hexToBytes(depositCiphertext);
        const data = new Uint8Array(1 + 8 + 4 + ciphertextBytes.length + 1);
        data[0] = DEPOSIT_INSTRUCTION;
        for (let i = 0; i < 8; i++) {
          data[1 + i] = Number((amountBigInt >> BigInt(8 * i)) & BigInt(0xff));
        }
        const lenOffset = 1 + 8;
        data[lenOffset] = ciphertextBytes.length & 0xff;
        data[lenOffset + 1] = (ciphertextBytes.length >> 8) & 0xff;
        data[lenOffset + 2] = (ciphertextBytes.length >> 16) & 0xff;
        data[lenOffset + 3] = (ciphertextBytes.length >> 24) & 0xff;
        data.set(ciphertextBytes, lenOffset + 4);
        const inputType =
          (encryptedDeposit && typeof encryptedDeposit.inputType === 'number')
            ? encryptedDeposit.inputType
            : 0;
        data[data.length - 1] = inputType;

        const depositInstruction = new TransactionInstruction({
          programId: executorProgramPubkey,
          keys: [
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
            { pubkey: userPublicKey, isSigner: true, isWritable: true },
            { pubkey: userDepositPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: incoProgramPubkey, isSigner: false, isWritable: false },
          ],
          data
        });

        depositTransaction.add(depositInstruction);

        // Set fee payer and recent blockhash
        depositTransaction.feePayer = userPublicKey;
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        depositTransaction.recentBlockhash = blockhash;

        // Check if vault PDA exists (it should exist, but let's verify)
        const vaultInfo = await connection.getAccountInfo(vaultPDA);
        if (!vaultInfo) {
          console.warn(`%c⚠️ [AnonyMaus Solana] Vault PDA account does not exist yet`, 'color: #ffa500; font-weight: bold;');
          console.warn(`   Vault PDA: ${vaultPDA.toString()}`, 'color: #ffa500;');
          console.warn(`   💡 The vault PDA will be created automatically by the program`, 'color: #ffa500;');
        } else {
          console.log(`%c✅ [AnonyMaus Solana] Vault PDA exists`, 'color: #4caf50;');
        }

        console.log(`%c📝 [AnonyMaus Solana] Requesting Phantom to sign deposit transaction...`, 'color: #ff1493;');
        console.log(`%c   Transaction details:`, 'color: #ff1493;');
        console.log(`      Blockhash: ${depositTransaction.recentBlockhash}`, 'color: #ff1493;');
        console.log(`      Fee payer: ${depositTransaction.feePayer.toString()}`, 'color: #ff1493;');
        console.log(`      Instructions: ${depositTransaction.instructions.length}`, 'color: #ff1493;');
        console.log(`      Ciphertext bytes: ${ciphertextBytes.length}`, 'color: #ff1493;');
        console.log(`      Input type: ${inputType}`, 'color: #ff1493;');
        
        // Simulate before sending so we capture program logs if it fails
        try {
          const simulation = await connection.simulateTransaction(depositTransaction);
          if (simulation?.value?.err) {
            console.error(`%c❌ [AnonyMaus Solana] Deposit simulation failed`, 'color: #ff1493; font-weight: bold;');
            if (simulation.value.logs) {
              console.error(`   Program logs (first 15):`, simulation.value.logs.slice(0, 15), 'color: #ff1493;');
            }
            throw new Error(`Deposit simulation failed: ${JSON.stringify(simulation.value.err)}`);
          }
          console.log(`%c✅ [AnonyMaus Solana] Deposit simulation passed`, 'color: #4caf50;');
        } catch (simError) {
          const simMessage = simError?.message || simError?.toString() || 'Unknown simulation error';
          console.error(`%c❌ [AnonyMaus Solana] Simulation error: ${simMessage}`, 'color: #ff1493; font-weight: bold;');
          if (!/invalid arguments/i.test(simMessage)) {
            throw simError;
          }
          console.warn(`%c⚠️ [AnonyMaus Solana] Simulation skipped due to RPC args mismatch`, 'color: #ffa500; font-weight: bold;');
        }
        
        let signedTx;
        try {
          // Log transaction details for debugging
          console.log(`%c📤 [AnonyMaus Solana] Sending transaction to Phantom...`, 'color: #4caf50;');
          console.log(`   Transaction size: ${depositTransaction.serialize({ requireAllSignatures: false }).length} bytes`, 'color: #4caf50;');
          
          signedTx = await phantomProvider.signAndSendTransaction(depositTransaction);
        } catch (signError) {
          console.error(`%c❌ [AnonyMaus Solana] Phantom signAndSendTransaction error:`, 'color: #ff1493; font-weight: bold;');
          console.error(`   Error type: ${signError?.constructor?.name || 'Unknown'}`, 'color: #ff1493;');
          console.error(`   Error message: ${signError?.message || 'No message'}`, 'color: #ff1493;');
          console.error(`   Error code: ${signError?.code || 'No code'}`, 'color: #ff1493;');
          
          // Try to extract more details from the error
          if (signError?.data) {
            console.error(`   Error data:`, signError.data, 'color: #ff1493;');
          }
          if (signError?.logs && Array.isArray(signError.logs)) {
            console.error(`   Program logs (first 10):`, signError.logs.slice(0, 10), 'color: #ff1493;');
            // Look for program error messages
            const programErrors = signError.logs.filter(log => 
              typeof log === 'string' && (
                log.includes('Error') || 
                log.includes('failed') || 
                log.includes('Invalid') ||
                log.includes('Program')
              )
            );
            if (programErrors.length > 0) {
              console.error(`   Program errors found:`, programErrors, 'color: #ff1493; font-weight: bold;');
            }
          }
          
          // Check for instruction error
          if (signError?.err) {
            console.error(`   Transaction error object:`, signError.err, 'color: #ff1493;');
          }
          
          console.error(`   Full error object:`, signError);
          
          // Provide clearer user-facing error message
          let errorMessage = signError?.message || 'Unexpected error';

          if (signError?.logs && Array.isArray(signError.logs)) {
            const errorLog = signError.logs.find(log =>
              typeof log === 'string' && (
                log.includes('Program log:') ||
                log.includes('Error') ||
                log.includes('failed')
              )
            );
            if (errorLog) {
              errorMessage = `Vault transfer failed: ${errorLog}`;
            }
          }

          if (signError?.code === -32603 && errorMessage === 'Unexpected error') {
            errorMessage = 'Vault transfer failed on-chain. Flow is correct (intercept → build deposit → user approves → intent signed → executor executes), but the program rejected this deposit. Check program logs for the exact reason.';
          }

          errorMessage += ` (Program: ${executorProgramIdStr})`;
          
          throw new Error(errorMessage);
        }
        
        clearTimeout(flagTimeout);
        window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;

        console.log(`%c✅ [AnonyMaus Solana] Vault transfer successful`, 'color: #4caf50; font-weight: bold;');
        console.log(`%c📝 [AnonyMaus Solana] Signature: ${signedTx.signature}`, 'color: #4caf50; font-weight: bold;');

        // Send success result back to content script
        window.postMessage({
          type: 'ANONYMAUS_SOLANA_VAULT_TRANSFER_RESULT',
          requestId: requestId,
          success: true,
          signature: signedTx.signature.toString()
        }, '*');

      } catch (error) {
        // Clear flag on error too
        if (typeof flagTimeout !== 'undefined') {
          clearTimeout(flagTimeout);
        }
        window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;
        
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        const errorStack = error?.stack || '';
        
        console.error(`%c❌ [AnonyMaus Solana] Vault transfer error: ${errorMessage}`, 'color: #ff1493; font-weight: bold;');
        if (errorStack) {
          console.error(`%c   Stack: ${errorStack}`, 'color: #ff1493;');
        }

        // Send error result back to content script
        window.postMessage({
          type: 'ANONYMAUS_SOLANA_VAULT_TRANSFER_RESULT',
          requestId: requestId,
          success: false,
          error: errorMessage
        }, '*');
      }
    }

    // Handle PrivacyCash-lite deposit request
    if (event.data && event.data.type === 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_REQUEST') {
      const { privacyProgramId, authorityPubkey, lamports, requestId, rpcUrl } = event.data;

      try {
        console.log('%c🔒 [AnonyMaus Solana] PrivacyCash deposit request received in page', 'color: #4caf50; font-weight: bold;');
        console.log(`%c   requestId: ${requestId}`, 'color: #4caf50;');
        console.log(`%c   privacyProgramId: ${privacyProgramId}`, 'color: #4caf50;');
        console.log(`%c   authorityPubkey: ${authorityPubkey}`, 'color: #4caf50;');
        console.log(`%c   lamports: ${lamports}`, 'color: #4caf50;');
        console.log(`%c   rpcUrl: ${rpcUrl || 'default'}`, 'color: #4caf50;');
        window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = true;
        let flagTimeout = setTimeout(() => {
          if (window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__) {
            window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;
          }
        }, 30000);

        let phantomProvider = findPhantomProvider();
        if (!phantomProvider) {
          throw new Error('Phantom wallet not found.');
        }
        console.log('%c🔑 [AnonyMaus Solana] Phantom provider found', 'color: #4caf50;');
        if (window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ && window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__.isPhantom) {
          phantomProvider = window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__;
        }
        if (!phantomProvider.publicKey) {
          await phantomProvider.connect();
        }

        const userPublicKey = phantomProvider.publicKey;
        console.log(`%c👤 [AnonyMaus Solana] Deposit from: ${userPublicKey.toString()}`, 'color: #4caf50;');
        const connectionRpcUrl = rpcUrl || 'https://solana-devnet.g.alchemy.com/v2/Sot3NTHhsx_C1Eunyg9ni';

        console.log('%c⏳ [AnonyMaus Solana] Loading @solana/web3.js...', 'color: #ffa500;');
        let solanaWeb3 = null;
        if (window.web3 && window.web3.Transaction && window.web3.SystemProgram && window.web3.PublicKey) {
          solanaWeb3 = window.web3;
        } else if (window.solana && window.solana.Transaction && !window.solana.isPhantom && window.solana.SystemProgram) {
          solanaWeb3 = window.solana;
        }
        if (!solanaWeb3) {
          console.log('%c📦 [AnonyMaus Solana] @solana/web3.js not found, loading from CDN...', 'color: #ffa500;');
          solanaWeb3 = await new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-solana-web3-loading]');
            if (existingScript) {
              existingScript.addEventListener('load', () => {
                if (!window.web3) {
                  window.web3 = window.solanaWeb3 || window.SolanaWeb3;
                }
                if (window.web3 && window.web3.Transaction) {
                  resolve(window.web3);
                } else if (window.solanaWeb3 && window.solanaWeb3.Transaction) {
                  window.web3 = window.solanaWeb3;
                  resolve(window.web3);
                } else if (window.SolanaWeb3 && window.SolanaWeb3.Transaction) {
                  window.web3 = window.SolanaWeb3;
                  resolve(window.web3);
                } else {
                  reject(new Error('@solana/web3.js loaded but not accessible.'));
                }
              });
              existingScript.addEventListener('error', () => {
                reject(new Error('Failed to load @solana/web3.js script'));
              });
              return;
            }

            const script = document.createElement('script');
            script.setAttribute('data-solana-web3-loading', 'true');
            script.src = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@latest/lib/index.iife.min.js';
            script.onload = () => {
              setTimeout(() => {
                if (!window.web3) {
                  window.web3 = window.solanaWeb3 || window.SolanaWeb3;
                }
                if (window.web3 && window.web3.Transaction) {
                  resolve(window.web3);
                } else if (window.solanaWeb3 && window.solanaWeb3.Transaction) {
                  window.web3 = window.solanaWeb3;
                  resolve(window.web3);
                } else if (window.SolanaWeb3 && window.SolanaWeb3.Transaction) {
                  window.web3 = window.SolanaWeb3;
                  resolve(window.web3);
                } else if (window.solana && window.solana.Transaction && !window.solana.isPhantom) {
                  window.web3 = window.solana;
                  resolve(window.web3);
                } else {
                  reject(new Error('@solana/web3.js loaded but not accessible.'));
                }
              }, 100);
            };
            script.onerror = () => {
              reject(new Error('Failed to load @solana/web3.js from CDN.'));
            };
            document.head.appendChild(script);
          });
          if (!window.web3) {
            window.web3 = solanaWeb3;
          }
        }
        console.log('%c✅ [AnonyMaus Solana] @solana/web3.js loaded', 'color: #4caf50;');

        console.log('%c🔧 [AnonyMaus Solana] Building deposit transaction...', 'color: #ffa500;');
        const { Transaction, SystemProgram, PublicKey, Connection, TransactionInstruction } = solanaWeb3;
        console.log('%c🔧 [AnonyMaus Solana] Creating connection...', 'color: #ffa500;');
        const connection = new Connection(connectionRpcUrl, 'confirmed');
        console.log('%c🔧 [AnonyMaus Solana] Parsing program pubkey...', 'color: #ffa500;');
        const programPubkey = new PublicKey(privacyProgramId);
        const incoProgramPubkey = new PublicKey(INCO_LIGHTNING_PROGRAM_ID);
        console.log('%c🔧 [AnonyMaus Solana] Parsing authority pubkey...', 'color: #ffa500;');
        const authority = new PublicKey(authorityPubkey);
        console.log('%c✅ [AnonyMaus Solana] Program and authority parsed', 'color: #4caf50;');
        console.log(`%c   Program: ${programPubkey.toBase58()}`, 'color: #4caf50;');
        console.log(`%c   Authority: ${authority.toBase58()}`, 'color: #4caf50;');

        console.log('%c🔧 [AnonyMaus Solana] Deriving vault PDA...', 'color: #ffa500;');
        const [vaultPDA] = PublicKey.findProgramAddressSync(
          [new TextEncoder().encode('vault')],
          programPubkey
        );
        console.log(`%c   Vault PDA: ${vaultPDA.toBase58()}`, 'color: #4caf50;');
        
        console.log('%c🔧 [AnonyMaus Solana] Deriving user deposit PDA...', 'color: #ffa500;');
        const [userDepositPDA] = PublicKey.findProgramAddressSync(
          [new TextEncoder().encode('user_deposit'), userPublicKey.toBuffer()],
          programPubkey
        );
        console.log(`%c   User Deposit PDA: ${userDepositPDA.toBase58()}`, 'color: #4caf50;');

        console.log('%c🔧 [AnonyMaus Solana] Building instruction data...', 'color: #ffa500;');
        const data = new Uint8Array(1 + 8 + 32);
        data[0] = 0;
        const amountBigInt = BigInt(lamports);
        for (let i = 0; i < 8; i++) {
          data[1 + i] = Number((amountBigInt >> BigInt(8 * i)) & BigInt(0xff));
        }
        authority.toBuffer().copy(data, 1 + 8);
        console.log(`%c   Instruction data length: ${data.length} bytes`, 'color: #4caf50;');

        console.log('%c🔧 [AnonyMaus Solana] Creating deposit instruction...', 'color: #ffa500;');
        const depositInstruction = new TransactionInstruction({
          programId: programPubkey,
          keys: [
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
            { pubkey: userPublicKey, isSigner: true, isWritable: true },
            { pubkey: userDepositPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: incoProgramPubkey, isSigner: false, isWritable: false },
          ],
          data
        });
        console.log('%c✅ [AnonyMaus Solana] Deposit instruction created', 'color: #4caf50;');

        console.log('%c🔧 [AnonyMaus Solana] Creating transaction...', 'color: #ffa500;');
        const depositTx = new Transaction().add(depositInstruction);
        depositTx.feePayer = userPublicKey;
        console.log('%c⏳ [AnonyMaus Solana] Fetching blockhash...', 'color: #ffa500;');
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        depositTx.recentBlockhash = blockhash;
        console.log('%c✅ [AnonyMaus Solana] Blockhash fetched', 'color: #4caf50;');
        console.log(`%c   Blockhash: ${blockhash}`, 'color: #4caf50;');

        console.log('%c✍️ [AnonyMaus Solana] Requesting Phantom signature...', 'color: #ff1493; font-weight: bold;');
        const signedTx = await phantomProvider.signTransaction(depositTx);
        console.log('%c✅ [AnonyMaus Solana] Transaction signed by Phantom', 'color: #4caf50;');
        console.log('%c⏳ [AnonyMaus Solana] Sending transaction to network...', 'color: #ffa500;');
        const signature = await connection.sendRawTransaction(signedTx.serialize());
        console.log('%c✅ [AnonyMaus Solana] Transaction sent: ' + signature.toString(), 'color: #4caf50; font-weight: bold;');

        clearTimeout(flagTimeout);
        window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;
        console.log(`%c✅ [AnonyMaus Solana] PrivacyCash deposit submitted: ${signature.toString()}`, 'color: #4caf50; font-weight: bold;');

        console.log('%c📤 [AnonyMaus Solana] Sending success result to content script...', 'color: #4caf50;');
        window.postMessage({
          type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT',
          requestId,
          success: true,
          signature: signature.toString()
        }, '*');
        console.log('%c✅ [AnonyMaus Solana] Success result sent to content script', 'color: #4caf50;');
      } catch (error) {
        if (typeof flagTimeout !== 'undefined') {
          clearTimeout(flagTimeout);
        }
        window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        const errorStack = error?.stack || '';
        console.error('%c❌ [AnonyMaus Solana] PrivacyCash deposit failed', 'color: #ff1493; font-weight: bold;', errorMessage);
        if (errorStack) {
          console.error(`%c   Stack: ${errorStack}`, 'color: #ff1493;');
        }
        console.log('%c📤 [AnonyMaus Solana] Sending error result to content script...', 'color: #ff1493;');
        window.postMessage({
          type: 'ANONYMAUS_SOLANA_PRIVACYCASH_DEPOSIT_RESULT',
          requestId,
          success: false,
          error: errorMessage
        }, '*');
        console.log('%c✅ [AnonyMaus Solana] Error result sent to content script', 'color: #ff1493;');
      }
    }

    // Handle Solana signing request (for intent signature)
    if (event.data && event.data.type === 'ANONYMAUS_SOLANA_SIGN_REQUEST') {
      const { transaction, intent, requestId, signingMethod } = event.data;

      // CRITICAL: Set flag to prevent re-interception (prevents infinite loop)
      window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = true;
      
      // Safety timeout: clear flag after 30 seconds to prevent permanent lock
      let flagTimeout = setTimeout(() => {
        if (window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__) {
          console.warn(`%c⚠️ [AnonyMaus Solana] Clearing phantom-signer flag after timeout`, 'color: #ffa500;');
          window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;
        }
      }, 30000);

      try {
        
        console.log('%c✍️ [AnonyMaus Solana] Processing Phantom signing request...', 'color: #ff1493; font-weight: bold;');
        console.log(`   Method: ${signingMethod}`, 'color: #ff1493;');

        // Find Phantom provider - use original if available to avoid interception
        let phantomProvider = findPhantomProvider();
        if (!phantomProvider) {
          throw new Error('Phantom wallet not found. Please ensure Phantom is installed and connected.');
        }
        
        // Prefer original provider to avoid interception loop
        if (window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__ && 
            window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__.isPhantom) {
          phantomProvider = window.__ANONYMAUS_ORIGINAL_PHANTOM_PROVIDER__;
          console.log(`%c✅ [AnonyMaus Solana] Using original Phantom provider to avoid interception`, 'color: #4caf50;');
        }

        // Get user's public key from Phantom
        if (!phantomProvider.publicKey) {
          // Try to connect first
          try {
            await phantomProvider.connect();
          } catch (error) {
            throw new Error(`Phantom connection required: ${error.message}`);
          }
        }

        const userPublicKey = phantomProvider.publicKey;
        console.log(`%c👤 [AnonyMaus Solana] Signing with account: ${userPublicKey.toString()}`, 'color: #4caf50; font-weight: bold;');

        // Helper function to convert Uint8Array to hex string (browser-compatible)
        function uint8ArrayToHex(uint8Array) {
          return Array.from(uint8Array)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        }
        
        let signedTransaction = null;
        let signature = null;

        // PRIORITY 1: Sign intent hash if intent is provided (this is what we want for authorization)
        // The intent signature authorizes the transaction execution - this is the main flow!
        if (intent) {
          try {
            console.log(`%c✍️ [AnonyMaus Solana] Signing intent hash (intent authorization)...`, 'color: #4caf50; font-weight: bold;');
            console.log(`   💡 This signature authorizes transaction execution through TEE`, 'color: #4caf50;');
            
            // Create intent hash (same as background does)
            const intentString = JSON.stringify(intent);
            const intentBytes = new TextEncoder().encode(intentString);
            const hashBuffer = await crypto.subtle.digest('SHA-256', intentBytes);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const intentHash = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            console.log(`%c📝 [AnonyMaus Solana] Intent Hash: ${intentHash.substring(0, 20)}...`, 'color: #4caf50;');
            
            // Create human-readable message for Phantom popup
            const action = intent.action || 'Transaction';
            const txType = intent.transactionType || 'UNKNOWN';
            const dapp = intent.metadata?.dappName || window.location.hostname;
            
            const signingMessage = `AnonyMaus Intent Signature Request

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Action: ${action.toUpperCase()}
Type: ${txType}
Network: Solana
dApp: ${dapp}

Intent Hash: ${intentHash.substring(0, 20)}...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

By signing, you authorize AnonyMaus to:
• Execute this transaction anonymously through the TEE network

⚠️ IMPORTANT: This is an OFF-CHAIN intent signature, NOT a direct blockchain transaction.

This signature:
✅ Authorizes transaction execution
✅ Uses your funds (vault transfer was already sent)

You are NOT signing a raw blockchain transaction.`;
            
            // Sign the intent hash as a message (for verification)
            // NOTE: We sign the intentHash, not the human-readable message
            // This ensures server-side verification works correctly
            const messageToSign = new TextEncoder().encode(intentHash);
            const signedMessage = await phantomProvider.signMessage(messageToSign);
            
            console.log(`%c✅ [AnonyMaus Solana] Intent signed as message`, 'color: #4caf50; font-weight: bold;');
            
            // Convert signature to hex string (browser-compatible)
            signature = uint8ArrayToHex(signedMessage.signature);
            
            signedTransaction = {
              signature: signature,
              publicKey: userPublicKey.toString(),
              message: intentHash,
              intentHash: intentHash
            };
            
            // Clear flag and timeout after successful signing
            clearTimeout(flagTimeout);
            window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;

            // Send success result back to content script
            window.postMessage({
              type: 'ANONYMAUS_SOLANA_SIGN_RESULT',
              requestId: requestId,
              success: true,
              signedTransaction: signedTransaction,
              signature: signature,
              publicKey: userPublicKey.toString()
            }, '*');
            
            return; // Exit early - intent signed successfully
          } catch (error) {
            console.error(`%c❌ [AnonyMaus Solana] Error signing intent hash: ${error.message}`, 'color: #ff1493; font-weight: bold;');
            // Fall through to transaction signing fallback
          }
        }

        // FALLBACK: Reconstruct the transaction from serialized data and sign it
        // This is used if intent signing fails or if no intent is provided
        // NOTE: This should rarely happen - intent should always be provided
        if (transaction?.serialized) {
          try {
            console.log(`📦 [AnonyMaus Solana] Reconstructing transaction from serialized data...`, 'color: #ff1493;');
            
            // Convert serialized data to Uint8Array if needed
            let serializedBuffer;
            if (transaction.serialized instanceof Uint8Array) {
              serializedBuffer = transaction.serialized;
            } else if (Array.isArray(transaction.serialized)) {
              serializedBuffer = new Uint8Array(transaction.serialized);
            } else if (typeof transaction.serialized === 'object') {
              // Convert object with numeric keys to Uint8Array
              const values = Object.values(transaction.serialized);
              serializedBuffer = new Uint8Array(values);
            } else {
              throw new Error('Invalid serialized transaction format');
            }
            
            console.log(`   Serialized size: ${serializedBuffer.length} bytes`, 'color: #ff1493;');
            
            // Try to find @solana/web3.js Transaction class
            // Most dApps load it, so it should be available in some form
            let Transaction = null;
            
            // Check common locations for @solana/web3.js
            if (typeof window !== 'undefined') {
              // Method 1: Check if it's exposed as a global (some bundlers do this)
              if (window.web3 && window.web3.Transaction) {
                Transaction = window.web3.Transaction;
                console.log(`✅ Found Transaction at window.web3.Transaction`, 'color: #4caf50;');
              }
              // Method 2: Check window.solana (unlikely but possible)
              else if (window.solana && window.solana.Transaction && !window.solana.isPhantom) {
                Transaction = window.solana.Transaction;
                console.log(`✅ Found Transaction at window.solana.Transaction`, 'color: #4caf50;');
              }
              // Method 3: Check if the page has a Transaction class available
              // Many dApps import it and it might be accessible
              else {
                // Try to find it by checking if any loaded module exposes it
                // Check common variable names dApps might use
                const possibleNames = ['Transaction', 'SolanaTransaction', 'web3Transaction'];
                for (const name of possibleNames) {
                  if (window[name] && typeof window[name].from === 'function') {
                    Transaction = window[name];
                    console.log(`✅ Found Transaction at window.${name}`, 'color: #4caf50;');
                    break;
                  }
                }
              }
            }
            
            // If still not found, log a warning
            if (!Transaction) {
              console.log(`⚠️ @solana/web3.js Transaction not found in common locations`, 'color: #ffa500;');
              console.log(`   Will attempt fallback methods`, 'color: #ffa500;');
            }
            
            // If Transaction is available, deserialize and sign
            if (Transaction) {
              try {
                console.log(`✅ [AnonyMaus Solana] Found @solana/web3.js, deserializing transaction...`, 'color: #4caf50;');
                const reconstructedTx = Transaction.from(serializedBuffer);
                
                // Sign the transaction with Phantom
                if (signingMethod === 'signAndSendTransaction') {
                  const result = await phantomProvider.signAndSendTransaction(reconstructedTx);
                  signedTransaction = result;
                  signature = result.signature ? uint8ArrayToHex(result.signature) : null;
                  console.log(`%c✅ [AnonyMaus Solana] Transaction signed and sent`, 'color: #4caf50; font-weight: bold;');
                } else {
                  const result = await phantomProvider.signTransaction(reconstructedTx);
                  signedTransaction = result;
                  signature = result.signature ? uint8ArrayToHex(result.signature) : null;
                  console.log(`%c✅ [AnonyMaus Solana] Transaction signed`, 'color: #4caf50; font-weight: bold;');
                }
              } catch (error) {
                console.error(`❌ [AnonyMaus Solana] Error deserializing/signing: ${error.message}`, 'color: #ff1493;');
                throw error;
              }
            } else {
              // Try to load @solana/web3.js from CDN if not available
              console.log(`⚠️ [AnonyMaus Solana] @solana/web3.js not found, attempting to load from CDN...`, 'color: #ffa500;');
              
              try {
                // Try to dynamically import @solana/web3.js
                // Note: This might not work in all contexts due to CSP
                const solanaWeb3 = await import('https://unpkg.com/@solana/web3.js@latest/lib/index.esm.js');
                Transaction = solanaWeb3.Transaction;
                
                if (Transaction) {
                  console.log(`✅ [AnonyMaus Solana] Loaded @solana/web3.js from CDN`, 'color: #4caf50;');
                  const reconstructedTx = Transaction.from(serializedBuffer);
                  
                  if (signingMethod === 'signAndSendTransaction') {
                    const result = await phantomProvider.signAndSendTransaction(reconstructedTx);
                    signedTransaction = result;
                    signature = result.signature ? uint8ArrayToHex(result.signature) : null;
                  } else {
                    const result = await phantomProvider.signTransaction(reconstructedTx);
                    signedTransaction = result;
                    signature = result.signature ? uint8ArrayToHex(result.signature) : null;
                  }
                  console.log(`%c✅ [AnonyMaus Solana] Transaction signed using CDN library`, 'color: #4caf50; font-weight: bold;');
                }
              } catch (importError) {
                console.warn(`⚠️ [AnonyMaus Solana] Could not load @solana/web3.js from CDN: ${importError.message}`, 'color: #ffa500;');
                // Fall through to fallback
              }
            }
            
            // Final fallback if Transaction still not available
            if (!Transaction || !signedTransaction) {
              // Fallback: Try to use Phantom's signTransaction with a transaction-like object
              // Phantom might be able to deserialize it internally
              console.log(`⚠️ [AnonyMaus Solana] Using fallback: creating transaction-like object...`, 'color: #ffa500;');
              
              // Create a transaction-like object that implements the interface Phantom expects
              // Phantom's signTransaction expects an object with a serialize() method
              const txToSign = {
                serialize: (options = {}) => {
                  // Return the serialized buffer
                  return serializedBuffer;
                },
                // Store serialized data
                _serialized: serializedBuffer,
                // Add signatures array (Phantom will populate this)
                signatures: [],
                // Add message if we have instructions
                ...(transaction.instructions ? {
                  message: {
                    instructions: transaction.instructions
                  }
                } : {})
              };
              
              try {
                console.log(`📝 [AnonyMaus Solana] Attempting to sign with Phantom...`, 'color: #ff1493;');
                if (signingMethod === 'signAndSendTransaction') {
                  const result = await phantomProvider.signAndSendTransaction(txToSign);
                  signedTransaction = result;
                  signature = result.signature ? uint8ArrayToHex(result.signature) : null;
                } else {
                  const result = await phantomProvider.signTransaction(txToSign);
                  signedTransaction = result;
                  signature = result.signature ? uint8ArrayToHex(result.signature) : null;
                }
                console.log(`%c✅ [AnonyMaus Solana] Transaction signed via Phantom fallback`, 'color: #4caf50; font-weight: bold;');
              } catch (error) {
                console.error(`❌ [AnonyMaus Solana] Phantom signing failed: ${error.message}`, 'color: #ff1493;');
                console.error(`   This might be because @solana/web3.js Transaction class is required`, 'color: #ff1493;');
                throw new Error(`Failed to sign transaction: ${error.message}. The dApp may need to load @solana/web3.js.`);
              }
            }
          } catch (error) {
            console.error(`%c❌ [AnonyMaus Solana] Error signing transaction: ${error.message}`, 'color: #ff1493; font-weight: bold;');
            throw error;
          }
        } else {
          // If no intent and no serialized transaction, throw error
          throw new Error('No intent or transaction data provided for signing');
        }

        // Clear flag and timeout after successful signing
        clearTimeout(flagTimeout);
        window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;

        // Send success result back to content script
        window.postMessage({
          type: 'ANONYMAUS_SOLANA_SIGN_RESULT',
          requestId: requestId,
          success: true,
          signedTransaction: signedTransaction,
          signature: signature,
          publicKey: userPublicKey.toString()
        }, '*');

      } catch (error) {
        // Clear flag and timeout on error too
        clearTimeout(flagTimeout);
        window.__ANONYMAUS_PHANTOM_SIGNER_ACTIVE__ = false;
        
        console.error(`%c❌ [AnonyMaus Solana] Phantom signing error: ${error.message}`, 'color: #ff1493; font-weight: bold;');

        // Send error result back to content script
        window.postMessage({
          type: 'ANONYMAUS_SOLANA_SIGN_RESULT',
          requestId: requestId,
          success: false,
          error: error.message
        }, '*');
      }
    }
  });

  console.log('%c✅ [AnonyMaus Solana] Phantom signer ready', 'color: #4caf50; font-weight: bold;');
})();
