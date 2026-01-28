// Solana Intent Builder
// Creates structured intents from Solana transactions for user signing

class SolanaIntentBuilder {
  constructor() {
    this.intentVersion = '1.0.0';
  }

  /**
   * Build intent from Solana transaction
   * @param {Object} transactionData - The intercepted transaction data
   * @param {string} transactionType - Type of transaction (SWAP/TRANSFER, etc.)
   * @returns {Object} Structured intent
   */
  buildIntent(transactionData, transactionType = 'UNKNOWN') {
    const intent = {
      version: this.intentVersion,
      timestamp: Date.now(),
      expiry: Date.now() + 300000, // 5 minutes
      chainId: 'solana', // Solana doesn't use chainId like Ethereum
      network: 'mainnet-beta', // Could be mainnet-beta, devnet, testnet
      action: this.determineAction(transactionData, transactionType),
      transactionType,
      
      // Solana transaction details
      transaction: {
        instructions: transactionData.instructions || [],
        feePayer: transactionData.feePayer || null,
        recentBlockhash: transactionData.recentBlockhash || null,
        serialized: transactionData.serialized || null
      },
      
      // Intent limits (for user safety)
      limits: {
        maxSlippage: this.extractSlippage(transactionData) || '0.01', // 1% default
        expiry: Date.now() + 300000 // 5 minutes
      },
      
      // Metadata
      metadata: {
        dappUrl: this.getDappUrl(),
        dappName: this.getDappName(),
        interceptedAt: Date.now()
      }
    };

    // Add action-specific fields
    if (transactionType === 'SWAP/TRANSFER') {
      intent.swapDetails = this.extractSwapDetails(transactionData);
    } else if (transactionType === 'APPROVAL') {
      intent.approvalDetails = this.extractApprovalDetails(transactionData);
    }

    return intent;
  }

  /**
   * Determine action type from Solana transaction
   */
  determineAction(transactionData, transactionType) {
    if (transactionType === 'APPROVAL') {
      return 'approve';
    }
    
    // Analyze instructions to determine action
    const instructions = transactionData.instructions || [];
    
    // If we have serialized data but no instructions, use a default action
    // The backend will deserialize and determine the actual action
    if (instructions.length === 0 && transactionData.serialized) {
      // Default to swap/transfer for Raydium/Jupiter swaps
      if (transactionType === 'SWAP/TRANSFER') {
        return 'swap';
      }
      return 'transaction'; // Generic transaction type
    }
    
    for (const instruction of instructions) {
      const programId = instruction.programId?.toLowerCase() || '';
      
      // Token Program (SPL Token)
      if (programId.includes('token') || programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
        // Check instruction type
        if (instruction.data && instruction.data.length > 0) {
          const instructionType = instruction.data[0];
          // Transfer = 3, Approve = 4
          if (instructionType === 3) {
            return 'transfer';
          } else if (instructionType === 4) {
            return 'approve';
          }
        }
      }
      
      // Jupiter/Orca Swap Programs
      if (programId.includes('jupiter') || programId.includes('orca') || programId.includes('swap')) {
        return 'swap';
      }
      
      // System Program (SOL transfer)
      if (programId.includes('system') || programId === '11111111111111111111111111111111') {
        return 'transfer';
      }
    }
    
    return 'unknown';
  }

  /**
   * Extract swap details from transaction
   */
  extractSwapDetails(transactionData) {
    const instructions = transactionData.instructions || [];
    
    return {
      hasSwapData: instructions.length > 0,
      instructionCount: instructions.length,
      programs: instructions.map(ix => ({
        programId: ix.programId,
        hasData: !!(ix.data && ix.data.length > 0)
      }))
    };
  }

  /**
   * Extract approval details from transaction
   */
  extractApprovalDetails(transactionData) {
    const instructions = transactionData.instructions || [];
    
    return {
      isApproval: true,
      instructionCount: instructions.length
    };
  }

  /**
   * Extract slippage from transaction (if available)
   */
  extractSlippage(transactionData) {
    // TODO: Parse slippage from Jupiter/Orca swap transaction data
    return null;
  }

  /**
   * Get current dApp URL
   */
  getDappUrl() {
    try {
      return window.location.href;
    } catch (e) {
      return 'unknown';
    }
  }

  /**
   * Get current dApp name
   */
  getDappName() {
    try {
      return document.title || window.location.hostname;
    } catch (e) {
      return 'Unknown dApp';
    }
  }

  /**
   * Create human-readable intent summary
   */
  createIntentSummary(intent) {
    const summary = {
      action: intent.action,
      type: intent.transactionType,
      dapp: intent.metadata.dappName,
      timestamp: new Date(intent.timestamp).toLocaleString()
    };

    if (intent.action === 'swap') {
      summary.description = `Swap transaction on ${intent.metadata.dappName}`;
    } else if (intent.action === 'approve') {
      summary.description = `Approve token spending on ${intent.metadata.dappName}`;
    } else if (intent.action === 'transfer') {
      summary.description = `Transfer on ${intent.metadata.dappName}`;
    } else {
      summary.description = `Transaction on ${intent.metadata.dappName}`;
    }

    return summary;
  }

  /**
   * Validate intent before signing
   */
  validateIntent(intent) {
    const errors = [];

    if (!intent.transaction) {
      errors.push('Missing transaction data');
    }

    if (!intent.action || intent.action === 'unknown') {
      // If we have serialized data, allow unknown action - backend will determine it
      if (!intent.transaction?.serialized) {
        errors.push('Unknown action type');
      }
    }

    if (intent.expiry < Date.now()) {
      errors.push('Intent has expired');
    }

    // If we have serialized transaction but no instructions, that's OK - backend will deserialize
    if (!intent.transaction.instructions || intent.transaction.instructions.length === 0) {
      if (!intent.transaction.serialized) {
        errors.push('Transaction has no instructions and no serialized data');
      }
      // Otherwise, it's OK - backend will deserialize the serialized transaction
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// SolanaIntentBuilder is available globally when loaded via importScripts
